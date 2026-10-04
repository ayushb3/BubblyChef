-- Schedule the guest cleanup (#519). Run by hand in the SQL Editor, ONCE,
-- and only after all of these:
--
--   1. Migration 00012_guest_cleanup_cron.sql is applied (it creates the
--      functions and deletes no one).
--   2. The dry run looks sane on the live project:
--        select count(*) from public.stale_guest_candidates();
--        select * from public.stale_guest_candidates() order by last_active_at limit 20;
--   3. Ayush has confirmed the rule: 30 days since the guest's LAST visit.
--
-- This file is deliberately NOT in supabase/migrations/: `supabase db push`
-- applies every pending migration in one go, which would start deleting
-- guests in the same step that created the dry-run function.
--
-- pg_cron: CREATE EXTENSION enables it if this role is allowed to. If it errors
-- with a permission message, enable it in the dashboard (Database ->
-- Extensions -> "pg_cron") and run this file again.
--
-- Idempotent: cron.schedule() with a job name updates the existing job.
-- To stop it:   SELECT cron.unschedule('delete-stale-guests');

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'delete-stale-guests',
  '17 * * * *',
  $$SELECT public.delete_stale_guests()$$
);
