'use client'

/**
 * Issue #653 — the cook-along's timeline sheet: a bottom sheet, on the
 * pantry add sheet's pattern (`components/pantry/PantryAddSheet.tsx`),
 * filled by the caller with `MealTimelineTable` in clock mode. Focus is
 * trapped and Escape closes via the shared `useModalFocusTrap` hook — same
 * mechanism every other modal/sheet in this codebase uses, not a bespoke
 * one.
 */

import { useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'

export interface MealTimelineSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export default function MealTimelineSheet({ open, onClose, children }: MealTimelineSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, panelRef)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/40 z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            data-testid="meal-timeline-sheet-backdrop"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="meal-timeline-sheet-title"
            tabIndex={-1}
            className="fixed bottom-16 left-0 right-0 z-[60] rounded-t-3xl flex flex-col outline-none"
            style={{
              background: 'var(--color-surface)',
              maxHeight: 'calc(92vh - 64px)',
              fontFamily: 'Nunito, sans-serif',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            data-testid="meal-timeline-sheet"
          >
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--color-border)' }} />
            </div>

            <div className="px-5 pb-2 flex items-center justify-between flex-shrink-0">
              <h2 id="meal-timeline-sheet-title" className="text-lg font-extrabold" style={{ color: 'var(--color-text)' }}>
                Timeline
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="text-xl leading-none px-1 min-h-[44px] min-w-[44px]"
                style={{ color: 'var(--color-muted)' }}
                aria-label="Close timeline"
              >
                ✕
              </button>
            </div>

            <div className="px-5 pb-5 overflow-y-auto">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
