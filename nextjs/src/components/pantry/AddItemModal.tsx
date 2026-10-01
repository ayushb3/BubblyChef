'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { addPantryItemToMyGroceryList } from '@/lib/grocery-add'
import SpringButton from '@/components/ui/SpringButton'
import FoodAutocomplete from '@/components/pantry/FoodAutocomplete'
import PixelSheet from '@/components/ui/PixelSheet'
import { updatePantryItem, deletePantryItem } from '@/lib/api/pantry'
import type { FoodCatalogEntry } from '@/lib/api/foods'
import { PLACES, placeForLocation, placeLocation, type PlaceKey } from '@/lib/kitchen/places'
import type { PantryItem } from '@/types/pantry'

/**
 * EditItemModal — the single-item edit sheet, opened from the storage sheet on the kitchen home.
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
 * The Place field (issue #749) is back: Fridge / Freezer / Shelves / Basket, the
 * four storage places of the kitchen wall. Issue #397 had removed the old
 * location control while the gamified kitchen was on hold; now the places are
 * the home screen, so moving an item between them is one tap here. It saves
 * `location` only when the user changed the place: an item whose stored value
 * is not one of the four (it reads as Shelves) is not rewritten by an
 * unrelated edit.
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
  const [place, setPlace] = useState<PlaceKey>('shelves')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // "Add to grocery list" (#497): where that button is. `message` is the failure's words.
  const [listState, setListState] = useState<{
    kind: 'idle' | 'adding' | 'added' | 'error'
    message?: string
  }>({ kind: 'idle' })

  // Populate the form from the item every time the sheet opens.
  useEffect(() => {
    if (editItem) {
      setName(editItem.name)
      setQuantity(editItem.quantity)
      setUnit(editItem.unit)
      setCategory(editItem.category || 'other')
      setExpiryDate(editItem.expiry_date ?? '')
      setPlace(placeForLocation(editItem.location))
    }
    setConfirmDelete(false)
    setError(null)
    setListState({ kind: 'idle' })
  }, [editItem, isOpen])

  // Puts the saved food on this browser's grocery list (#497). It reads the
  // pantry row, not the form: unsaved edits are not what the user is shopping for.
  const handleAddToList = async () => {
    if (!editItem) return
    setListState({ kind: 'adding' })
    try {
      await addPantryItemToMyGroceryList(editItem)
      setListState({ kind: 'added' })
    } catch (err) {
      setListState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Couldn’t add it to your grocery list.',
      })
    }
  }

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
  // ignored for the same reason: the place is wherever the item already lives.
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
        // Only a place the user changed is written (see the header note).
        ...(place !== placeForLocation(editItem.location)
          ? { location: placeLocation(place) }
          : {}),
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
    <PixelSheet
      open={isOpen}
      onClose={onClose}
      title="Edit Item ✏️"
      titleId="edit-item-modal-title"
      // Land on the name field, as the trap did before the sheet owned it.
      initialFocus="#edit-item-name"
      footer={
        <>
          {error && (
            <p
              role="alert"
              className="mb-2 text-xs font-semibold text-red-500 text-center"
            >
              {error}
            </p>
          )}
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
        </>
      }
    >
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

      {/* Place (#749): native radios, so the arrow keys and the group's name
          come for free; the labels are the 44px targets. */}
      <fieldset className="mb-3 min-w-0">
        <legend className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Place</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {PLACES.map((p) => (
            <label key={p.key} className="relative block">
              <input
                type="radio"
                name="edit-item-place"
                value={p.key}
                checked={place === p.key}
                onChange={() => setPlace(p.key)}
                className="peer sr-only"
              />
              <span
                className="flex min-h-[44px] items-center justify-center rounded-full border-2 border-[color:var(--color-text)] px-1 text-[13px] font-extrabold text-[color:var(--color-text)] peer-checked:bg-[var(--color-primary)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--color-text)]"
              >
                {p.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

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
      <div className="mb-4">
        <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Expiry Date</label>
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className={fieldClass}
        />
      </div>

      {/* Add to the grocery list (#497): every pantry row can go on it from here. */}
      <div className="mb-2 flex flex-col items-start gap-2">
        <SpringButton
          variant="secondary"
          size="sm"
          onClick={handleAddToList}
          loading={listState.kind === 'adding'}
          disabled={listState.kind === 'adding'}
          className="px-4"
        >
          <span aria-hidden="true">🛒 </span>
          Add to grocery list
        </SpringButton>
        {listState.kind === 'added' && (
          <p role="status" className="text-[13px] font-bold text-[color:var(--color-text)]">
            Added to your grocery list.{' '}
            <Link href="/grocery" className="font-extrabold underline underline-offset-[3px]">
              View list
            </Link>
          </p>
        )}
        {listState.kind === 'error' && (
          <p role="alert" className="text-[13px] font-bold text-[var(--color-expired-text)]">
            {listState.message}
          </p>
        )}
      </div>
    </PixelSheet>
  )
}
