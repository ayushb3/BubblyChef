-- Migration: Add pantry_events table
-- Records what actually happened to a pantry item when the user resolved it
-- (used it up, tossed it, or cooked it) so the app can eventually report
-- "you saved N items this week" instead of just watching items expire silently.
--
-- pantry_item_id is nullable on purpose and carries NO foreign key: resolving an
-- item deletes its pantry_items row, so by the time anyone reads this table the
-- target may already be gone. item_name is denormalised alongside it so the
-- event stays meaningful on its own after the pantry_items row disappears.
--
-- Append-only: no updated_at column, and no UPDATE or DELETE policy below --
-- rows are written once and never changed. A miscount is better than a
-- rewritable history when the whole point is to measure what happened.

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

-- Serves "this user's events, most recent first"; the future weekly-stats
-- screen filters this same table on created_at.
CREATE INDEX idx_pantry_events_user_created ON pantry_events(user_id, created_at DESC);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE pantry_events ENABLE ROW LEVEL SECURITY;

-- Deliberately not FOR ALL, unlike the other tables in 00002. The table is
-- append-only, so granting UPDATE and DELETE would hand away the one property
-- it exists to guarantee.
CREATE POLICY "Users read own pantry events"
  ON pantry_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own pantry events"
  ON pantry_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);
