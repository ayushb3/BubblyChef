-- Tests for 00017_guest_cleanup_cron.sql (#519).
--
-- LOCAL ONLY. Never run this against the hosted project: it inserts into
-- auth.users and runs the real delete. It runs inside a transaction that is
-- rolled back at the end, so it leaves nothing behind, but it still has no
-- business on production.
--
-- Run against a local Supabase (Docker):
--   supabase start
--   supabase db reset          # applies every file in supabase/migrations/
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/guest_cleanup_test.sql
--
-- Every check is an ASSERT; the first failure aborts with its message. A
-- clean run ends with NOTICE "ALL CHECKS PASSED".
--
-- The two "@cron" markers fence the check that needs pg_cron. A runner
-- without pg_cron (e.g. an in-process Postgres) may strip that block.

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
-- h: anonymous with a non-anonymous identity (linked Google), 60 days idle -> kept
-- i: guest created 60d ago, user row updated 3 days ago       -> kept
-- j: guest idle 31 days (just past the line)                  -> DELETED
-- k: guest idle 29 days (just inside the line)                -> kept
CREATE TEMP TABLE t_ids (k TEXT PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
INSERT INTO t_ids
SELECT k, gen_random_uuid() FROM unnest(ARRAY['a','b','c','d','e','f','g','h','i','j','k']) AS k;

INSERT INTO auth.users (id, email, is_anonymous, created_at, updated_at, last_sign_in_at)
SELECT id,
       CASE k WHEN 'd' THEN 'real-' || id || '@example.com'
              WHEN 'e' THEN 'upgrading-' || id || '@example.com' END,
       k <> 'd',
       now() - CASE k WHEN 'g' THEN interval '10 days'
                      WHEN 'j' THEN interval '31 days'
                      WHEN 'k' THEN interval '29 days'
                      ELSE interval '60 days' END,
       now() - CASE k WHEN 'g' THEN interval '10 days'
                      WHEN 'i' THEN interval '3 days'
                      WHEN 'j' THEN interval '31 days'
                      WHEN 'k' THEN interval '29 days'
                      ELSE interval '60 days' END,
       now() - CASE k WHEN 'g' THEN interval '10 days'
                      WHEN 'j' THEN interval '31 days'
                      WHEN 'k' THEN interval '29 days'
                      ELSE interval '60 days' END
FROM t_ids;

-- h: a linked non-anonymous identity on an (unexpectedly still-anonymous) row.
INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data)
SELECT gen_random_uuid(), id, 'google', 'g-' || id, '{}'::jsonb FROM t_ids WHERE k = 'h';

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
SELECT id, 'Spinach', 'spinach' FROM t_ids WHERE k IN ('a', 'j');
INSERT INTO bubble_events (user_id, event_type, amount, ref_key, created_at)
SELECT id, 'pantry_add', 2, 'item-1', now() - interval '60 days' FROM t_ids WHERE k = 'a';
INSERT INTO pantry_events (user_id, item_name, outcome)
SELECT id, 'Milk', 'used' FROM t_ids WHERE k = 'a';

-- c: opened the app 5 days ago
INSERT INTO bubble_events (user_id, event_type, amount, ref_key, created_at)
SELECT id, 'daily_visit', 1, to_char(now() - interval '5 days', 'YYYY-MM-DD'), now() - interval '5 days'
FROM t_ids WHERE k = 'c';

-- ----------------------------------------------------------------------------
-- The cleanup functions are not callable over the API (signed-in users and
-- guests share the `authenticated` role)
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
DO $$
BEGIN
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
  RAISE NOTICE 'PASS privileges: cleanup functions not callable by authenticated';
END $$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- Selection (the dry run)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_a UUID := (SELECT id FROM t_ids WHERE k = 'a');
  v_j UUID := (SELECT id FROM t_ids WHERE k = 'j');
  v_candidates UUID[];
BEGIN
  SELECT array_agg(c.user_id ORDER BY c.user_id) INTO v_candidates
  FROM public.stale_guest_candidates() c
  WHERE c.user_id IN (SELECT id FROM t_ids);
  ASSERT v_candidates = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[v_a, v_j]) x),
    'only a (60d idle) and j (31d idle) should be candidates, got ' || COALESCE(v_candidates::text, 'none');

  -- The 30-day floor: asking for 1 day must not widen the net (k is 29d idle).
  ASSERT (SELECT count(*) FROM public.stale_guest_candidates(1) c
          WHERE c.user_id IN (SELECT id FROM t_ids)) = 2,
    'p_inactive_days below 30 must be floored at 30';

  -- A longer window narrows it: at 45 days only a qualifies.
  ASSERT (SELECT count(*) FROM public.stale_guest_candidates(45) c
          WHERE c.user_id IN (SELECT id FROM t_ids)) = 1,
    'p_inactive_days = 45 should select only the 60-day-idle guest';

  -- Dry run deletes nothing.
  ASSERT (SELECT count(*) FROM auth.users WHERE id IN (SELECT id FROM t_ids)) = 11,
    'the dry run must not delete anyone';
  RAISE NOTICE 'PASS selection: only never-linked guests idle 30+ days; 30-day floor holds';
END $$;

-- ----------------------------------------------------------------------------
-- The delete
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_a UUID := (SELECT id FROM t_ids WHERE k = 'a');
  v_j UUID := (SELECT id FROM t_ids WHERE k = 'j');
  v_n INTEGER;
BEGIN
  -- Cap of 0 deletes nothing (and proves the delete privilege works).
  v_n := public.delete_stale_guests(30, 0);
  ASSERT v_n = 0, 'max_rows = 0 should delete nothing';
  ASSERT EXISTS (SELECT 1 FROM auth.users WHERE id = v_a), 'stale guest should survive a 0 cap';

  -- The real run. Other stale guests on a shared local DB may be deleted too,
  -- so assert on our fixtures rather than the returned count.
  v_n := public.delete_stale_guests();
  ASSERT v_n >= 2, 'the two stale guests should be deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_a, v_j)), 'stale guest rows should be gone';
  ASSERT (SELECT count(*) FROM auth.users WHERE id IN (SELECT id FROM t_ids)) = 9,
    'b, c, d, e, f, g, h, i, k must all be kept';

  -- Cascade: every user-owned row of a and j went with them.
  ASSERT NOT EXISTS (SELECT 1 FROM pantry_items  WHERE user_id IN (v_a, v_j)), 'pantry_items should cascade';
  ASSERT NOT EXISTS (SELECT 1 FROM pantry_events WHERE user_id = v_a), 'pantry_events should cascade';
  ASSERT NOT EXISTS (SELECT 1 FROM bubble_events WHERE user_id = v_a), 'bubble_events should cascade';

  -- Kept users keep their data.
  ASSERT EXISTS (SELECT 1 FROM bubble_events WHERE user_id = (SELECT id FROM t_ids WHERE k = 'c')),
    'a kept guest must keep their rows';

  -- Idempotent: a second run finds nothing of ours.
  PERFORM public.delete_stale_guests();
  ASSERT (SELECT count(*) FROM auth.users WHERE id IN (SELECT id FROM t_ids)) = 9,
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

-- @cron-begin
-- ----------------------------------------------------------------------------
-- The schedule: one hourly job, re-applying the migration keeps it at one
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM cron.job WHERE jobname = 'delete-stale-guests') = 1,
    'cron job delete-stale-guests should exist exactly once';
  ASSERT (SELECT schedule FROM cron.job WHERE jobname = 'delete-stale-guests') = '17 * * * *',
    'cron job should run hourly at :17';
  ASSERT (SELECT command FROM cron.job WHERE jobname = 'delete-stale-guests')
         = 'SELECT public.delete_stale_guests()',
    'cron job should run delete_stale_guests()';
  RAISE NOTICE 'PASS cron: job scheduled once, hourly at :17';
END $$;
-- @cron-end

DO $$ BEGIN RAISE NOTICE 'ALL CHECKS PASSED'; END $$;

ROLLBACK;
