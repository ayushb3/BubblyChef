'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ScannedItem } from '@/types/scan'
import { getFoodEmoji } from '@/lib/food-emoji'
import Chip from '@/components/ui/Chip'

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

function confidenceChipTone(confidence: number): 'fresh' | 'expiring' | 'muted' {
  if (confidence >= 0.8) return 'fresh'
  if (confidence >= 0.5) return 'expiring'
  return 'muted'
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return `${Math.round(confidence * 100)}% sure`
  if (confidence >= 0.5) return `${Math.round(confidence * 100)}% likely`
  return `${Math.round(confidence * 100)}% low`
}

interface ScannedItemCardProps {
  item: ScannedItem
  checked: boolean
  onChange: (updated: ScannedItem) => void
  onDismiss: () => void
  onCheckedChange: (checked: boolean) => void
  index?: number
}

export default function ScannedItemCard({
  item,
  checked,
  onChange,
  onDismiss,
  onCheckedChange,
  index = 0,
}: ScannedItemCardProps) {
  const [rawOpen, setRawOpen] = useState(false)

  function update<K extends keyof ScannedItem>(key: K, value: ScannedItem[K]) {
    onChange({ ...item, [key]: value })
  }

  const rawLabel = rawOpen ? 'Hide raw frame data' : 'See raw frame data'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-4 relative"
    >
      {/* Top-right controls: eye toggle + dismiss */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          type="button"
          aria-label={rawLabel}
          title={rawLabel}
          onClick={() => setRawOpen((o) => !o)}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        >
          {rawOpen ? (
            /* eye-slash icon */
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z"
                clipRule="evenodd"
              />
              <path d="M10.748 13.93l2.523 2.524a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
            </svg>
          ) : (
            /* eye icon */
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="w-4 h-4"
            >
              <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
              <path
                fillRule="evenodd"
                d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          aria-label={`Dismiss ${item.name}`}
          onClick={onDismiss}
          className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        >
          ×
        </button>
      </div>

      {/* Checkbox + confidence badge row */}
      <div className="flex items-center gap-2 mb-2 pr-16">
        <input
          type="checkbox"
          id={`scan-item-${index}-${item.name}`}
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          aria-label={`Include ${item.name}`}
          className="w-4 h-4 rounded accent-[var(--color-primary)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        />
        <Chip tone={confidenceChipTone(item.confidence)} size="sm">
          {confidenceLabel(item.confidence)}
        </Chip>
        {item.category && (
          <Chip tone="muted" size="sm">
            {item.category.replace('_', ' ')}
          </Chip>
        )}
      </div>

      {/* Name field */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg flex-shrink-0">{getFoodEmoji(item.name, item.category)}</span>
        <input
          type="text"
          aria-label="Item name"
          value={item.name}
          onChange={(e) => update('name', e.target.value)}
          className="flex-1 text-sm font-semibold text-[var(--color-text)] bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-primary)] pb-1 transition-colors focus-visible:outline-none"
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

      {/* Raw face — toggles open beneath the fields */}
      <AnimatePresence initial={false}>
        {rawOpen && (
          <motion.div
            key="raw-face"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-1">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1.5">
                Raw frame data
              </p>
              <div className="text-xs text-[var(--color-text)] space-y-1">
                <div className="flex gap-2">
                  <span className="text-[var(--color-muted)] w-24 flex-shrink-0">Receipt line</span>
                  <span className="font-mono break-all">{item.source_line || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[var(--color-muted)] w-24 flex-shrink-0">Parsed as</span>
                  <span className="font-mono break-all">{item.original_name || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[var(--color-muted)] w-24 flex-shrink-0">Price</span>
                  <span className="font-mono">
                    {item.price !== null && item.price !== undefined
                      ? `$${item.price.toFixed(2)}`
                      : '—'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[var(--color-muted)] w-24 flex-shrink-0">Confidence</span>
                  <span className="font-mono">{Math.round(item.confidence * 100)}%</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
