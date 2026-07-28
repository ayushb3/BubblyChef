-- Migration: Add pantry_events table
-- Records what actually happened when an expiring pantry item was resolved
-- (used, tossed, or cooked) so the app can eventually report "you saved N
-- items this week" instead of just watching items expire silently.
--
-- pantry_item_id is nullable on purpose: resolving an item deletes its row
-- from pantry_items, so by the time anyone reads this table the FK target
-- may already be gone. item_name is denormalised alongside it so the event
-- stays meaningful on its own after the pantry_items row disappears. For
-- that same reason this column intentionally has no foreign key constraint.
--
-- Append-only: no updated_at column, and no UPDATE/DELETE policy below
-- (see RLS section) -- rows are written once and never changed.

CREATE TABLE pantry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pantry_item_id UUID,
  item_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('used', 'tossed', 'cooked')),
  quantity NUMERIC,
  unit TEXT,
  days_until_expiry INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves "this user's events, most recent first"; a future weekly-stats
-- screen will filter this same table on created_at.
CREATE INDEX idx_pantry_events_user_created ON pantry_events(user_id, created_at DESC);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE pantry_events ENABLE ROW LEVEL SECURITY;

-- Users may only insert events for themselves.
CREATE POLICY "Users insert own pantry events"
  ON pantry_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users may only read their own events.
CREATE POLICY "Users view own pantry events"
  ON pantry_events FOR SELECT
  USING (auth.uid() = user_id);

-- No UPDATE or DELETE policy: intentional. pantry_events is append-only,
-- so rows are never modified or removed once written.
