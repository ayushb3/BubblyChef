'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import ReviewSurface from '@/components/scan/ReviewSurface'
import { uploadReceipt } from '@/lib/api/scan'
import { bulkAddPantryItems } from '@/lib/api/pantry'
import { scannedToBulkAddItem } from '@/lib/scan-helpers'
import type { ScannedItem, ScanResult } from '@/types/scan'

/**
 * `/scan` — full-viewport receipt OCR upload + review flow.
 *
 * Owns the upload → processing → review → confirm → redirect pipeline for
 * this entry point. Review rendering itself is delegated to `ReviewSurface`
 * (presentation-only); this container is the only place that decides when a
 * write actually happens — nothing is added to the pantry until the user
 * taps the confirm button (issue #259).
 */

type ScanPageState = 'upload' | 'processing' | 'review' | 'submitting'

export default function ScanPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<ScanPageState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [readyToAdd, setReadyToAdd] = useState<ScannedItem[]>([])
  const [needsReview, setNeedsReview] = useState<ScannedItem[]>([])
  const [skipped, setSkipped] = useState<ScannedItem[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

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
      setWarnings(result.warnings ?? [])
      setState('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('upload')
      // Retrying the same receipt is the obvious next move after a transient
      // failure, but `onChange` doesn't fire for an unchanged value — so
      // without this the same file simply does nothing (#246).
      if (inputRef.current) inputRef.current.value = ''
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
    setWarnings([])
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleConfirm(checkedItems: ScannedItem[]) {
    if (checkedItems.length === 0) return
    setState('submitting')
    setError(null)

    try {
      await bulkAddPantryItems(checkedItems.map(scannedToBulkAddItem))
      queryClient.invalidateQueries({ queryKey: ['pantry'] })
      router.push('/pantry')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add items')
      setState('review')
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <BubblesHeader
        rightSlot={
          <Link
            href="/pantry"
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] underline transition-colors"
          >
            Cancel
          </Link>
        }
      />

      <div className="px-6 pt-4">
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

          {(state === 'review' || state === 'submitting') && (
            <motion.div
              key="review"
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
                  disabled={state === 'submitting'}
                  className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] underline transition-colors disabled:opacity-50"
                >
                  Scan again
                </button>
              </div>

              <ReviewSurface
                readyToAdd={readyToAdd}
                needsReview={needsReview}
                skipped={skipped}
                warnings={warnings}
                onReadyChange={setReadyToAdd}
                onReviewChange={setNeedsReview}
                onSkippedChange={setSkipped}
                onConfirm={handleConfirm}
                isSubmitting={state === 'submitting'}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
