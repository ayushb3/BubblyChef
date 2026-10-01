-- Profile cooking-context fields (issue #500, Spec B.8; constituent of #395).
--
-- Additive only: every column has a default (or is nullable), so existing rows and
-- every existing reader keep working unchanged. This one migration creates the whole
-- #395 column set so it is reviewed and applied once:
--   * allergies, disliked_ingredients  -- wired by this ticket (#500)
--   * household_size, favorite_cuisines, expiry_priority -- created here, consumed
--     later by Spec B.9 and B.10 (nothing reads them yet)
--
-- RLS: user_profiles already has per-row policies (00002_rls_policies.sql) keyed on
-- user_id, and they cover every column of the row, so no policy change is needed.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS allergies JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS disliked_ingredients JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS household_size INTEGER,
  ADD COLUMN IF NOT EXISTS favorite_cuisines JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS expiry_priority TEXT NOT NULL DEFAULT 'gentle'
    CHECK (expiry_priority IN ('off', 'gentle', 'aggressive'));

COMMENT ON COLUMN user_profiles.allergies IS
  'List of allergy strings (e.g. "peanut"). A hard "never suggest": never overridden by a chat message, enforced by a post-generation guard in the AI service (issue #500).';
COMMENT ON COLUMN user_profiles.disliked_ingredients IS
  'List of ingredient strings the user dislikes. Left out of suggestions unless a message explicitly asks for one (issue #500).';
