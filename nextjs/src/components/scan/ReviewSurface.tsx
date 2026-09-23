'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ScannedItemWithId } from '@/lib/scan-helpers'
import ScannedItemCard from './ScannedItemCard'
import Chip from '@/components/ui/Chip'
import type { ChipTone } from '@/components/ui/Chip'

/**
 * ReviewSurface — presentation-only tiered receipt review UI.
 *
 * Renders the "Ready to Add" / "Needs Review" / "Skipped" tiers, the
 * per-item cards (including the raw-frame eye toggle), the warnings banner,
 * and the confirm affordance. It owns no fetching, no routing, and no upload
 * state machine — everything comes in as props, and every mutation goes back
 * out through the `on*Change`/`onConfirm` callbacks. Callers (the pantry add
 * sheet's scan tab, the `/scan` route) own the upload → processing pipeline
 * and decide what "confirm" actually does (issue #259).
 */
export interface ReviewSurfaceProps {
  readyToAdd: ScannedItemWithId[]
  needsReview: ScannedItemWithId[]
  skipped: ScannedItemWithId[]
  warnings?: string[]
  onReadyChange: (items: ScannedItemWithId[]) => void
  onReviewChange: (items: ScannedItemWithId[]) => void
  onSkippedChange: (items: ScannedItemWithId[]) => void
  /** Fires only on explicit user confirm — nothing here writes to the DB itself. */
  onConfirm: (checkedItems: ScannedItemWithId[]) => void
  isSubmitting: boolean
  /** When true, hides the built-in confirm button (used when embedded in PantryAddSheet) */
  hideConfirmButton?: boolean
  /**
   * Fires whenever the checked-item set changes (checkbox toggle, item edit,
   * or dismiss). Lets an embedding parent (e.g. PantryAddSheet, which hides
   * the built-in confirm button and owns its own footer/confirm) track the
   * checked-only count and payload without duplicating checkbox state
   * (issue #406).
   */
  onCheckedItemsChange?: (items: ScannedItemWithId[]) => void
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
  items: ScannedItemWithId[]
  checkedKeys: Set<string>
  defaultOpen?: boolean
  onItemChange: (index: number, updated: ScannedItemWithId) => void
  onItemDismiss: (index: number) => void
  onCheckedChange: (id: string, checked: boolean) => void
}

function TierSection({
  label,
  emoji,
  tone,
  items,
  checkedKeys,
  defaultOpen = true,
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
              {items.map((item, i) => (
                <ScannedItemCard
                  key={item._id}
                  item={item}
                  index={i}
                  checked={checkedKeys.has(item._id)}
                  onChange={(updated) => onItemChange(i, updated)}
                  onDismiss={() => onItemDismiss(i)}
                  onCheckedChange={(c) => onCheckedChange(item._id, c)}
                />
              ))}
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
  onCheckedItemsChange,
}: ReviewSurfaceProps) {
  // Seed: ready_to_add items start checked; needs_review and skipped start unchecked.
  const initialCheckedKeys = useMemo(() => {
    return new Set<string>(readyToAdd.map((item) => item._id))
    // We only want the seed once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(initialCheckedKeys)

  function toggleKey(id: string, checked: boolean) {
    setCheckedKeys((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Remove an id from the checked set when its item is dismissed.
  function dismissKey(id: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function removeAt(list: ScannedItemWithId[], i: number): ScannedItemWithId[] {
    return list.filter((_, idx) => idx !== i)
  }
  function replaceAt(
    list: ScannedItemWithId[],
    i: number,
    item: ScannedItemWithId,
  ): ScannedItemWithId[] {
    return list.map((el, idx) => (idx === i ? item : el))
  }

  // Collect all currently-visible checked items in tier order for the confirm handler.
  const checkedItems = useMemo(() => {
    return [...readyToAdd, ...needsReview, ...skipped].filter((item) => checkedKeys.has(item._id))
  }, [readyToAdd, needsReview, skipped, checkedKeys])

  const checkedCount = checkedItems.length

  useEffect(() => {
    onCheckedItemsChange?.(checkedItems)
    // onCheckedItemsChange is a caller-provided callback; including it would
    // re-fire this effect whenever the parent re-renders with a new closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedItems])

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
          onItemChange={(i, updated) => onReadyChange(replaceAt(readyToAdd, i, updated))}
          onItemDismiss={(i) => {
            dismissKey(readyToAdd[i]._id)
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
          onItemChange={(i, updated) => onReviewChange(replaceAt(needsReview, i, updated))}
          onItemDismiss={(i) => {
            dismissKey(needsReview[i]._id)
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
          onItemChange={(i, updated) => onSkippedChange(replaceAt(skipped, i, updated))}
          onItemDismiss={(i) => {
            dismissKey(skipped[i]._id)
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
