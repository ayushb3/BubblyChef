-- Delete never-linked guest accounts after 30 days without a visit (#519).
--
-- Every page load without a session mints an anonymous auth.users row
-- (nextjs/src/lib/supabase/middleware.ts -> signInAnonymously()). Guests who
-- never save their account and stop coming back would otherwise keep their
-- pantry, recipes, chat and kitchen rows forever. This migration adds:
--
--   stale_guest_candidates(days)   read-only: who WOULD be deleted (dry run)
--   delete_stale_guests(days, max) deletes them, returns how many
--   cron job 'delete-stale-guests' runs the delete hourly at :17
--
-- Working default from #519 (Ayush can override): the 30 days count from the
-- guest's LAST visit, not their first, so an active guest never loses their
-- kitchen.
--
-- ---------------------------------------------------------------------------
-- Who can be deleted (ALL must hold):
--   * auth.users.is_anonymous IS TRUE. Supabase flips this to false when a
--     guest attaches a verified email (SaveAccountBanner -> updateUser) or
--     links an identity (linkIdentity, #389). Linked guests and every real
--     account are therefore never candidates.
--   * no email and no phone on the row, and no auth.identities row for any
--     provider other than 'anonymous'. Redundant with is_anonymous on
--     purpose: if a guest is mid-way through saving their account (e.g. an
--     email attached but not yet verified), they are kept.
--   * last activity older than max(days, 30). The floor means a typo like
--     delete_stale_guests(3) still can't delete anyone active in the last
--     30 days.
--
-- "Last activity" is the GREATEST of every signal that moves when a guest
-- uses the app (GREATEST ignores NULLs; created_at is the floor so a brand
-- new user is never stale):
--   * auth.users.created_at, last_sign_in_at, updated_at.
--     last_sign_in_at is set by signInAnonymously() but does not move on a
--     token refresh, so on its own it would make a daily guest look 30 days
--     idle. updated_at moves on any user update (e.g. the theme choice in
--     user_metadata, #523).
--   * auth.sessions.refreshed_at / updated_at. The middleware calls
--     supabase.auth.getUser() on every request, which refreshes an expired
--     access token (jwt_expiry = 3600 s), and GoTrue stamps the session on
--     each refresh. So any visit more than an hour after the previous
--     refresh moves this. refreshed_at is `timestamp without time zone`
--     holding UTC, hence AT TIME ZONE 'UTC'.
--   * auth.refresh_tokens.updated_at (a new/updated row per rotation;
--     user_id there is varchar, hence the ::text).
--   * public.bubble_events.created_at: the daily_visit award (#520) is an
--     app-level "opened the app today" record.
-- Using several signals only ever errs towards KEEPING a guest.
--
-- Cascade: deleting the auth.users row removes all of the user's data,
-- because every user-owned table references auth.users(id) ON DELETE
-- CASCADE: pantry_items, recipes, user_profiles, conversation_history,
-- conversation_sessions, decorations, ingestion_logs (00001), pantry_events
-- (00007), bubble_events (00011). food_catalog has no user_id. The PR body
-- has a query that lists every FK to auth.users so this can be re-checked
-- on the live database. Storage objects are not covered (storage is
-- disabled in config.toml and the app uploads none today).
--
-- Batch cap: at most p_max_rows (default 1000) users per run, oldest first.
-- Hourly runs clear up to 24,000/day, which keeps up with bot traffic
-- minting guests, while a bug in the activity logic can't wipe every guest
-- in one go.
--
-- pg_cron: CREATE EXTENSION below enables it if the role applying this is
-- allowed to. If it errors with a permission message, enable it in the
-- dashboard (Database -> Extensions -> search "pg_cron" -> enable) and run
-- this file again. The file is idempotent: CREATE OR REPLACE for the
-- functions, and cron.schedule() with a job name updates the existing job
-- instead of adding a second one.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- stale_guest_candidates: dry run, read-only
-- ============================================================================
-- LANGUAGE sql (not plpgsql) on purpose: Postgres validates a SQL function's
-- body when it is created, so if any auth.* column referenced here doesn't
-- exist on the live project, applying the migration fails loudly instead of
-- the cron job failing silently every hour.
CREATE OR REPLACE FUNCTION public.stale_guest_candidates(p_inactive_days INTEGER DEFAULT 30)
RETURNS TABLE (user_id UUID, created_at TIMESTAMPTZ, last_active_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.created_at, activity.last_active_at
  FROM auth.users u
  CROSS JOIN LATERAL (
    SELECT GREATEST(
      u.created_at,
      u.last_sign_in_at,
      u.updated_at,
      (SELECT max(GREATEST(s.updated_at, s.refreshed_at AT TIME ZONE 'UTC'))
         FROM auth.sessions s
        WHERE s.user_id = u.id),
      (SELECT max(rt.updated_at)
         FROM auth.refresh_tokens rt
        WHERE rt.user_id = u.id::text),
      (SELECT max(b.created_at)
         FROM public.bubble_events b
        WHERE b.user_id = u.id)
    ) AS last_active_at
  ) AS activity
  WHERE u.is_anonymous IS TRUE
    AND COALESCE(u.email, '') = ''
    AND COALESCE(u.phone, '') = ''
    AND NOT EXISTS (
      SELECT 1 FROM auth.identities i
      WHERE i.user_id = u.id AND i.provider <> 'anonymous'
    )
    AND activity.last_active_at
        < now() - make_interval(days => GREATEST(COALESCE(p_inactive_days, 30), 30))
$$;

COMMENT ON FUNCTION public.stale_guest_candidates(INTEGER) IS
  'Dry run for delete_stale_guests (#519): never-linked anonymous users with no activity for max(p_inactive_days, 30) days. Read-only.';

-- ============================================================================
-- delete_stale_guests: the delete the cron job runs
-- ============================================================================
-- Safe to run by hand at any time: it only ever deletes what
-- stale_guest_candidates returns, re-checks is_anonymous at delete time, and
-- deleting nobody is a no-op. delete_stale_guests(30, 0) deletes nothing but
-- still checks the function has permission to delete from auth.users.
CREATE OR REPLACE FUNCTION public.delete_stale_guests(
  p_inactive_days INTEGER DEFAULT 30,
  p_max_rows INTEGER DEFAULT 1000
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH doomed AS (
    SELECT c.user_id
    FROM public.stale_guest_candidates(p_inactive_days) AS c
    ORDER BY c.last_active_at
    LIMIT GREATEST(COALESCE(p_max_rows, 0), 0)
  ),
  gone AS (
    DELETE FROM auth.users AS u
    USING doomed AS d
    WHERE u.id = d.user_id
      AND u.is_anonymous IS TRUE
    RETURNING u.id
  )
  SELECT count(*) INTO v_deleted FROM gone;

  RAISE LOG 'delete_stale_guests: deleted % never-linked guest account(s)', v_deleted;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.delete_stale_guests(INTEGER, INTEGER) IS
  'Deletes never-linked anonymous users idle for max(p_inactive_days, 30) days, at most p_max_rows per call; their data cascades (#519). Run hourly by pg_cron job delete-stale-guests.';

-- Both functions are SECURITY DEFINER in the public schema, which PostgREST
-- exposes as /rest/v1/rpc/<name>. Supabase grants EXECUTE on new public
-- functions to anon and authenticated by default, so without these REVOKEs
-- any browser (guests included) could list stale user ids or trigger the
-- delete. Only the database owner (the cron job runs as postgres) and the
-- service role keep EXECUTE.
REVOKE EXECUTE ON FUNCTION public.stale_guest_candidates(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_stale_guests(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Schedule: hourly at minute 17
-- ============================================================================
-- Named job: re-running this file updates the job rather than duplicating it.
SELECT cron.schedule(
  'delete-stale-guests',
  '17 * * * *',
  $$SELECT public.delete_stale_guests()$$
);
