'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import ScanTab from './ScanTab'
import TypeTab from './TypeTab'
import { bulkAddPantryItems } from '@/lib/api/pantry'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'

export interface AddItem {
  name: string
  quantity: number
  unit: string
  category: string
  storage_location: string
  expiry_date: string | null
  source: 'scan' | 'manual'
}

export type PantryAddTab = 'scan' | 'type'

interface PantryAddSheetProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: PantryAddTab
  onItemsAdded: () => void
}

export default function PantryAddSheet({
  isOpen,
  onClose,
  initialTab = 'scan',
  onItemsAdded,
}: PantryAddSheetProps) {
  const [activeTab, setActiveTab] = useState<PantryAddTab>(initialTab)
  const [scanItems, setScanItems] = useState<AddItem[]>([])
  const [typeItems, setTypeItems] = useState<AddItem[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // While a scan is in flight, switching to Type is not offered — but the
  // sheet's own close paths (X, backdrop, drag-to-dismiss) stay unaffected;
  // a tab switch is not an abandon gesture, closing the sheet is (issue #402).
  const [scanProcessing, setScanProcessing] = useState(false)
  const dragControls = useDragControls()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(isOpen, onClose, panelRef)

  // Update tab when prop changes (e.g. URL param triggers re-open)
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab)
  }, [isOpen, initialTab])

  // Reset state when sheet closes
  useEffect(() => {
    if (!isOpen) {
      setScanItems([])
      setTypeItems([])
      setError(null)
      setIsSubmitting(false)
      setScanProcessing(false)
    }
  }, [isOpen])

  const allItems = [...scanItems, ...typeItems]
  const itemCount = allItems.length

  async function handleConfirm() {
    if (itemCount === 0) return
    setIsSubmitting(true)
    setError(null)

    try {
      await bulkAddPantryItems(
        allItems.map((item) => {
          const { source, ...rest } = item
          void source
          return rest
        }),
      )

      onItemsAdded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add items')
    } finally {
      setIsSubmitting(false)
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

          {/* Sheet — slides up from bottom, sits above the bottom nav */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pantry-add-sheet-title"
            tabIndex={-1}
            className="fixed bottom-16 left-0 right-0 z-[60] rounded-t-3xl flex flex-col select-none outline-none"
            style={{
              background: 'var(--color-surface)',
              maxHeight: 'calc(92vh - 64px)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.3 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) onClose()
            }}
          >
            {/* Handle bar — drag initiator */}
            <div
              className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            </div>

            {/* Header */}
            <div className="px-6 pb-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 id="pantry-add-sheet-title" className="text-lg font-extrabold text-[var(--color-text)]">
                  Add to Pantry
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors text-xl leading-none px-1"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* Tab switcher */}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('scan')}
                  className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${
                    activeTab === 'scan'
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  📷 Scan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // A tab switch is not an abandon gesture, so a scan in
                    // flight blocks it rather than silently killing it
                    // (issue #402). Use aria-disabled + a no-op click, not
                    // the `disabled` attribute, so the control stays
                    // focusable and announced.
                    if (scanProcessing) return
                    setActiveTab('type')
                  }}
                  aria-disabled={scanProcessing}
                  title={scanProcessing ? 'Scanning… please wait' : undefined}
                  className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${
                    scanProcessing
                      ? 'bg-[var(--color-border)] text-[var(--color-muted)] opacity-50 cursor-not-allowed'
                      : activeTab === 'type'
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {scanProcessing ? '✍️ Type (Scanning…)' : '✍️ Type'}
                </button>
              </div>
            </div>

            {/* Tab content — scrollable */}
            <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
              {error && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm">
                  {error}
                </div>
              )}

              {/*
                Both tabs stay mounted at all times — switching tabs must not
                destroy component state (issue #402: typed rows and a
                completed scan review both have to survive a switch away and
                back). AnimatePresence's exit animation requires unmounting
                the outgoing child, which is exactly the bug, so the slide
                transition here is done with plain CSS transitions on
                permanently-mounted wrappers instead: the inactive tab is
                `absolute` + `opacity-0` + `pointer-events-none` (out of flow,
                invisible, unclickable, but never removed from the DOM).
              */}
              <div className="relative">
                <div
                  aria-hidden={activeTab !== 'scan'}
                  className={`transition-all duration-200 ease-out ${
                    activeTab === 'scan'
                      ? 'relative opacity-100 translate-x-0'
                      : 'absolute inset-0 opacity-0 -translate-x-3 pointer-events-none'
                  }`}
                >
                  <ScanTab onItemsReady={setScanItems} onProcessingChange={setScanProcessing} />
                </div>
                <div
                  aria-hidden={activeTab !== 'type'}
                  className={`transition-all duration-200 ease-out ${
                    activeTab === 'type'
                      ? 'relative opacity-100 translate-x-0'
                      : 'absolute inset-0 opacity-0 translate-x-3 pointer-events-none'
                  }`}
                >
                  <TypeTab onItemsReady={setTypeItems} />
                </div>
              </div>
            </div>

            {/* Sticky confirm footer */}
            <div className="flex-shrink-0 px-6 pb-4 pt-3 border-t border-[var(--color-border)]">
              <motion.button
                type="button"
                onClick={handleConfirm}
                disabled={itemCount === 0 || isSubmitting}
                whileHover={{ scale: itemCount === 0 || isSubmitting ? 1 : 1.02 }}
                whileTap={{ scale: itemCount === 0 || isSubmitting ? 1 : 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                className="w-full py-4 rounded-full font-bold text-white shadow-lg transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--color-primary-dark, #FF8FAB)' }}
              >
                {isSubmitting
                  ? 'Adding…'
                  : itemCount === 0
                    ? 'Add Items'
                    : `Add ${itemCount} Item${itemCount !== 1 ? 's' : ''} 🛒`}
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
