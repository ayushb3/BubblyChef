'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'

interface PantryItemData {
  id: string
  name: string
  category: string
  location: string
  quantity: number
  unit: string
  expiry_date: string | null
}

interface AddItemModalProps {
  isOpen: boolean
  onClose: () => void
  editItem?: PantryItemData | null
}

interface FoodSuggestion {
  canonical_name: string
  category?: string
  default_location?: string
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

const LOCATIONS = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'freezer', label: 'Freezer' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'counter', label: 'Counter' },
]

const UNIT_SUGGESTIONS = ['item', 'lb', 'oz', 'kg', 'gallon', 'cup', 'dozen']

export default function AddItemModal({ isOpen, onClose, editItem }: AddItemModalProps) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState('item')
  const [category, setCategory] = useState('other')
  const [location, setLocation] = useState('pantry')
  const [expiryDate, setExpiryDate] = useState('')
  const [suggestions, setSuggestions] = useState<FoodSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEditMode = !!editItem

  // Populate form when editing
  useEffect(() => {
    if (editItem) {
      setName(editItem.name)
      setQuantity(editItem.quantity)
      setUnit(editItem.unit)
      setCategory(editItem.category || 'other')
      setLocation(editItem.location || 'pantry')
      setExpiryDate(editItem.expiry_date ?? '')
    } else {
      setName('')
      setQuantity(1)
      setUnit('item')
      setCategory('other')
      setLocation('pantry')
      setExpiryDate('')
    }
    setConfirmDelete(false)
    setSuggestions([])
  }, [editItem, isOpen])

  // Food typeahead
  const handleNameChange = (value: string) => {
    setName(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.length < 1) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/foods/search?q=${encodeURIComponent(value)}&limit=6`)
        if (res.ok) {
          const data = await res.json()
          setSuggestions(data.items ?? data ?? [])
          setShowSuggestions(true)
        }
      } catch {
        setSuggestions([])
      }
    }, 300)
  }

  const selectSuggestion = (s: FoodSuggestion) => {
    setName(s.canonical_name)
    if (s.category) setCategory(s.category)
    if (s.default_location) setLocation(s.default_location)
    setShowSuggestions(false)
    setSuggestions([])
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (isEditMode && editItem) {
        await fetch(`/api/pantry/${editItem.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            quantity,
            unit,
            category,
            location,
            expiry_date: expiryDate || null,
          }),
        })
      } else {
        await fetch('/api/pantry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            quantity,
            unit,
            category,
            storage_location: location,
            expiry_date: expiryDate || null,
          }),
        })
      }
      onClose()
    } catch {
      // silent — user can retry
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editItem) return
    setSaving(true)
    try {
      await fetch(`/api/pantry/${editItem.id}`, { method: 'DELETE' })
      onClose()
    } catch {
      // silent
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
            className="fixed inset-0 bg-black/40 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto"
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
              <h2 className="text-lg font-extrabold text-[var(--color-text)] mb-4">
                {isEditMode ? 'Edit Item' : 'Add Item'} ✏️
              </h2>

              {/* Name with typeahead */}
              <div className="mb-3 relative">
                <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder="e.g., Milk, Eggs, Rice..."
                  className="focus-ring w-full rounded-xl px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[var(--color-border)] rounded-xl shadow-lg z-10 overflow-hidden">
                    {suggestions.map((s) => (
                      <button
                        key={s.canonical_name}
                        type="button"
                        onMouseDown={() => selectSuggestion(s)}
                        // Inset: this dropdown clips overflow, so an outward ring
                        // would be cut off at the panel edge.
                        className="focus-ring-inset w-full text-left px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-primary)]/10 transition-colors"
                      >
                        {s.canonical_name}
                        {s.category && (
                          <span className="text-xs text-[var(--color-muted)] ml-2">({s.category})</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
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
                    className="focus-ring w-full rounded-xl px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Unit</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    list="unit-suggestions"
                    className="focus-ring w-full rounded-xl px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]"
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
                  className="focus-ring w-full rounded-xl px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div className="mb-3">
                <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Storage Location</label>
                <div className="flex gap-2">
                  {LOCATIONS.map((loc) => (
                    <button
                      key={loc.value}
                      type="button"
                      onClick={() => setLocation(loc.value)}
                      className={`focus-ring flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        location === loc.value
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]'
                      }`}
                    >
                      {loc.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expiry Date */}
              <div className="mb-5">
                <label className="text-xs font-semibold text-[var(--color-muted)] mb-1 block">Expiry Date</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="focus-ring w-full rounded-xl px-4 py-2.5 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm focus:border-[var(--color-primary)]"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                {isEditMode && (
                  <>
                    {confirmDelete ? (
                      <div className="flex gap-2 flex-1">
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={saving}
                          className="focus-ring flex-1 py-2.5 rounded-full bg-red-400 text-white text-sm font-semibold disabled:opacity-50"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="focus-ring flex-1 py-2.5 rounded-full bg-[var(--color-surface)] text-[var(--color-text)] text-sm font-semibold border border-[var(--color-border)]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="focus-ring py-2.5 px-4 rounded-full text-red-400 text-sm font-semibold border border-red-300"
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}

                {!confirmDelete && (
                  <SpringButton
                    onClick={handleSubmit}
                    disabled={saving || !name.trim()}
                    className="flex-1 bg-[var(--color-primary)] text-white font-semibold py-2.5 rounded-full disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Add to Pantry'}
                  </SpringButton>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
