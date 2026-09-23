-- Tests for 00011_gamification_bubbles_ledger.sql and 00012_guest_cleanup_cron.sql
-- (#520, #522, #519).
--
-- LOCAL ONLY. Never run this against the hosted project: it inserts into
-- auth.users. It runs inside a transaction that is rolled back at the end,
-- so it leaves nothing behind, but it still has no business on production.
--
-- Run against a local Supabase (Docker):
--   supabase start
--   supabase db reset          # applies every file in supabase/migrations/
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/v1_gamification_guest_cleanup_test.sql
--
-- Every check is an ASSERT; the first failure aborts with its message. A
-- clean run ends with NOTICE "ALL CHECKS PASSED".

BEGIN;

-- ----------------------------------------------------------------------------
-- Fixtures
-- ----------------------------------------------------------------------------
-- a: stale guest (60 days idle) with data in several tables  -> DELETED
-- b: guest created 60d ago, session refreshed 2 days ago      -> kept
-- c: guest created 60d ago, daily_visit bubble 5 days ago     -> kept
-- d: real account (not anonymous), 60 days idle               -> kept
-- e: anonymous but email attached (mid-upgrade), 60 days idle -> kept
-- f: guest created 60d ago, refresh token rotated 1 day ago   -> kept
-- g: guest created 10 days ago                                -> kept
CREATE TEMP TABLE t_ids (k TEXT PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
INSERT INTO t_ids VALUES
  ('a', gen_random_uuid()), ('b', gen_random_uuid()), ('c', gen_random_uuid()),
  ('d', gen_random_uuid()), ('e', gen_random_uuid()), ('f', gen_random_uuid()),
  ('g', gen_random_uuid());

INSERT INTO auth.users (id, email, is_anonymous, created_at, updated_at, last_sign_in_at)
SELECT id,
       CASE k WHEN 'd' THEN 'real-' || id || '@example.com'
              WHEN 'e' THEN 'upgrading-' || id || '@example.com' END,
       k <> 'd',
       now() - CASE k WHEN 'g' THEN interval '10 days' ELSE interval '60 days' END,
       now() - CASE k WHEN 'g' THEN interval '10 days' ELSE interval '60 days' END,
       now() - CASE k WHEN 'g' THEN interval '10 days' ELSE interval '60 days' END
FROM t_ids;

-- b: a session refreshed 2 days ago (refreshed_at is timestamp w/o tz, UTC)
INSERT INTO auth.sessions (id, user_id, created_at, updated_at, refreshed_at)
SELECT gen_random_uuid(), id, now() - interval '60 days', now() - interval '60 days',
       (now() - interval '2 days') AT TIME ZONE 'UTC'
FROM t_ids WHERE k = 'b';

-- f: a refresh token rotated 1 day ago
INSERT INTO auth.refresh_tokens (token, user_id, revoked, created_at, updated_at)
SELECT 'test-token-' || id, id::text, false, now() - interval '1 day', now() - interval '1 day'
FROM t_ids WHERE k = 'f';

-- a: owns rows in several cascading tables, all old
INSERT INTO pantry_items (user_id, name, name_normalized)
SELECT id, 'Spinach', 'spinach' FROM t_ids WHERE k = 'a';
INSERT INTO bubble_events (user_id, event_type, amount, ref_key, created_at)
SELECT id, 'pantry_add', 2, 'item-1', now() - interval '60 days' FROM t_ids WHERE k = 'a';
INSERT INTO decorations (user_id, name, decoration_type, milestone, unlocked_at)
SELECT id, 'potted_basil', 'window_sill', 'm25', now() - interval '60 days' FROM t_ids WHERE k = 'a';
INSERT INTO pantry_events (user_id, item_name, outcome)
SELECT id, 'Milk', 'used' FROM t_ids WHERE k = 'a';

-- c: opened the app 5 days ago
INSERT INTO bubble_events (user_id, event_type, amount, ref_key, created_at)
SELECT id, 'daily_visit', 1, to_char(now() - interval '5 days', 'YYYY-MM-DD'), now() - interval '5 days'
FROM t_ids WHERE k = 'c';

-- ----------------------------------------------------------------------------
-- Ledger (#520)
-- ----------------------------------------------------------------------------
-- Uses the real account d, not guest a: a fresh award is (correctly) a sign
-- of activity and would stop a from being stale.
DO $$
DECLARE
  v_d UUID := (SELECT id FROM t_ids WHERE k = 'd');
  v_rows INTEGER;
BEGIN
  -- Idempotent awards: the same (user, type, ref) twice inserts once.
  INSERT INTO bubble_events (user_id, event_type, amount, ref_key)
  VALUES (v_d, 'pantry_add', 2, 'item-9') ON CONFLICT DO NOTHING;
  INSERT INTO bubble_events (user_id, event_type, amount, ref_key)
  VALUES (v_d, 'recipe_save', 3, 'recipe-1') ON CONFLICT DO NOTHING;
  INSERT INTO bubble_events (user_id, event_type, amount, ref_key)
  VALUES (v_d, 'recipe_save', 3, 'recipe-1') ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  ASSERT v_rows = 0, 'duplicate award should insert nothing';

  -- amount must be positive: nothing can take bubbles away.
  BEGIN
    INSERT INTO bubble_events (user_id, event_type, amount, ref_key)
    VALUES (v_d, 'penalty', -5, 'x');
    ASSERT false, 'negative amount should be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  ASSERT (SELECT balance FROM bubble_balances WHERE user_id = v_d) = 5,
    'balance should be 2 (pantry_add) + 3 (recipe_save, once)';
  RAISE NOTICE 'PASS ledger: idempotent awards, positive amounts, balance view';
END $$;

-- ----------------------------------------------------------------------------
-- One claim per milestone (#522)
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_a UUID := (SELECT id FROM t_ids WHERE k = 'a');
BEGIN
  BEGIN
    INSERT INTO decorations (user_id, name, decoration_type, milestone, unlocked_at)
    VALUES (v_a, 'fairy_lights', 'lights', 'm25', now());
    ASSERT false, 'second claim of the same milestone should be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Rows without a milestone are unaffected by the partial index.
  INSERT INTO decorations (user_id, name, decoration_type) VALUES (v_a, 'seed_1', 'rug');
  INSERT INTO decorations (user_id, name, decoration_type) VALUES (v_a, 'seed_2', 'table');
  RAISE NOTICE 'PASS decorations: one claim per milestone';
END $$;

-- ----------------------------------------------------------------------------
-- RLS / privileges as a signed-in user (guests use the same role)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', (SELECT id FROM t_ids WHERE k = 'c'),
                                    'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t_ids WHERE k = 'c'), true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_c UUID := auth.uid();
BEGIN
  ASSERT v_c IS NOT NULL, 'test setup: auth.uid() should resolve';

  -- Reads: own rows only.
  ASSERT (SELECT count(*) FROM bubble_events) = 1, 'user should see only their own events';
  ASSERT (SELECT count(*) FROM bubble_balances) = 1, 'user should see only their own balance';
  ASSERT (SELECT balance FROM bubble_balances) = 1, 'user c balance should be 1';
  ASSERT (SELECT count(*) FROM decorations) = 0, 'user should not see other users decorations';

  -- Writes: the client cannot mint bubbles or unlock decorations.
  BEGIN
    INSERT INTO bubble_events (user_id, event_type, amount, ref_key)
    VALUES (v_c, 'cook_confirm', 1000000, 'free-money');
    ASSERT false, 'client insert into bubble_events should be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE bubble_events SET amount = 1000000 WHERE user_id = v_c;
    ASSERT false, 'client update of bubble_events should be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO decorations (user_id, name, decoration_type, milestone)
    VALUES (v_c, 'golden_whisk', 'wall_art', 'm999');
    ASSERT false, 'client insert into decorations should be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- The cleanup functions are not callable over the API.
  BEGIN
    PERFORM public.delete_stale_guests();
    ASSERT false, 'authenticated must not execute delete_stale_guests';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.stale_guest_candidates();
    ASSERT false, 'authenticated must not execute stale_guest_candidates';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS rls: read own only; no client writes; cleanup not callable';
END $$;

RESET ROLE;

-- ----------------------------------------------------------------------------
-- Guest cleanup (#519)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_a UUID := (SELECT id FROM t_ids WHERE k = 'a');
  v_candidates UUID[];
  v_n INTEGER;
BEGIN
  SELECT array_agg(c.user_id) INTO v_candidates
  FROM public.stale_guest_candidates() c
  WHERE c.user_id IN (SELECT id FROM t_ids);
  ASSERT v_candidates = ARRAY[v_a], 'only the stale guest should be a candidate, got ' || COALESCE(v_candidates::text, 'none');

  -- The 30-day floor: asking for 1 day must not widen the net.
  ASSERT (SELECT count(*) FROM public.stale_guest_candidates(1) c
          WHERE c.user_id IN (SELECT id FROM t_ids)) = 1,
    'p_inactive_days below 30 must be floored at 30';

  -- Cap of 0 deletes nothing (and proves the delete privilege works).
  v_n := public.delete_stale_guests(30, 0);
  ASSERT v_n = 0, 'max_rows = 0 should delete nothing';
  ASSERT EXISTS (SELECT 1 FROM auth.users WHERE id = v_a), 'stale guest should survive a 0 cap';

  -- The real run. Other stale guests on a shared local DB may be deleted too,
  -- so assert on our fixtures rather than the returned count.
  v_n := public.delete_stale_guests();
  ASSERT v_n >= 1, 'the stale guest should be deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_a), 'stale guest row should be gone';
  ASSERT (SELECT count(*) FROM auth.users WHERE id IN (SELECT id FROM t_ids)) = 6,
    'b, c, d, e, f, g must all be kept';

  -- Cascade: every user-owned row of a went with it.
  ASSERT NOT EXISTS (SELECT 1 FROM pantry_items  WHERE user_id = v_a), 'pantry_items should cascade';
  ASSERT NOT EXISTS (SELECT 1 FROM pantry_events WHERE user_id = v_a), 'pantry_events should cascade';
  ASSERT NOT EXISTS (SELECT 1 FROM bubble_events WHERE user_id = v_a), 'bubble_events should cascade';
  ASSERT NOT EXISTS (SELECT 1 FROM decorations   WHERE user_id = v_a), 'decorations should cascade';

  -- Idempotent: a second run finds nothing of ours.
  PERFORM public.delete_stale_guests();
  ASSERT (SELECT count(*) FROM auth.users WHERE id IN (SELECT id FROM t_ids)) = 6,
    'second run must not delete anything else';
  RAISE NOTICE 'PASS cleanup: only stale never-linked guests deleted, data cascades, idempotent';
END $$;

-- ----------------------------------------------------------------------------
-- Every FK to auth.users cascades (catches a future table that forgets to)
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(conrelid::regclass::text, ', ') INTO v_bad
  FROM pg_constraint
  WHERE contype = 'f'
    AND confrelid = 'auth.users'::regclass
    AND connamespace = 'public'::regnamespace
    AND confdeltype <> 'c';
  ASSERT v_bad IS NULL, 'public tables whose FK to auth.users does not cascade: ' || v_bad;
  RAISE NOTICE 'PASS cascade: every public FK to auth.users is ON DELETE CASCADE';
END $$;

-- ----------------------------------------------------------------------------
-- The cron job is scheduled exactly once
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM cron.job WHERE jobname = 'delete-stale-guests') = 1,
    'cron job delete-stale-guests should exist exactly once';
  ASSERT (SELECT schedule FROM cron.job WHERE jobname = 'delete-stale-guests') = '17 * * * *',
    'cron job should run hourly at :17';
  RAISE NOTICE 'PASS cron: job scheduled once, hourly at :17';
  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;

ROLLBACK;
