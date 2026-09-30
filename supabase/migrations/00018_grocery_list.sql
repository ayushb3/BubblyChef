-- Grocery list (issue #497 / spec B.5, backend half): one list per user,
-- one line per food, regenerated on demand from depletions + low/expiring
-- stock + a saved meal's missing ingredients (computed in ai-service, no LLM).
--
-- Additive, idempotent: new tables, new indexes, one new function. Nothing
-- existing is altered, dropped or rewritten.
--
-- Two writers, one schema: the Next.js CRUD routes (authenticated user, RLS
-- applies) and the AI microservice's regenerate (service_role, bypasses RLS,
-- every query still scoped by user_id in the repository).

-- ============================================================================
-- 1. grocery_lists — exactly one per user; carries the read-only share token
-- ============================================================================
CREATE TABLE IF NOT EXISTS grocery_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  -- NULL = not shared. Anyone holding the token can READ the unchecked lines
  -- through get_shared_grocery_list() below; nobody can write through it.
  -- Revoking = set back to NULL (or rotate by writing a new value).
  share_token TEXT,
  last_regenerated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_grocery_lists_user UNIQUE (user_id),
  CONSTRAINT ck_grocery_lists_token_length
    CHECK (share_token IS NULL OR length(share_token) >= 16)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grocery_lists_share_token
  ON grocery_lists(share_token)
  WHERE share_token IS NOT NULL;

DROP TRIGGER IF EXISTS set_grocery_lists_updated_at ON grocery_lists;
CREATE TRIGGER set_grocery_lists_updated_at
  BEFORE UPDATE ON grocery_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE grocery_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own grocery lists" ON grocery_lists;
CREATE POLICY "Users manage own grocery lists"
  ON grocery_lists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 2. grocery_items — one line per food per list
-- ============================================================================
CREATE TABLE IF NOT EXISTS grocery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES grocery_lists(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  -- Normalised food name (ai-service `normalize_food_name`, lowercased): the
  -- dedupe key, so "Eggs" and "egg" are one line.
  name_key TEXT NOT NULL,
  quantity NUMERIC CHECK (quantity IS NULL OR quantity >= 0),
  unit TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  -- Why the line exists. depleted/expiring/low/meal are "generated" lines that
  -- regenerate refreshes; manual lines are never touched by regenerate.
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('depleted', 'expiring', 'low', 'meal', 'manual')),
  -- For source = 'meal': the meal id it was added for. Informational only (no
  -- FK: deleting a meal must not delete a line the user may still want).
  source_ref TEXT,
  checked BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_grocery_items_list_name UNIQUE (list_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_grocery_items_user ON grocery_items(user_id);
CREATE INDEX IF NOT EXISTS idx_grocery_items_list ON grocery_items(list_id);

DROP TRIGGER IF EXISTS set_grocery_items_updated_at ON grocery_items;
CREATE TRIGGER set_grocery_items_updated_at
  BEFORE UPDATE ON grocery_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE grocery_items ENABLE ROW LEVEL SECURITY;

-- Own rows only, AND the list the row points at must be the caller's own, so a
-- user can never attach a line to someone else's list by guessing its id.
DROP POLICY IF EXISTS "Users manage own grocery items" ON grocery_items;
CREATE POLICY "Users manage own grocery items"
  ON grocery_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM grocery_lists l
      WHERE l.id = grocery_items.list_id AND l.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. Read-only share — the ONLY thing the anon role can reach
-- ============================================================================
-- SECURITY DEFINER so a signed-out friend holding the link can read the list
-- without any table grant. Returns only what a shopping list needs (no ids, no
-- user id), only unchecked lines, only for an exact, non-null token of at
-- least 16 characters. There is no write counterpart.
CREATE OR REPLACE FUNCTION get_shared_grocery_list(p_token TEXT)
RETURNS TABLE (name TEXT, quantity NUMERIC, unit TEXT, category TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.name, i.quantity, i.unit, i.category
  FROM grocery_items i
  JOIN grocery_lists l ON l.id = i.list_id
  WHERE p_token IS NOT NULL
    AND length(p_token) >= 16
    AND l.share_token = p_token
    AND NOT i.checked
  ORDER BY i.category, i.name;
$$;

REVOKE ALL ON FUNCTION get_shared_grocery_list(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_shared_grocery_list(TEXT) TO anon, authenticated;

COMMENT ON TABLE grocery_lists IS
  'One grocery list per user (issue #497). share_token NULL = private; a token exposes the unchecked lines read-only via get_shared_grocery_list().';
COMMENT ON TABLE grocery_items IS
  'Grocery list lines, one per food (list_id + name_key). source says why it is there; regenerate (ai-service) refreshes depleted/expiring/low lines and leaves manual and checked ones alone.';
