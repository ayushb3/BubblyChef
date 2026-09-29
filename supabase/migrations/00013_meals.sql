-- Meals (issue #650 / spec #647 "Meal schema"): a saved or draft grouping of
-- one main and one or two sides, with a single servings number and optional
-- kitchen limits. `meals` never copies its dishes — `meal_dishes` is a pure
-- join table onto `recipes`; a Dish *is* a Recipe playing a role in a Meal.
--
-- Additive, idempotent: safe to re-run. Not applied by the agent that wrote
-- it — the orchestrator applies this via `supabase db push --linked`.

-- ============================================================================
-- 1. meals
-- ============================================================================
CREATE TABLE IF NOT EXISTS meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  servings INTEGER NOT NULL,
  -- Kitchen limits ("one pan") plus the extracted RecipeConstraints echo used
  -- to regenerate sides later. Shape is owned by the ai-service contract
  -- (docs/plans/2026-09-29-issue-650-meal-contract.md), not enforced here.
  constraints JSONB NOT NULL DEFAULT '{}',
  is_draft BOOLEAN NOT NULL DEFAULT false,
  source_type TEXT DEFAULT 'chat',
  last_cooked_at TIMESTAMPTZ,
  times_cooked INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meals_user ON meals(user_id);

DROP TRIGGER IF EXISTS set_meals_updated_at ON meals;
CREATE TRIGGER set_meals_updated_at
  BEFORE UPDATE ON meals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE meals ENABLE ROW LEVEL SECURITY;

-- Own rows only — same shape as recipes (00002_rls_policies.sql). The AI
-- microservice uses the service_role key, which bypasses RLS.
DROP POLICY IF EXISTS "Users manage own meals" ON meals;
CREATE POLICY "Users manage own meals"
  ON meals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 2. meal_dishes — join table onto recipes; dish identity is by recipe id
-- ============================================================================
CREATE TABLE IF NOT EXISTS meal_dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID REFERENCES meals(id) ON DELETE CASCADE NOT NULL,
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('main', 'side')),
  -- 0 is always the main; 1-2 are sides (one or two, model's choice).
  position INTEGER NOT NULL CHECK (position >= 0 AND position <= 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_meal_dishes_position UNIQUE (meal_id, position),
  CONSTRAINT uq_meal_dishes_recipe UNIQUE (meal_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_meal_dishes_meal ON meal_dishes(meal_id);
CREATE INDEX IF NOT EXISTS idx_meal_dishes_user ON meal_dishes(user_id);
-- Recipe delete (issue #650: "the recipe delete confirmation names the meals
-- a recipe belongs to") looks up meal_dishes by recipe_id before deleting.
CREATE INDEX IF NOT EXISTS idx_meal_dishes_recipe ON meal_dishes(recipe_id);

-- One main per meal — a partial unique index, since `position` alone (0 is
-- always the main) already implies this, but the spec calls it out as its
-- own guarantee and a partial index makes the intent explicit and enforced
-- even if `position`'s convention is ever relaxed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meal_dishes_one_main
  ON meal_dishes(meal_id)
  WHERE role = 'main';

ALTER TABLE meal_dishes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own meal dishes" ON meal_dishes;
CREATE POLICY "Users manage own meal dishes"
  ON meal_dishes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE meals IS
  'A saved or draft grouping of one main + 1-2 sides (issue #650 / spec #647). Refers to its dishes via meal_dishes; never copies them. The Meal timeline (scheduler output) is not stored — recomputed from the dishes'' structured steps.';
COMMENT ON TABLE meal_dishes IS
  'Join table: meals <-> recipes, with role (main|side) and position (0=main, 1-2=sides). Dish identity is by recipe_id only — a recipe can be a dish in several meals. Cascades on both meal and recipe delete.';
