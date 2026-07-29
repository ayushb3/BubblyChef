'use client'

import { motion } from 'framer-motion'
import type { ScannedItem } from '@/types/scan'
import { getFoodEmoji } from '@/lib/food-emoji'

const CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'dry_goods',
  'condiments',
  'snacks',
  'beverages',
  'frozen',
  'other',
]

const LOCATIONS = ['fridge', 'freezer', 'pantry', 'counter']

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-100 text-green-700'
  if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-700'
  return 'bg-gray-100 text-gray-500'
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return `${Math.round(confidence * 100)}% sure`
  if (confidence >= 0.5) return `${Math.round(confidence * 100)}% likely`
  return `${Math.round(confidence * 100)}% low`
}

interface ScannedItemCardProps {
  item: ScannedItem
  onChange: (updated: ScannedItem) => void
  onDismiss: () => void
  index?: number
}

export default function ScannedItemCard({
  item,
  onChange,
  onDismiss,
  index = 0,
}: ScannedItemCardProps) {
  function update<K extends keyof ScannedItem>(key: K, value: ScannedItem[K]) {
    onChange({ ...item, [key]: value })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-4 relative"
    >
      {/* Dismiss button */}
      <button
        type="button"
        aria-label={`Dismiss ${item.name}`}
        onClick={onDismiss}
        className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors text-sm font-bold"
      >
        ×
      </button>

      {/* Confidence badge */}
      <span
        className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${confidenceColor(item.confidence)}`}
      >
        {confidenceLabel(item.confidence)}
      </span>

      {/* Name field */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg flex-shrink-0">{getFoodEmoji(item.name, item.category)}</span>
        <input
          type="text"
          aria-label="Item name"
          value={item.name}
          onChange={(e) => update('name', e.target.value)}
          className="flex-1 text-sm font-semibold text-[var(--color-text)] bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-primary)] pb-1 transition-colors"
          placeholder="Item name"
        />
      </div>

      {/* Quantity + Unit row */}
      <div className="flex gap-2 mb-2">
        <div className="flex-1">
          <label className="block text-xs text-[var(--color-muted)] mb-1">Qty</label>
          <input
            type="number"
            aria-label="Quantity"
            value={item.quantity}
            min={0}
            step={0.1}
            onChange={(e) => update('quantity', parseFloat(e.target.value) || 0)}
            className="w-full text-sm text-[var(--color-text)] bg-[var(--color-bg,#FFF0F5)] border border-[var(--color-border)] rounded-xl px-2 py-1.5 focus:border-[var(--color-primary)] transition-colors"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-[var(--color-muted)] mb-1">Unit</label>
          <input
            type="text"
            aria-label="Unit"
            value={item.unit}
            onChange={(e) => update('unit', e.target.value)}
            className="w-full text-sm text-[var(--color-text)] bg-[var(--color-bg,#FFF0F5)] border border-[var(--color-border)] rounded-xl px-2 py-1.5 focus:border-[var(--color-primary)] transition-colors"
            placeholder="pcs, g, ml…"
          />
        </div>
      </div>

      {/* Category + Location row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-[var(--color-muted)] mb-1">Category</label>
          <select
            aria-label="Category"
            value={item.category}
            onChange={(e) => update('category', e.target.value)}
            className="w-full text-sm text-[var(--color-text)] bg-[var(--color-bg,#FFF0F5)] border border-[var(--color-border)] rounded-xl px-2 py-1.5 focus:border-[var(--color-primary)] transition-colors"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-[var(--color-muted)] mb-1">Location</label>
          <select
            aria-label="Location"
            value={item.location}
            onChange={(e) => update('location', e.target.value)}
            className="w-full text-sm text-[var(--color-text)] bg-[var(--color-bg,#FFF0F5)] border border-[var(--color-border)] rounded-xl px-2 py-1.5 focus:border-[var(--color-primary)] transition-colors"
          >
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
    </motion.div>
  )
}
