'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ScannedItem } from '@/types/scan'
import ScannedItemCard from './ScannedItemCard'
import Chip from '@/components/ui/Chip'
import type { ChipTone } from '@/components/ui/Chip'

/**
 * ReviewSurface — presentation-only receipt review surface.
 *
 * Takes a parsed proposal (ready_to_add, needs_review, skipped items) and callbacks.
 * Owns no fetching, routing, or upload state — purely renders the review UI and
 * emits edits/selection/confirm events.
 *
 * Reusable across:
 * - Receipt scanning (ScanTab sheet, /scan route)
 * - Chat image upload (#254)
 * - Other document review flows
 */

interface ReviewSurfaceProps {
  readyToAdd: ScannedItem[]
  needsReview: ScannedItem[]
  skipped: ScannedItem[]
  warnings?: string[]
  onReadyChange: (items: ScannedItem[]) => void
  onReviewChange: (items: ScannedItem[]) => void
  onSkippedChange: (items: ScannedItem[]) => void
  onConfirm: (checkedItems: ScannedItem[]) => void
  isSubmitting: boolean
  /** When true, hides the built-in confirm button (used when embedded in sheets) */
  hideConfirmButton?: boolean
}

// ─── Stable item key ──────────────────────────────────────────────────────────
// source_line is unique per receipt OCR row; fall back to name+index.
function itemKey(item: ScannedItem, index: number): string {
  return item.source_line || `${item.name}-${index}`
}

// ─── Tier header pill ─────────────────────────────────────────────────────────
interface TierHeaderProps {
  label: string
  emoji: string
  count: number
  tone: ChipTone
  open: boolean
  onToggle: () => void
}

function TierHeader({ label, emoji, count, tone, open, onToggle }: TierHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${label} section, ${count} item${count !== 1 ? 's' : ''}`}
      className="w-full flex items-center justify-between mb-2 transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] rounded-full"
    >
      <Chip tone={tone} size="md" emoji={emoji}>
        {label} ({count})
      </Chip>
      <motion.span
        animate={{ rotate: open ? 0 : -90 }}
        transition={{ duration: 0.2 }}
        className="text-xs text-[var(--color-muted)] pr-1"
        aria-hidden
      >
        ▼
      </motion.span>
    </button>
  )
}

// ─── Tier section ─────────────────────────────────────────────────────────────
interface TierSectionProps {
  label: string
  emoji: string
  tone: ChipTone
  items: ScannedItem[]
  checkedKeys: Set<string>
  defaultOpen?: boolean
  globalOffset: number
  onItemChange: (index: number, updated: ScannedItem) => void
  onItemDismiss: (index: number) => void
  onCheckedChange: (key: string, checked: boolean) => void
}

function TierSection({
  label,
  emoji,
  tone,
  items,
  checkedKeys,
  defaultOpen = true,
  globalOffset,
  onItemChange,
  onItemDismiss,
  onCheckedChange,
}: TierSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-4">
      <TierHeader
        label={label}
        emoji={emoji}
        count={items.length}
        tone={tone}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />

      <AnimatePresence initial={false}>
        {open && items.length > 0 && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="mt-2 space-y-2">
              {items.map((item, i) => {
                const key = itemKey(item, globalOffset + i)
                return (
                  <ScannedItemCard
                    key={key}
                    item={item}
                    index={i}
                    checked={checkedKeys.has(key)}
                    onChange={(updated) => onItemChange(i, updated)}
                    onDismiss={() => onItemDismiss(i)}
                    onCheckedChange={(c) => onCheckedChange(key, c)}
                  />
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {open && items.length === 0 && (
        <p className="text-xs text-[var(--color-muted)] text-center py-3 opacity-60">
          All items dismissed
        </p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ReviewSurface({
  readyToAdd,
  needsReview,
  skipped,
  warnings = [],
  onReadyChange,
  onReviewChange,
  onSkippedChange,
  onConfirm,
  isSubmitting,
  hideConfirmButton = false,
}: ReviewSurfaceProps) {
  // Seed: ready_to_add items start checked; needs_review and skipped start unchecked.
  const initialCheckedKeys = useMemo(() => {
    const keys = new Set<string>()
    readyToAdd.forEach((item, i) => keys.add(itemKey(item, i)))
    return keys
    // We only want the seed once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(initialCheckedKeys)

  function toggleKey(key: string, checked: boolean) {
    setCheckedKeys((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  // Remove a key from the checked set when its item is dismissed.
  function dismissKey(key: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  function removeAt(list: ScannedItem[], i: number): ScannedItem[] {
    return list.filter((_, idx) => idx !== i)
  }
  function replaceAt(list: ScannedItem[], i: number, item: ScannedItem): ScannedItem[] {
    return list.map((el, idx) => (idx === i ? item : el))
  }

  // Collect all currently-visible checked items in tier order for the confirm handler.
  const checkedItems = useMemo(() => {
    const allWithKeys: Array<{ key: string; item: ScannedItem }> = [
      ...readyToAdd.map((item, i) => ({ key: itemKey(item, i), item })),
      ...needsReview.map((item, i) => ({
        key: itemKey(item, readyToAdd.length + i),
        item,
      })),
      ...skipped.map((item, i) => ({
        key: itemKey(item, readyToAdd.length + needsReview.length + i),
        item,
      })),
    ]
    return allWithKeys.filter(({ key }) => checkedKeys.has(key)).map(({ item }) => item)
  }, [readyToAdd, needsReview, skipped, checkedKeys])

  const checkedCount = checkedItems.length

  return (
    <div>
      {/* Warnings banner */}
      {warnings.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-2xl text-sm space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {readyToAdd.length > 0 && (
        <TierSection
          label="Ready to Add"
          emoji="✅"
          tone="fresh"
          items={readyToAdd}
          checkedKeys={checkedKeys}
          defaultOpen={true}
          globalOffset={0}
          onItemChange={(i, updated) => onReadyChange(replaceAt(readyToAdd, i, updated))}
          onItemDismiss={(i) => {
            const key = itemKey(readyToAdd[i], i)
            dismissKey(key)
            onReadyChange(removeAt(readyToAdd, i))
          }}
          onCheckedChange={toggleKey}
        />
      )}

      {needsReview.length > 0 && (
        <TierSection
          label="Needs Review"
          emoji="⚠️"
          tone="expiring"
          items={needsReview}
          checkedKeys={checkedKeys}
          defaultOpen={true}
          globalOffset={readyToAdd.length}
          onItemChange={(i, updated) => onReviewChange(replaceAt(needsReview, i, updated))}
          onItemDismiss={(i) => {
            const key = itemKey(needsReview[i], readyToAdd.length + i)
            dismissKey(key)
            onReviewChange(removeAt(needsReview, i))
          }}
          onCheckedChange={toggleKey}
        />
      )}

      {skipped.length > 0 && (
        <TierSection
          label="Skipped"
          emoji="⏭️"
          tone="muted"
          items={skipped}
          checkedKeys={checkedKeys}
          defaultOpen={false}
          globalOffset={readyToAdd.length + needsReview.length}
          onItemChange={(i, updated) => onSkippedChange(replaceAt(skipped, i, updated))}
          onItemDismiss={(i) => {
            const key = itemKey(skipped[i], readyToAdd.length + needsReview.length + i)
            dismissKey(key)
            onSkippedChange(removeAt(skipped, i))
          }}
          onCheckedChange={toggleKey}
        />
      )}

      {/* Sticky footer CTA */}
      {!hideConfirmButton && (
        <div className="sticky bottom-4 mt-4">
          <motion.button
            type="button"
            onClick={() => onConfirm(checkedItems)}
            disabled={checkedCount === 0 || isSubmitting}
            whileHover={{ scale: checkedCount === 0 || isSubmitting ? 1 : 1.02 }}
            whileTap={{ scale: checkedCount === 0 || isSubmitting ? 1 : 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            className="w-full py-4 rounded-full font-bold text-white shadow-lg transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--color-primary-dark, #FF8FAB)' }}
          >
            {isSubmitting
              ? 'Adding…'
              : checkedCount === 0
                ? 'No items selected'
                : `Add ${checkedCount} Item${checkedCount === 1 ? '' : 's'} to Pantry`}
          </motion.button>
        </div>
      )}
    </div>
  )
}
