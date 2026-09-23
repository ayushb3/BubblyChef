-- v1 gamification schema: the bubbles ledger, a balance view, and unlock
-- integrity on the existing decorations table.
--
-- Used by (v1 friend-ready PRD, docs/plans/2026-09-23-v1-friend-ready-prd.md,
-- section "Gamification design"):
--   #520  bubbles ledger       -> bubble_events + bubble_balances
--   #521  kitchen scene        -> reads decorations (unchanged shape)
--   #522  pick 1 of 3          -> decorations.milestone, one claim per milestone
--   #523  kitchen themes       -> no DDL (see below)
--   #524  rescue bonus/streak  -> bubble_events (event types 'rescue', 'weekly_streak')
--   #525  "+N" pop             -> reads the balance
--
-- Deliberately NOT created here, because the issues already settle them
-- without a table:
--   * No per-user progress row. Bubbles are never spent or taken away
--     (#520), so the balance is simply SUM(amount) over the ledger. A view
--     over an indexed ledger has no second copy that can drift, and needs no
--     trigger or extra write path. At friend scale (hundreds to low thousands
--     of events per user) the sum is an index-only scan. If that ever gets
--     slow, a counter table can be added later without changing callers:
--     they read bubble_balances either way.
--   * No streak columns. #524 derives the streak from the run of consecutive
--     'weekly_streak' events (ref_key = ISO week), so the ledger is the store.
--   * No active-theme column. #523 stores the chosen theme in auth
--     user_metadata.kitchen_theme (works for guests, who have no
--     user_profiles row) and derives unlocked themes from the balance,
--     ignoring a stored theme that isn't unlocked. user_metadata is
--     client-writable, but the worst a user can do is pick a theme they
--     haven't unlocked, which the reader already rejects.
--   * No offers table. #522 computes the three choices deterministically
--     from hash(user_id + milestone_key).
--
-- Additive except for one tightening: decorations loses its client-side
-- INSERT/UPDATE/DELETE (see section 3). Nothing in nextjs/ or ai-service/
-- writes decorations today; GET /api/decorations only reads.
--
-- Idempotent: safe to re-run.

-- ============================================================================
-- 1. bubble_events: append-only ledger (#520)
-- ============================================================================
-- Modelled on pantry_events (00007). One row per award. The unique
-- (user_id, event_type, ref_key) constraint is what makes every award
-- idempotent: the Next.js award helper inserts with ON CONFLICT DO NOTHING,
-- so a retried request, or deleting and re-saving the same recipe, can't
-- earn twice.
--
-- ref_key conventions come from #520/#524, e.g. the pantry item id, the
-- recipe id, '<recipe_id>:<YYYY-MM-DD>' for a cook, the client's local date
-- for 'daily_visit', '<pantry_item_id>:<date>' for 'rescue', and the ISO
-- week ('2026-W39') for 'weekly_streak'.
--
-- event_type is not an enum on purpose: adding a new way to earn should not
-- need a protected migration. The CHECK only keeps it to snake_case.

CREATE TABLE IF NOT EXISTS bubble_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]*$'),
  amount INTEGER NOT NULL CHECK (amount > 0),
  ref_key TEXT NOT NULL CHECK (length(ref_key) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bubble_events_award_once UNIQUE (user_id, event_type, ref_key)
);

-- "This user's recent events" (GET /api/bubbles returns the last 10) and the
-- weekly settle in #524 both filter on user_id + created_at. INCLUDE (amount)
-- lets the balance SUM be answered from the index alone.
CREATE INDEX IF NOT EXISTS idx_bubble_events_user_created
  ON bubble_events(user_id, created_at DESC) INCLUDE (amount);

COMMENT ON TABLE bubble_events IS
  'Append-only bubbles ledger (#520). One row per award; unique (user_id, event_type, ref_key) makes awards idempotent. Written only by the server with the service-role key.';

ALTER TABLE bubble_events ENABLE ROW LEVEL SECURITY;

-- Users may read their own rows and nothing else. There is deliberately NO
-- INSERT, UPDATE or DELETE policy: with RLS on, that means the anon key
-- (which every browser has) cannot write this table at all, so nobody can
-- award themselves bubbles. Awards go through Next.js server routes using
-- the service-role client, which bypasses RLS (#520, "Award module").
DROP POLICY IF EXISTS "Users read own bubble events" ON bubble_events;
CREATE POLICY "Users read own bubble events"
  ON bubble_events FOR SELECT
  USING (auth.uid() = user_id);

-- Belt and braces: Supabase's default privileges GRANT ALL on new public
-- tables to anon and authenticated, and rely on RLS alone to stop writes.
-- Revoking the write privileges too means the ledger stays closed even if
-- someone later disables RLS or adds a careless FOR ALL policy.
-- (Guests sign in anonymously and use the 'authenticated' role, so this
-- covers them as well.)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON bubble_events FROM anon, authenticated;

-- ============================================================================
-- 2. bubble_balances: the per-user balance (#520, #522, #523, #525)
-- ============================================================================
-- security_invoker = true makes the view run with the caller's rights, so
-- bubble_events' RLS applies: a user querying it sees only their own row.
-- (A default view runs as its owner and would leak every user's balance.)
--
-- A user with no events has NO row here; callers treat a missing row as 0.
-- Query as: SELECT balance FROM bubble_balances WHERE user_id = $1.
-- The WHERE on the grouping column is pushed below the aggregate, so this
-- reads only that user's index entries.
CREATE OR REPLACE VIEW bubble_balances
  WITH (security_invoker = true) AS
SELECT
  user_id,
  SUM(amount)::BIGINT AS balance,
  COUNT(*)::BIGINT AS event_count,
  MAX(created_at) AS last_earned_at
FROM bubble_events
GROUP BY user_id;

COMMENT ON VIEW bubble_balances IS
  'Lifetime bubbles per user = SUM(bubble_events.amount). Bubbles are never spent, so this is both the balance and the milestone total. No row means 0.';

REVOKE ALL ON bubble_balances FROM anon, authenticated;
GRANT SELECT ON bubble_balances TO authenticated, service_role;

-- ============================================================================
-- 3. decorations: unlock integrity (#521, #522)
-- ============================================================================
-- The existing table (00001) already fits #521/#522 with this mapping,
-- recorded here so the columns stop being ambiguous:
COMMENT ON COLUMN decorations.name IS
  'Kitchen catalog id (nextjs/src/lib/kitchen/catalog.ts). Unique per user.';
COMMENT ON COLUMN decorations.decoration_type IS
  'Kitchen slot key (nextjs/src/lib/kitchen/slots.ts), e.g. wall_shelf, window_sill.';
COMMENT ON COLUMN decorations.milestone IS
  'Milestone key that granted this unlock (nextjs/src/lib/kitchen/milestones.ts), e.g. m25. At most one row per user per milestone.';
COMMENT ON COLUMN decorations.unlocked_at IS
  'When the user claimed it.';

-- One claim per milestone, enforced by the database. #522's POST
-- /api/kitchen/unlock checks "not yet claimed" before inserting, but two
-- taps or two devices can both pass that check; this index makes the second
-- insert fail with 23505 (unique_violation), which the route maps to 409.
-- Partial, so rows with no milestone (hand-seeded or future non-milestone
-- unlocks) are unaffected.
--
-- PRE-CHECK before applying (should return no rows; nothing writes
-- decorations today, so it will):
--   SELECT user_id, milestone, count(*) FROM decorations
--   WHERE milestone IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_decorations_user_milestone
  ON decorations(user_id, milestone)
  WHERE milestone IS NOT NULL;

-- Unlocks are rewards, so they get the same rule as the ledger: users read,
-- only the server writes. The original policy (00002) was FOR ALL, which let
-- any signed-in user (guests included) insert every decoration and claim
-- every milestone straight from the browser with the anon key.
--
-- CONTRACT for #522: POST /api/kitchen/unlock must insert with the
-- service-role client (createServiceClient, as in api/recipes/route.ts)
-- after its reached / not-claimed / was-offered checks. GET /api/decorations
-- keeps working unchanged with the user's client (SELECT is still allowed).
DROP POLICY IF EXISTS "Users manage own decorations" ON decorations;
DROP POLICY IF EXISTS "Users read own decorations" ON decorations;
CREATE POLICY "Users read own decorations"
  ON decorations FOR SELECT
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON decorations FROM anon, authenticated;
