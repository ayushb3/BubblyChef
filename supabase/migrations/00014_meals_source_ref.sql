-- Issue #650 (PR #659 review): make "Save meal" idempotent across navigation.
--
-- The chat's compact meal card creates its meal on the first Open or Save.
-- The in-page guard that stopped a second tap creating a second meal lived
-- in component state, so Open -> Back -> Save (the page remounts, the state
-- is gone) POSTed a second meal. The ai-service now stamps every `meal`
-- proposal with a `meal_ref` that persists in the conversation history;
-- `POST /api/meals` sends it as `source_ref` and returns the existing meal
-- for the same (user, source_ref) instead of inserting another.
--
-- Additive: a nullable column and a partial unique index. Meals created
-- without a source_ref (existing rows, "make it a meal" later) are
-- unaffected.

ALTER TABLE meals ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meals_user_source_ref
  ON meals (user_id, source_ref)
  WHERE source_ref IS NOT NULL;
