'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ScannedItem } from '@/types/scan'
import ScannedItemCard from './ScannedItemCard'

interface ScanResultsProps {
  readyToAdd: ScannedItem[]
  needsReview: ScannedItem[]
  skipped: ScannedItem[]
  onReadyChange: (items: ScannedItem[]) => void
  onReviewChange: (items: ScannedItem[]) => void
  onSkippedChange: (items: ScannedItem[]) => void
  onConfirm: () => void
  isSubmitting: boolean
}

interface TierSectionProps {
  title: string
  dot: string
  headerClass: string
  items: ScannedItem[]
  defaultOpen?: boolean
  globalIndex: number
  onItemChange: (index: number, updated: ScannedItem) => void
  onItemDismiss: (index: number) => void
}

function TierSection({
  title,
  dot,
  headerClass,
  items,
  defaultOpen = true,
  globalIndex,
  onItemChange,
  onItemDismiss,
}: TierSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-2xl font-semibold text-sm ${headerClass} transition-opacity hover:opacity-90`}
      >
        <span className="flex items-center gap-2">
          <span>{dot}</span>
          <span>{title}</span>
          <span className="ml-1 font-normal opacity-70">({items.length})</span>
        </span>
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2 }}
          className="text-xs"
        >
          ▼
        </motion.span>
      </button>

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
                  key={`${item.name}-${globalIndex + i}`}
                  item={item}
                  index={i}
                  onChange={(updated) => onItemChange(i, updated)}
                  onDismiss={() => onItemDismiss(i)}
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

export default function ScanResults({
  readyToAdd,
  needsReview,
  skipped,
  onReadyChange,
  onReviewChange,
  onSkippedChange,
  onConfirm,
  isSubmitting,
}: ScanResultsProps) {
  const totalActive = readyToAdd.length + needsReview.length

  function removeAt(list: ScannedItem[], i: number): ScannedItem[] {
    return list.filter((_, idx) => idx !== i)
  }
  function replaceAt(list: ScannedItem[], i: number, item: ScannedItem): ScannedItem[] {
    return list.map((el, idx) => (idx === i ? item : el))
  }

  return (
    <div>
      {readyToAdd.length > 0 && (
        <TierSection
          title="Ready to Add"
          dot="✅"
          headerClass="bg-green-50 text-green-800"
          items={readyToAdd}
          defaultOpen={true}
          globalIndex={0}
          onItemChange={(i, updated) => onReadyChange(replaceAt(readyToAdd, i, updated))}
          onItemDismiss={(i) => onReadyChange(removeAt(readyToAdd, i))}
        />
      )}

      {needsReview.length > 0 && (
        <TierSection
          title="Needs Review"
          dot="⚠️"
          headerClass="bg-yellow-50 text-yellow-800"
          items={needsReview}
          defaultOpen={false}
          globalIndex={readyToAdd.length}
          onItemChange={(i, updated) => onReviewChange(replaceAt(needsReview, i, updated))}
          onItemDismiss={(i) => onReviewChange(removeAt(needsReview, i))}
        />
      )}

      {skipped.length > 0 && (
        <TierSection
          title="Skipped"
          dot="⏭️"
          headerClass="bg-gray-50 text-gray-600"
          items={skipped}
          defaultOpen={false}
          globalIndex={readyToAdd.length + needsReview.length}
          onItemChange={(i, updated) => onSkippedChange(replaceAt(skipped, i, updated))}
          onItemDismiss={(i) => onSkippedChange(removeAt(skipped, i))}
        />
      )}

      {/* Sticky footer CTA */}
      <div className="sticky bottom-4 mt-4">
        <motion.button
          type="button"
          onClick={onConfirm}
          disabled={totalActive === 0 || isSubmitting}
          whileHover={{ scale: totalActive === 0 || isSubmitting ? 1 : 1.02 }}
          whileTap={{ scale: totalActive === 0 || isSubmitting ? 1 : 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          className="w-full py-4 rounded-full font-bold text-white shadow-lg transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-primary-dark, #FF8FAB)' }}
        >
          {isSubmitting
            ? 'Adding…'
            : totalActive === 0
              ? 'No items selected'
              : `Add ${totalActive} Item${totalActive === 1 ? '' : 's'} to Pantry`}
        </motion.button>
      </div>
    </div>
  )
}
