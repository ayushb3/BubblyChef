'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import SpringButton from '@/components/ui/SpringButton'
import ScanResults from '@/components/scan/ScanResults'
import ThemePicker from '@/components/ui/ThemePicker'
import { uploadReceipt, confirmScanItems } from '@/lib/api/scan'
import type { ScannedItem, ScanResult } from '@/types/scan'

type ScanState = 'upload' | 'processing' | 'results' | 'success'

export default function ScanPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ScanState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Mutable result tiers — users can edit/dismiss items
  const [readyToAdd, setReadyToAdd] = useState<ScannedItem[]>([])
  const [needsReview, setNeedsReview] = useState<ScannedItem[]>([])
  const [skipped, setSkipped] = useState<ScannedItem[]>([])

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setState('upload')
    } finally {
      // Revoke after a short delay so the preview img has time to render
      // before the blob URL is invalidated
      setTimeout(() => URL.revokeObjectURL(objectUrl), 500)
    }
  }

  async function handleConfirm() {
    setIsSubmitting(true)
    setError(null)

    const items = [
      ...readyToAdd.map((item) => ({ action: 'add' as const, ...item })),
      ...needsReview.map((item) => ({ action: 'add' as const, ...item })),
    ]

    try {
      await confirmScanItems(items)
      setState('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add items')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleReset() {
    setState('upload')
    setPreview(null)
    setError(null)
    setReadyToAdd([])
    setNeedsReview([])
    setSkipped([])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="min-h-screen pb-24">
      <BubblesHeader rightSlot={<ThemePicker />} />
      <div className="p-6 pt-4 max-w-md mx-auto">

      {error && (
        <FadeInView>
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm">
            {error}
          </div>
        </FadeInView>
      )}

      <AnimatePresence mode="wait">
        {/* ── UPLOAD STATE ── */}
        {state === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-[var(--color-primary)] rounded-3xl p-12 text-center bg-[var(--color-surface)] hover:bg-[var(--color-border)] transition-colors active:scale-95"
            >
              <div className="flex justify-center mb-4">
                <BubblesMascot state="happy" size={80} />
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

        {/* ── PROCESSING STATE ── */}
        {state === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.3 }}
            className="text-center"
          >
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Receipt preview"
                className="w-full max-h-64 object-contain rounded-2xl mb-6 border border-[var(--color-border)]"
              />
            )}

            <div className="flex justify-center mb-4">
              <BubblesMascot state="thinking" size={72} />
            </div>

            <div className="flex items-center justify-center gap-3">
              <motion.div
                className="w-5 h-5 rounded-full border-2 border-[var(--color-primary)] border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              />
              <p className="font-semibold text-[var(--color-text)]">Scanning receipt…</p>
            </div>

            <p className="text-sm text-[var(--color-muted)] mt-2">
              Bubbles is reading your items
            </p>
          </motion.div>
        )}

        {/* ── RESULTS STATE ── */}
        {state === 'results' && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center justify-between mb-4">
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

            <ScanResults
              readyToAdd={readyToAdd}
              needsReview={needsReview}
              skipped={skipped}
              onReadyChange={setReadyToAdd}
              onReviewChange={setNeedsReview}
              onSkippedChange={setSkipped}
              onConfirm={handleConfirm}
              isSubmitting={isSubmitting}
            />
          </motion.div>
        )}

        {/* ── SUCCESS STATE ── */}
        {state === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, type: 'spring', stiffness: 300, damping: 20 }}
            className="text-center py-8"
          >
            <div className="flex justify-center mb-4">
              <BubblesMascot state="happy" size={96} />
            </div>

            <h2 className="text-xl font-extrabold text-[var(--color-text)] mb-2">
              Items added! 🎉
            </h2>
            <p className="text-sm text-[var(--color-muted)] mb-8">
              Your pantry has been updated.
            </p>

            <div className="flex flex-col gap-3">
              <Link href="/pantry">
                <SpringButton className="w-full bg-[var(--color-primary-dark,#FF8FAB)] text-white font-bold py-3 px-6 rounded-full">
                  View Pantry
                </SpringButton>
              </Link>

              <button
                type="button"
                onClick={handleReset}
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] underline transition-colors"
              >
                Scan another receipt
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  )
}
