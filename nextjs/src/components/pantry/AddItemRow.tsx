'use client'

export interface ManualRow {
  id: string
  name: string
  quantity: number
  unit: string
  category: string
  storage_location: string
  expiry_date: string
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

const LOCATIONS = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'counter', label: 'Counter' },
]

interface AddItemRowProps {
  row: ManualRow
  onChange: (updated: ManualRow) => void
  onRemove: () => void
  index: number
}

const inputClass =
  'w-full rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]'

export default function AddItemRow({ row, onChange, onRemove, index }: AddItemRowProps) {
  const set = (field: keyof ManualRow, value: string | number) =>
    onChange({ ...row, [field]: value })

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

      {/* Name */}
      <input
        type="text"
        value={row.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder="Item name (e.g. Milk, Eggs...)"
        className={inputClass}
        aria-label="Item name"
      />

      {/* Quantity + Unit */}
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          step="any"
          value={row.quantity}
          onChange={(e) => set('quantity', Number(e.target.value))}
          className="w-20 rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
          aria-label="Quantity"
        />
        <select
          value={row.unit}
          onChange={(e) => set('unit', e.target.value)}
          className="flex-1 rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
          aria-label="Unit"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      {/* Category + Location */}
      <div className="flex gap-2">
        <select
          value={row.category}
          onChange={(e) => set('category', e.target.value)}
          className="flex-1 rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
          aria-label="Category"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={row.storage_location}
          onChange={(e) => set('storage_location', e.target.value)}
          className="flex-1 rounded-xl px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)]"
          aria-label="Storage location"
        >
          {LOCATIONS.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Optional expiry */}
      <div>
        <label className="text-xs text-[var(--color-muted)] mb-1 block">Expiry date (optional)</label>
        <input
          type="date"
          value={row.expiry_date}
          onChange={(e) => set('expiry_date', e.target.value)}
          className={inputClass}
          aria-label="Expiry date"
        />
      </div>
    </div>
  )
}
