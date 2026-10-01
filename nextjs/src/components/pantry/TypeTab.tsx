'use client'

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import AddItemRow, { type ManualRow } from './AddItemRow'
import AddItemRowSummary from './AddItemRowSummary'
import type { AddItem } from './PantryAddSheet'
import { parsePantryList, splitPantryList } from '@/lib/pantry-quick-add'

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
  // The row the user just re-expanded; its name field takes focus on mount.
  const [focusRowId, setFocusRowId] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)

  function toAddItems(updated: ManualRow[]): AddItem[] {
    return updated
      .filter((r) => r.name.trim().length > 0)
      .map(
        (r): ManualAddItem => ({
          name: r.name.trim(),
          quantity: r.quantity,
          unit: r.unit,
          category: r.category,
          // Only a catalog pick carries a location (issue #397); a freehand
          // name omits it and the bulk route stores its own default.
          ...(r.storage_location ? { storage_location: r.storage_location } : {}),
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

  // Issue #851: a list typed into the name field ("eggs, milk, 2 lb chicken") becomes
  // one review row per piece, each with its own quantity and unit. Run when the
  // user leaves the field or presses Enter, never mid-keystroke, so nothing splits
  // under their cursor. A single entry ("2 lb chicken") is read the same way, but
  // only while the row's quantity and unit are still the defaults and the name is
  // freehand (a catalog pick carries a location): a hand-set amount always wins.
  // Returns whether it replaced the row.
  const splitListRow = (row: ManualRow): boolean => {
    const at = rows.findIndex((r) => r.id === row.id)
    if (at < 0) return false
    const pieces = splitPantryList(row.name)
    const untouched = row.quantity === 1 && row.unit === 'item' && !row.storage_location
    if (pieces.length === 0 || (pieces.length === 1 && !untouched)) return false
    const parsed = parsePantryList(row.name)
    if (
      parsed.length === 1 &&
      parsed[0].name === row.name.trim() &&
      parsed[0].quantity === 1 &&
      parsed[0].unit === 'item'
    ) {
      return false // nothing to read out of it
    }
    const fresh: ManualRow[] = parsed.map((p) => ({
      ...newRow(),
      name: p.name,
      quantity: p.quantity,
      unit: p.unit,
    }))
    // Review rows start as compact summaries (tap to edit), like any filled row.
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      next.delete(row.id)
      fresh.forEach((r) => next.add(r.id))
      return next
    })
    handleChange([...rows.slice(0, at), ...fresh, ...rows.slice(at + 1)])
    return true
  }

  const handleNameKeyDown = (row: ManualRow, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return
    if (!(e.target instanceof HTMLInputElement) || e.target.getAttribute('aria-label') !== 'Item name') return
    if (splitListRow(row)) e.preventDefault()
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
    setFocusRowId(id)
    setCollapsedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const handleRowBlur = (row: ManualRow, e: React.FocusEvent<HTMLDivElement>) => {
    // Only the name field turns typed text into rows; other fields leaving is just a blur.
    if (
      e.target instanceof HTMLInputElement &&
      e.target.getAttribute('aria-label') === 'Item name' &&
      splitListRow(row)
    ) {
      return
    }
    // A row that isn't filled has nothing to summarize and would hide its
    // own missing name behind a collapse — never auto-collapse it.
    if (!isFilled(row)) return
    const related = e.relatedTarget
    // Conservative: only collapse when we can confirm focus actually left
    // this row's container. An indeterminate relatedTarget (null) is left
    // alone rather than guessed at.
    if (!related || e.currentTarget.contains(related)) return
    // Focus is moving to "+ Add another item", whose click collapses filled rows
    // itself. Collapsing here, on the press, would shrink the layout under
    // the pointer before the release lands.
    if (related === addButtonRef.current) return
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
        Fill in each item below, or type a list like “eggs, milk, 2 lb chicken” in the name. Only rows with a name will be added.
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
            onKeyDown={(e) => handleNameKeyDown(row, e)}
          >
            <AddItemRow
              row={row}
              index={i}
              onChange={(updated) => handleRowChange(i, updated)}
              onRemove={() => handleRowRemove(i)}
              autoFocusName={focusRowId === row.id}
            />
          </motion.div>
        )
      })}

      <button
        ref={addButtonRef}
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
