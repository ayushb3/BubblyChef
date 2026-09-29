-- Structured recipe steps (issue #648): durations, hands-on/off and
-- dependencies, alongside the existing plain-text `instructions` column.
-- `instructions` is unchanged -- every existing reader keeps working.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS steps JSONB;

COMMENT ON COLUMN recipes.steps IS
  'Structured steps: list of {text, label, ongoing_label, duration_minutes, duration_estimated, hands_on, depends_on, exclusive}, one per instructions entry, in the same order. NULL means "not yet structured" -- derived lazily via POST /v1/recipes/{id}/steps/ensure, and cleared whenever instructions changes.';
