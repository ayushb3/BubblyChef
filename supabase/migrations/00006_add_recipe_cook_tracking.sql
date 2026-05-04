-- Migration: Add cook tracking columns to recipes table
-- Tracks when a recipe was last cooked and how many times it has been cooked.

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS last_cooked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS times_cooked integer NOT NULL DEFAULT 0;
