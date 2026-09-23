'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import FoodAutocomplete from '@/components/pantry/FoodAutocomplete'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'
import { updatePantryItem, deletePantryItem } from '@/lib/api/pantry'
import type { FoodCatalogEntry } from '@/lib/api/foods'
import type { PantryItem } from '@/types/pantry'

/**
 * EditItemModal — the single-item edit sheet on `/pantry`.
 *
 * Despite the filename (kept as `AddItemModal.tsx` so the focus-trap test and
 * the count guard that reads test names textually are undisturbed), this is
 * an edit surface only. Adding goes through `PantryAddSheet` — the "+ Add
 * Item" FAB has always opened that, and the only thing that opens this modal
 * is tapping an existing pantry card. The old add branch (`POST /api/pantry`)
 * was unreachable and has been removed (issue #478). It is also the only
 * place in the app that updates or plainly deletes a single item, which is
 * why it survives at all.
 *
 * There is no kitchen-location control here (issue #397): the field only fed
 * the on-hold kitchen scene (PR #124). The item's stored location is left as
 * it is — the update omits the key rather than rewriting it.
 */

interface EditItemModalProps {
  isOpen: boolean
  onClose: () => void
  /** The item being edited. `null` only while the sheet is closed. */
  editItem: PantryItem | null
}

const CATEGORIES = [
  { value: 'produce', label: 'Produce 🥬' },
  { value: 'dairy', label: 'Dairy 🧈' },
  { value: 'meat', label: 'Meat 🍗' },
  { value: 'dry_goods', label: 'Dry Goods 🌾' },
  { value: 'condiments', label: 'Condiments 🧂' },
  { value: 'snacks', label: 'Snacks 🍿' },
  { value: 'beverages', label: 'Beverages 🥤' },
  { value: 'frozen', label: 'Frozen 🧊' },
  { value: 'other', label: 'Other 📦' },
]

const UNIT_SUGGESTIONS = ['item', 'lb', 'oz', 'kg', 'gallon', 'cup', 'dozen']

const fieldClass =
  'w-full rounded-xl px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]'

export default function EditItemModal({ isOpen, onClose, editItem }: EditItemModalProps) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState('item')
  const [category, setCategory] = useState('other')
  const [expiryDate, setExpiryDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(isOpen, onClose, panelRef)

  // Populate the form from the item every time the sheet opens.
  useEffect(() => {
    if (editItem) {
      setName(editItem.name)
      setQuantity(editItem.quantity)
      setUnit(editItem.unit)
      setCategory(editItem.category || 'other')
      setExpiryDate(editItem.expiry_date ?? '')
    }
    setConfirmDelete(false)
    setError(null)
  }, [editItem, isOpen])

  // A stored category the catalog uses but this fixed list predates (e.g.
  // "seafood", "canned", "bakery") still needs a matching <option>, or the
  // <select> silently shows the first entry and a save would rewrite the
  // category to "produce". Same fold-in as AddItemRow (#398).
  const categoryOptions = CATEGORIES.some((c) => c.value === category)
    ? CATEGORIES
    : [{ value: category, label: category }, ...CATEGORIES]

  // Picking a catalog suggestion (the response-shape fix for #478 — the old
  // hand-rolled typeahead read `data.items` from a route that returns
  // `data.results`, so it never showed anything) fills in name and category.
  // Quantity, unit and expiry are left alone: this is an existing item being
  // corrected, not a fresh one, so what the user already recorded is more
  // trustworthy than a catalog default. The catalog's `default_location` is
  // ignored — there is no location field to fill (#397).
  const handleCatalogSelect = (entry: FoodCatalogEntry) => {
    setName(entry.canonical)
    if (entry.category) setCategory(entry.category)
  }

  // Every write path below keeps the modal open on failure. It used to close
  // unconditionally and swallow the error, so a 401/409/500 was indistinguishable
  // from a successful save and the item silently never appeared (#240).
  const handleSubmit = async () => {
    if (!editItem || !name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await updatePantryItem(editItem.id, {
        name: name.trim(),
        quantity,
        unit,
        category,
        expiry_date: expiryDate || null,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that item. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editItem) return
    setSaving(true)
    setError(null)
    try {
      await deletePantryItem(editItem.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that item. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/40 z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-item-modal-title"
            tabIndex={-1}
            className="fixed bottom-0 left-0 right-0 z-[60] bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto outline-none"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            </div>

            <div className="px-6 pb-8">
              <h2 id="edit-item-modal-title" className="text-lg font-extrabold text-[var(--color-text)] mb-4">
                Edit Item ✏️
              </h2>

              {/* Name — with catalog autocomplete (#398, #478) */}
              <div className="mb-3">
                <label
                  htmlFor="edit-item-name"
                  className="text-xs font-semibold text-[var(--color-muted)] mb-1 block"
                >
                  Name
                </label>
                <FoodAutocomplete
                  id="edit-item-name"
                  value={name}
                  onChange={setName}
                  onSelect={handleCatalogSelect}
                  placeholder="e.g., Milk, Eggs, Rice..."
                  ariaLabel="Item name"
                  className={fieldClass}
                />
              </div>

              {/* Quantity + Unit row */}
              <div className="flex gap-3 mb-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Quantity</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className={fieldClass}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Unit</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    list="unit-suggestions"
                    className={fieldClass}
                  />
                  <datalist id="unit-suggestions">
                    {UNIT_SUGGESTIONS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Category */}
              <div className="mb-3">
                <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={fieldClass}
                >
                  {categoryOptions.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Expiry Date */}
              <div className="mb-5">
                <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Expiry Date</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="mb-3 text-xs font-semibold text-red-500 text-center"
                >
                  {error}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                {confirmDelete ? (
                  <div className="flex gap-2 flex-1">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={saving}
                      className="flex-1 py-2.5 rounded-full bg-red-400 text-white text-sm font-semibold disabled:opacity-50"
                    >
                      Confirm Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-2.5 rounded-full bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-semibold border border-[var(--color-border)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="py-2.5 px-4 rounded-full text-red-400 text-sm font-semibold border border-red-300"
                    >
                      Delete
                    </button>
                    <SpringButton
                      onClick={handleSubmit}
                      disabled={saving || !name.trim()}
                      className="flex-1 bg-[var(--color-primary)] text-white font-semibold py-2.5 rounded-full disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </SpringButton>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
