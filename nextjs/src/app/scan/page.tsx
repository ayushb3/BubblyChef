'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import ReviewSurface from '@/components/scan/ReviewSurface'
import { uploadReceipt } from '@/lib/api/scan'
import type { ScannedItem, ScanResult } from '@/types/scan'

type ScanPageState = 'upload' | 'processing' | 'review' | 'confirm'

/**
 * /scan route — full receipt scanning experience.
 *
 * Owns:
 * - Upload UI and file handling
 * - OCR processing state machine
 * - ReviewSurface with full confirm button (unlike sheet mount)
 * - Confirmation flow (adds items, shows success, returns home)
 *
 * Does NOT own:
 * - Review UI (ReviewSurface handles that)
 * - Database writes (delegates to API layer)
 *
 * This is the expanded version of the sheet-mounted experience.
 * The same ReviewSurface surface can mount in chat (#254) and other flows.
 */
export default function ScanPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<ScanPageState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    setIsSubmitting(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleConfirm(checkedItems: ScannedItem[]) {
    if (checkedItems.length === 0) return
    setIsSubmitting(true)
    setError(null)
    setState('confirm')

    try {
      const itemsToAdd = checkedItems.map((item) => ({
        name: item.name,
        quantity: item.quantity ?? 1,
        unit: item.unit ?? 'item',
        category: item.category ?? 'other',
        storage_location: item.location ?? 'pantry',
        expiry_date: null,
      }))

      const res = await fetch('/api/pantry/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToAdd }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to add items' }))
        throw new Error(data.error ?? `Failed to add items: ${res.status}`)
      }

      // Success — show confirmation and redirect after a brief delay
      await new Promise((resolve) => setTimeout(resolve, 1500))
      router.push('/pantry')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add items')
      setState('review')
    } finally {
      setIsSubmitting(false)
    }
  }

  const totalItems = readyToAdd.length + needsReview.length + skipped.length

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-extrabold text-[var(--color-text)]">Scan Receipt</h1>
          <button
            type="button"
            onClick={() => router.push('/pantry')}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors text-xl leading-none px-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm">
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* Upload state */}
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
                  <BubblesMascot state="happy" size={80} />
                </div>
                <p className="font-semibold text-[var(--color-text)] mb-1 text-lg">
                  Drop your receipt here
                </p>
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

          {/* Processing state */}
          {state === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              className="text-center py-12"
            >
              {preview && (
                <img
                  src={preview}
                  alt="Receipt preview"
                  className="w-full max-h-96 object-contain rounded-2xl mb-6 border border-[var(--color-border)]"
                />
              )}
              <div className="flex justify-center mb-4">
                <BubblesMascot state="thinking" size={72} />
              </div>
              <div className="flex items-center justify-center gap-3 mb-2">
                <motion.div
                  className="w-5 h-5 rounded-full border-2 border-[var(--color-primary)] border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                />
                <p className="font-semibold text-[var(--color-text)]">Scanning receipt…</p>
              </div>
              <p className="text-sm text-[var(--color-muted)]">Bubbles is reading your items</p>
            </motion.div>
          )}

          {/* Review state */}
          {state === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--color-muted)] mb-1">Receipt scanned</p>
                    <p className="text-2xl font-extrabold text-[var(--color-text)]">
                      {totalItems} item{totalItems !== 1 ? 's' : ''} found
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] underline transition-colors"
                  >
                    Scan again
                  </button>
                </div>
              </div>

              {/* ReviewSurface with confirm button enabled */}
              <ReviewSurface
                readyToAdd={readyToAdd}
                needsReview={needsReview}
                skipped={skipped}
                warnings={warnings}
                onReadyChange={setReadyToAdd}
                onReviewChange={setNeedsReview}
                onSkippedChange={setSkipped}
                onConfirm={handleConfirm}
                isSubmitting={isSubmitting}
                hideConfirmButton={false}
              />
            </motion.div>
          )}

          {/* Confirmation state */}
          {state === 'confirm' && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 12 }}
                className="mb-4 text-6xl"
              >
                ✅
              </motion.div>
              <h2 className="text-2xl font-extrabold text-[var(--color-text)] mb-2">
                Items added!
              </h2>
              <p className="text-[var(--color-muted)] mb-6">
                Your pantry has been updated
              </p>
              <p className="text-sm text-[var(--color-muted)]">
                Redirecting to pantry…
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
