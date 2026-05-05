'use client'

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import ScanResults from '@/components/scan/ScanResults'
import { uploadReceipt } from '@/lib/api/scan'
import type { ScannedItem, ScanResult } from '@/types/scan'
import type { AddItem } from './PantryAddSheet'

type ScanTabState = 'upload' | 'processing' | 'results'

interface ScanTabProps {
  onItemsReady: (items: AddItem[]) => void
}

function scannedToAddItem(item: ScannedItem): AddItem {
  return {
    name: item.name,
    quantity: item.quantity ?? 1,
    unit: item.unit ?? 'item',
    category: item.category ?? 'other',
    storage_location: item.location ?? 'pantry',
    expiry_date: null,
    source: 'scan',
  }
}

export default function ScanTab({ onItemsReady }: ScanTabProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ScanTabState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [readyToAdd, setReadyToAdd] = useState<ScannedItem[]>([])
  const [needsReview, setNeedsReview] = useState<ScannedItem[]>([])
  const [skipped, setSkipped] = useState<ScannedItem[]>([])

  function notifyParent(ready: ScannedItem[], review: ScannedItem[]) {
    onItemsReady([...ready, ...review].map(scannedToAddItem))
  }

  async function handleFileSelect(file: File) {
    setError(null)
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    setState('processing')

    try {
      const result: ScanResult = await uploadReceipt(file)
      setReadyToAdd(result.ready_to_add)
      setNeedsReview(result.needs_review)
      setSkipped(result.skipped)
      setState('results')
      notifyParent(result.ready_to_add, result.needs_review)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('upload')
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 500)
    }
  }

  function handleReset() {
    setState('upload')
    setPreview(null)
    setError(null)
    setReadyToAdd([])
    setNeedsReview([])
    setSkipped([])
    onItemsReady([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleReadyChange = (items: ScannedItem[]) => {
    setReadyToAdd(items)
    notifyParent(items, needsReview)
  }

  const handleReviewChange = (items: ScannedItem[]) => {
    setNeedsReview(items)
    notifyParent(readyToAdd, items)
  }

  return (
    <div>
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {state === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-[var(--color-primary)] rounded-3xl p-10 text-center bg-[var(--color-surface)] hover:bg-[var(--color-border)] transition-colors active:scale-95"
            >
              <div className="flex justify-center mb-3">
                <BubblesMascot state="happy" size={72} />
              </div>
              <p className="font-semibold text-[var(--color-text)] mb-1">Drop your receipt here</p>
              <p className="text-sm text-[var(--color-muted)]">or tap to upload</p>
            </button>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFileSelect(file)
              }}
            />
          </motion.div>
        )}

        {state === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            className="text-center"
          >
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Receipt preview"
                className="w-full max-h-48 object-contain rounded-2xl mb-4 border border-[var(--color-border)]"
              />
            )}
            <div className="flex justify-center mb-3">
              <BubblesMascot state="thinking" size={64} />
            </div>
            <div className="flex items-center justify-center gap-3">
              <motion.div
                className="w-5 h-5 rounded-full border-2 border-[var(--color-primary)] border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              />
              <p className="font-semibold text-[var(--color-text)]">Scanning receipt…</p>
            </div>
            <p className="text-sm text-[var(--color-muted)] mt-2">Bubbles is reading your items</p>
          </motion.div>
        )}

        {state === 'results' && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-[var(--color-muted)]">
                Found{' '}
                <span className="font-semibold text-[var(--color-text)]">
                  {readyToAdd.length + needsReview.length + skipped.length}
                </span>{' '}
                items
              </p>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] underline transition-colors"
              >
                Scan again
              </button>
            </div>

            {/* Render results without their built-in confirm button — PantryAddSheet owns confirm */}
            <ScanResults
              readyToAdd={readyToAdd}
              needsReview={needsReview}
              skipped={skipped}
              onReadyChange={handleReadyChange}
              onReviewChange={handleReviewChange}
              onSkippedChange={setSkipped}
              onConfirm={() => {/* confirm handled by PantryAddSheet */}}
              isSubmitting={false}
              hideConfirmButton
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
