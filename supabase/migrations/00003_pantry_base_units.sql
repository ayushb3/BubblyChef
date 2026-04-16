-- Add dual-store base unit columns to pantry_items
ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS quantity_base NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS unit_base TEXT;

COMMENT ON COLUMN pantry_items.quantity_base IS
  'Normalized quantity in base unit (e.g. 12.0 for "1 dozen eggs"). NULL for legacy items.';
COMMENT ON COLUMN pantry_items.unit_base IS
  'Canonical base unit: count | ml | g. NULL for legacy items.';
