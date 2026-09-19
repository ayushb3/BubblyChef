'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import AddItemRow, { type ManualRow } from './AddItemRow'
import AddItemRowSummary from './AddItemRowSummary'
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

function isFilled(row: ManualRow): boolean {
  return row.name.trim().length > 0
}

export default function TypeTab({ onItemsReady }: TypeTabProps) {
  const [rows, setRows] = useState<ManualRow[]>([newRow()])
  // Which filled rows are shown as a compact summary instead of the full
  // form (issue #404). This is purely presentational — the row's actual
  // data always lives in `rows` above, so toggling membership here never
  // touches (or loses) a value. An id can sit in this set for a row that's
  // no longer filled (e.g. the user re-expanded it and cleared the name);
  // `isCollapsed` below re-checks `isFilled` on every render so an emptied
  // row is never hidden behind a summary that would mask its missing name.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  function toAddItems(updated: ManualRow[]): AddItem[] {
    return updated
      .filter((r) => r.name.trim().length > 0)
      .map(
        (r): ManualAddItem => ({
          name: r.name.trim(),
          quantity: r.quantity,
          unit: r.unit,
          category: r.category,
          storage_location: r.storage_location,
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
    const removedId = rows[index]?.id
    const next = rows.filter((_, i) => i !== index)
    if (removedId) {
      setCollapsedIds((prev) => {
        if (!prev.has(removedId)) return prev
        const nextSet = new Set(prev)
        nextSet.delete(removedId)
        return nextSet
      })
    }
    handleChange(next.length === 0 ? [newRow()] : next)
  }

  const handleAddRow = () => {
    // Collapse every currently-filled row into a summary — only the row
    // being added (and any still-empty row) stays fully expanded. Doesn't
    // touch `rows`/the item count; purely which rows render as a form.
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      rows.forEach((r) => {
        if (isFilled(r)) next.add(r.id)
      })
      return next
    })
    // Just append — new empty row doesn't affect parent item count
    setRows((prev) => [...prev, newRow()])
  }

  const handleExpand = (id: string) => {
    setCollapsedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const handleRowBlur = (row: ManualRow, e: React.FocusEvent<HTMLDivElement>) => {
    // A row that isn't filled has nothing to summarize and would hide its
    // own missing name behind a collapse — never auto-collapse it.
    if (!isFilled(row)) return
    const related = e.relatedTarget
    // Conservative: only collapse when we can confirm focus actually left
    // this row's container. An indeterminate relatedTarget (null) is left
    // alone rather than guessed at.
    if (!related || e.currentTarget.contains(related)) return
    setCollapsedIds((prev) => {
      if (prev.has(row.id)) return prev
      const next = new Set(prev)
      next.add(row.id)
      return next
    })
  }

  const validCount = rows.filter((r) => r.name.trim().length > 0).length

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted)] pb-1">
        Fill in each item below. Only rows with a name will be added.
      </p>

      {rows.map((row, i) => {
        const isCollapsed = collapsedIds.has(row.id) && isFilled(row)
        // Deliberately not `AnimatePresence` here: its exit animation only
        // resolves the swap once the outgoing child finishes animating out
        // and unmounts, which is the exact "unmount to animate" shape
        // `PantryAddSheet` avoids for its own Scan/Type crossfade. A row's
        // data lives in `rows` above regardless of which of these two
        // renders, so a plain conditional swap loses nothing — this just
        // fades the incoming child in, with no exit-blocked hand-off.
        return isCollapsed ? (
          <motion.div
            key={row.id}
            layout="position"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <AddItemRowSummary
              row={row}
              index={i}
              onExpand={() => handleExpand(row.id)}
              onRemove={() => handleRowRemove(i)}
            />
          </motion.div>
        ) : (
          <motion.div
            key={row.id}
            layout="position"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            onBlur={(e) => handleRowBlur(row, e)}
          >
            <AddItemRow
              row={row}
              index={i}
              onChange={(updated) => handleRowChange(i, updated)}
              onRemove={() => handleRowRemove(i)}
            />
          </motion.div>
        )
      })}

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
