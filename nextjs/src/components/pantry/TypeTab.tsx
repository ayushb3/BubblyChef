'use client'

import { useState } from 'react'
import AddItemRow, { type ManualRow } from './AddItemRow'
import type { AddItem } from './PantryAddSheet'

function newRow(): ManualRow {
  return {
    id: crypto.randomUUID(),
    name: '',
    quantity: 1,
    unit: 'item',
    category: 'other',
    expiry_date: '',
    estimated_expiry: false,
  }
}

interface TypeTabProps {
  onItemsReady: (items: AddItem[]) => void
}

/**
 * `AddItem` (owned by `PantryAddSheet`) doesn't declare `estimated_expiry` —
 * we don't touch that file (issue #402's tab-persistence fix just landed
 * there). This local extension lets the object literal below legally carry
 * the field at the type level; `PantryAddSheet`'s `{ source, ...rest }`
 * spread forwards it at runtime regardless of what `AddItem` declares, and
 * `BulkAddItem` (lib/api/pantry.ts) declares it as optional so the eventual
 * `bulkAddPantryItems` call still type-checks.
 */
interface ManualAddItem extends AddItem {
  estimated_expiry: boolean
}

export default function TypeTab({ onItemsReady }: TypeTabProps) {
  const [rows, setRows] = useState<ManualRow[]>([newRow()])

  function toAddItems(updated: ManualRow[]): AddItem[] {
    return updated
      .filter((r) => r.name.trim().length > 0)
      .map(
        (r): ManualAddItem => ({
          name: r.name.trim(),
          quantity: r.quantity,
          unit: r.unit,
          category: r.category,
          // No kitchen location is sent (issue #397); the bulk route stores
          // its own default for the column.
          expiry_date: r.expiry_date || null,
          source: 'manual' as const,
          // Only meaningful when a date is actually present.
          estimated_expiry: Boolean(r.expiry_date) && r.estimated_expiry,
        }),
      )
  }

  const handleChange = (updated: ManualRow[]) => {
    setRows(updated)
    onItemsReady(toAddItems(updated))
  }

  const handleRowChange = (index: number, updated: ManualRow) => {
    handleChange(rows.map((r, i) => (i === index ? updated : r)))
  }

  const handleRowRemove = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    handleChange(next.length === 0 ? [newRow()] : next)
  }

  const handleAddRow = () => {
    // Just append — new empty row doesn't affect parent item count
    setRows((prev) => [...prev, newRow()])
  }

  const validCount = rows.filter((r) => r.name.trim().length > 0).length

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted)] pb-1">
        Fill in each item below. Only rows with a name will be added.
      </p>

      {rows.map((row, i) => (
        <AddItemRow
          key={row.id}
          row={row}
          index={i}
          onChange={(updated) => handleRowChange(i, updated)}
          onRemove={() => handleRowRemove(i)}
        />
      ))}

      <button
        type="button"
        onClick={handleAddRow}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-[var(--color-border)] text-sm text-[var(--color-muted)] font-semibold hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors active:scale-95"
      >
        + Add another item
      </button>

      {validCount > 0 && (
        <p className="text-xs text-center text-[var(--color-muted)]">
          {validCount} item{validCount !== 1 ? 's' : ''} ready to add
        </p>
      )}
    </div>
  )
}
