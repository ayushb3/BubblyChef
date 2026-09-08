-- Track whether a pantry item's expiry_date was heuristically estimated
ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS estimated_expiry BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN pantry_items.estimated_expiry IS
  'True if expiry_date was estimated heuristically rather than read from a receipt/label or entered by the user.';
