-- BubblyChef: Initial Supabase Schema
-- Migrated from SQLite (bubbly_chef/repository/sqlite.py)
-- All tables include user_id for multi-user support + RLS

-- ============================================================================
-- Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Helper: auto-update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- pantry_items
-- ============================================================================
CREATE TABLE pantry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  location TEXT NOT NULL DEFAULT 'pantry',
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1.0,
  unit TEXT NOT NULL DEFAULT 'item',
  expiry_date DATE,
  slot_index INTEGER,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pantry_user ON pantry_items(user_id);
CREATE INDEX idx_pantry_name ON pantry_items(name_normalized);
CREATE INDEX idx_pantry_category ON pantry_items(user_id, category);
CREATE INDEX idx_pantry_expiry ON pantry_items(user_id, expiry_date);

CREATE TRIGGER set_pantry_updated_at
  BEFORE UPDATE ON pantry_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- recipes
-- ============================================================================
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  ingredients JSONB NOT NULL DEFAULT '[]',
  instructions JSONB NOT NULL DEFAULT '[]',
  prep_time_minutes INTEGER,
  cook_time_minutes INTEGER,
  total_time_minutes INTEGER,
  servings INTEGER,
  source_url TEXT,
  tags JSONB NOT NULL DEFAULT '[]',
  difficulty TEXT,
  source_type TEXT DEFAULT 'chat',
  source_title TEXT,
  thumbnail_url TEXT,
  is_draft BOOLEAN DEFAULT false,
  cuisine TEXT,
  meal_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recipes_user ON recipes(user_id);
CREATE INDEX idx_recipes_cuisine ON recipes(user_id, cuisine);

CREATE TRIGGER set_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- user_profiles
-- ============================================================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  dietary_preferences JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_email ON user_profiles(email);
CREATE INDEX idx_user_username ON user_profiles(username);

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- conversation_history
-- ============================================================================
CREATE TABLE conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  intent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_history ON conversation_history(user_id, conversation_id, created_at);

-- ============================================================================
-- conversation_sessions
-- ============================================================================
CREATE TABLE conversation_sessions (
  conversation_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  active_mode TEXT NOT NULL DEFAULT 'default',
  pinned_recipe_id UUID,
  pending_proposal JSONB,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_user ON conversation_sessions(user_id);
CREATE INDEX idx_session_mode ON conversation_sessions(active_mode);

CREATE TRIGGER set_sessions_updated_at
  BEFORE UPDATE ON conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- decorations
-- ============================================================================
CREATE TABLE decorations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  decoration_type TEXT NOT NULL DEFAULT 'plant',
  unlocked_at TIMESTAMPTZ,
  milestone TEXT,
  UNIQUE (user_id, name)
);

CREATE INDEX idx_decorations_user ON decorations(user_id);

-- ============================================================================
-- ingestion_logs
-- ============================================================================
CREATE TABLE ingestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  request_id UUID NOT NULL,
  intent TEXT NOT NULL,
  input_payload JSONB NOT NULL DEFAULT '{}',
  proposal JSONB,
  errors JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_user ON ingestion_logs(user_id);
CREATE INDEX idx_ingestion_request ON ingestion_logs(request_id);

-- ============================================================================
-- food_catalog (shared read-only reference table, no user_id needed)
-- ============================================================================
CREATE TABLE food_catalog (
  canonical TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  icon_slug TEXT,
  valid_units JSONB NOT NULL DEFAULT '[]',
  expiry_days INTEGER NOT NULL DEFAULT 7,
  default_location TEXT NOT NULL DEFAULT 'pantry',
  emoji TEXT
);
