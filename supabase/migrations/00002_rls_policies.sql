-- BubblyChef: Row Level Security Policies
-- Every table is scoped to the authenticated user via auth.uid() = user_id
-- The AI microservice uses the service_role key which bypasses RLS

-- ============================================================================
-- pantry_items
-- ============================================================================
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pantry items"
  ON pantry_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- recipes
-- ============================================================================
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own recipes"
  ON recipes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- user_profiles
-- ============================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own profile"
  ON user_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- conversation_history
-- ============================================================================
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own conversation history"
  ON conversation_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- conversation_sessions
-- ============================================================================
ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sessions"
  ON conversation_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- decorations
-- ============================================================================
ALTER TABLE decorations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own decorations"
  ON decorations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- ingestion_logs
-- ============================================================================
ALTER TABLE ingestion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ingestion logs"
  ON ingestion_logs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- food_catalog (public read-only)
-- ============================================================================
ALTER TABLE food_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read food catalog"
  ON food_catalog FOR SELECT
  USING (true);

-- ============================================================================
-- Auto-create user_profiles on signup
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_profiles (user_id, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
