'use client'

import FoodAutocomplete from './FoodAutocomplete'
import type { FoodCatalogEntry } from '@/lib/api/foods'

export interface ManualRow {
  id: string
  name: string
  quantity: number
  unit: string
  category: string
  expiry_date: string
  /**
   * True when `expiry_date` came from the food catalog's default expiry-days
   * rather than something the user typed (issue #398). Carried through to
   * the write path so the pantry's "(est.)" marker (#182/#363) renders for
   * catalog-filled dates too. Flips back to false the moment the user edits
   * the date themselves — it's no longer an estimate at that point.
   */
  estimated_expiry: boolean
}

/** `YYYY-MM-DD` for `today + days`, matching the `<input type="date">` format. */
function expiryDateFromDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const UNITS = ['item', 'g', 'kg', 'ml', 'L', 'lb', 'oz', 'dozen', 'bunch', 'bag', 'can', 'bottle']

const CATEGORIES = [
  { value: 'produce', label: 'Produce' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'meat', label: 'Meat' },
  { value: 'dry_goods', label: 'Dry Goods' },
  { value: 'condiments', label: 'Condiments' },
  { value: 'snacks', label: 'Snacks' },
  { value: 'beverages', label: 'Beverages' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'other', label: 'Other' },
]

interface AddItemRowProps {
  row: ManualRow
  onChange: (updated: ManualRow) => void
  onRemove: () => void
  index: number
}

const inputClass =
  'w-full rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]'

export default function AddItemRow({ row, onChange, onRemove, index }: AddItemRowProps) {
  const set = (field: keyof ManualRow, value: string | number | boolean) =>
    onChange({ ...row, [field]: value })

  // A catalog-supplied unit or category (issue #398) may not be one of the
  // hardcoded options below (e.g. "gallon", or "seafood"/"canned"/"bakery"
  // categories the catalog uses that this row's fixed list predates) — fold
  // it in so the <select> always has a matching <option> and doesn't
  // silently fall back to the first entry.
  const unitOptions = UNITS.includes(row.unit) ? UNITS : [row.unit, ...UNITS]
  const categoryOptions = CATEGORIES.some((c) => c.value === row.category)
    ? CATEGORIES
    : [{ value: row.category, label: row.category }, ...CATEGORIES]

  // Selecting a catalog suggestion auto-fills unit, category and expiry
  // (today + the catalog's expiry_days) — the user can still override any of
  // it afterwards (issue #398). The catalog's `default_location` is ignored:
  // the row has no kitchen-location field any more (issue #397).
  const handleCatalogSelect = (entry: FoodCatalogEntry) => {
    onChange({
      ...row,
      name: entry.canonical,
      unit: entry.valid_units[0] || row.unit,
      category: entry.category || row.category,
      expiry_date: expiryDateFromDays(entry.expiry_days),
      estimated_expiry: true,
    })
  }

  // A user-typed/edited date is no longer an estimate, even if it started
  // out auto-filled from the catalog.
  const handleExpiryChange = (value: string) => {
    onChange({ ...row, expiry_date: value, estimated_expiry: false })
  }

  return (
    <div className="bg-white rounded-2xl border border-[var(--color-border)] p-3 space-y-2">
      {/* Row header: number + remove */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--color-muted)]">Item {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-[var(--color-muted)] hover:text-red-400 transition-colors px-2 py-0.5 rounded-full border border-[var(--color-border)] hover:border-red-200"
          aria-label={`Remove item ${index + 1}`}
        >
          ✕
        </button>
      </div>

      {/* Name — with catalog autocomplete (#398) */}
      <FoodAutocomplete
        value={row.name}
        onChange={(value) => set('name', value)}
        onSelect={handleCatalogSelect}
        placeholder="Item name (e.g. Milk, Eggs...)"
        ariaLabel="Item name"
        className={inputClass}
      />

      {/* Quantity + Unit */}
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          step="any"
          value={row.quantity}
          onChange={(e) => set('quantity', Number(e.target.value))}
          className="w-20 rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]"
          aria-label="Quantity"
        />
        <select
          value={row.unit}
          onChange={(e) => set('unit', e.target.value)}
          className="flex-1 rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]"
          aria-label="Unit"
        >
          {unitOptions.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      {/* Category (the kitchen-location select that used to sit beside it
          went with the on-hold kitchen scene — issue #397) */}
      <select
        value={row.category}
        onChange={(e) => set('category', e.target.value)}
        className={inputClass}
        aria-label="Category"
      >
        {categoryOptions.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      {/* Optional expiry */}
      <div>
        <label className="text-xs text-[var(--color-muted)] mb-1 block">
          Expiry date (optional)
          {row.estimated_expiry && row.expiry_date && (
            <span className="text-[var(--color-muted)]"> (est.)</span>
          )}
        </label>
        <input
          type="date"
          value={row.expiry_date}
          onChange={(e) => handleExpiryChange(e.target.value)}
          className={inputClass}
          aria-label="Expiry date"
        />
      </div>
    </div>
  )
}
