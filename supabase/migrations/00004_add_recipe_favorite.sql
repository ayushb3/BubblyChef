ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_recipes_user_favorite ON recipes (user_id, is_favorite) WHERE is_favorite = true;
