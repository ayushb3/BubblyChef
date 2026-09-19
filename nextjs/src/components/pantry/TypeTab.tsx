'use client'

import { useEffect, useState } from 'react'
import AddItemRow, { type ManualRow } from './AddItemRow'
import type { AddItem } from './PantryAddSheet'

function newRow(): ManualRow {
  return {
    id: crypto.randomUUID(),
    name: '',
    quantity: 1,
    unit: 'item',
    category: 'other',
    storage_location: 'pantry',
    expiry_date: '',
  }
}

interface TypeTabProps {
  onItemsReady: (items: AddItem[]) => void
  /**
   * Rows to seed the tab with on mount — lets a parent hand back a draft
   * that survived a previous unmount (e.g. a tab switch, issue #402).
   * Falls back to a single empty row when absent/empty.
   */
  initialRows?: ManualRow[]
  /** Fired alongside onItemsReady with the full row list (including empty/partial rows), so a parent can persist it across an unmount. */
  onRowsChange?: (rows: ManualRow[]) => void
}

export default function TypeTab({ onItemsReady, initialRows, onRowsChange }: TypeTabProps) {
  const [rows, setRows] = useState<ManualRow[]>(
    initialRows && initialRows.length > 0 ? initialRows : [newRow()],
  )

  function toAddItems(updated: ManualRow[]): AddItem[] {
    return updated
      .filter((r) => r.name.trim().length > 0)
      .map((r) => ({
        name: r.name.trim(),
        quantity: r.quantity,
        unit: r.unit,
        category: r.category,
        storage_location: r.storage_location,
        expiry_date: r.expiry_date || null,
        source: 'manual' as const,
      }))
  }

  // Report the restored draft's contribution to the parent's "ready to add"
  // count as soon as it mounts, not only on the next edit — otherwise a
  // draft that survived a tab switch (issue #402) shows valid data with a
  // count of zero and a disabled footer until the user touches a field.
  useEffect(() => {
    onItemsReady(toAddItems(rows))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (updated: ManualRow[]) => {
    setRows(updated)
    onRowsChange?.(updated)
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
    // New empty row doesn't affect parent item count, but still needs to be
    // persisted so it survives a tab switch (issue #402).
    setRows((prev) => {
      const next = [...prev, newRow()]
      onRowsChange?.(next)
      return next
    })
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
