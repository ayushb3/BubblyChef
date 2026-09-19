'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import ReviewSurface from '@/components/scan/ReviewSurface'
import { uploadReceipt } from '@/lib/api/scan'
import { scannedToBulkAddItem } from '@/lib/scan-helpers'
import type { ScannedItem, ScanResult } from '@/types/scan'
import type { AddItem } from './PantryAddSheet'

type ScanStage = 'upload' | 'processing' | 'results'

/**
 * A snapshot of ScanTab's in-progress upload/review state. ScanTab still
 * mounts and unmounts when the parent switches tabs, so a parent that wants
 * a finished (or in-flight) scan to survive that unmount — issue #402 —
 * holds onto the latest snapshot via `onSnapshotChange` and hands it back in
 * as `initialSnapshot` on remount.
 */
export interface ScanTabSnapshot {
  state: ScanStage
  preview: string | null
  error: string | null
  readyToAdd: ScannedItem[]
  needsReview: ScannedItem[]
  skipped: ScannedItem[]
  warnings: string[]
  /**
   * The user's actual checkbox selection from ReviewSurface, keyed by
   * itemKey. Without this, a remount reseeds from the default rule (every
   * ready_to_add item checked, everything else unchecked) and silently
   * discards whatever the user actually chose (issue #402).
   */
  checkedKeys: string[]
}

interface ScanTabProps {
  onItemsReady: (items: AddItem[]) => void
  initialSnapshot?: ScanTabSnapshot
  onSnapshotChange?: (snapshot: ScanTabSnapshot) => void
}

function scannedToAddItem(item: ScannedItem): AddItem {
  return { ...scannedToBulkAddItem(item), source: 'scan' }
}

export default function ScanTab({ onItemsReady, initialSnapshot, onSnapshotChange }: ScanTabProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // A restored 'processing' snapshot has no upload in flight to resume it —
  // the promise that would have resolved it belonged to the unmounted
  // instance that made this snapshot, and its preview blob URL has already
  // been revoked. Restoring 'processing' as-is spins forever with a broken
  // image and no way out (issue #402 follow-up). Fall back to the upload
  // dropzone instead so the user can just re-scan.
  const restoredStuckProcessing = initialSnapshot?.state === 'processing'
  const [state, setState] = useState<ScanStage>(
    restoredStuckProcessing ? 'upload' : initialSnapshot?.state ?? 'upload',
  )
  const [preview, setPreview] = useState<string | null>(
    restoredStuckProcessing ? null : initialSnapshot?.preview ?? null,
  )
  const [error, setError] = useState<string | null>(initialSnapshot?.error ?? null)
  // Guards state updates from an in-flight upload whose promise resolves
  // after this instance has unmounted (e.g. the user switched tabs while
  // scanning) — without this, the late setState calls land on a detached
  // instance and their result is silently dropped instead of persisted.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const [readyToAdd, setReadyToAdd] = useState<ScannedItem[]>(initialSnapshot?.readyToAdd ?? [])
  const [needsReview, setNeedsReview] = useState<ScannedItem[]>(initialSnapshot?.needsReview ?? [])
  const [skipped, setSkipped] = useState<ScannedItem[]>(initialSnapshot?.skipped ?? [])
  const [warnings, setWarnings] = useState<string[]>(initialSnapshot?.warnings ?? [])
  // Restored once on mount and handed to ReviewSurface as its seed; only
  // ever updated afterwards via onCheckedKeysChange, so ReviewSurface stays
  // the single source of truth for what's actually checked.
  const [checkedKeys, setCheckedKeys] = useState<string[]>(initialSnapshot?.checkedKeys ?? [])
  const restoredCheckedKeysRef = useRef(initialSnapshot?.checkedKeys)

  // Reports the full snapshot on every relevant change; onSnapshotChange is
  // intentionally excluded from deps so an inline/unmemoized callback
  // doesn't re-trigger this.
  useEffect(() => {
    onSnapshotChange?.({
      state,
      preview,
      error,
      readyToAdd,
      needsReview,
      skipped,
      warnings,
      checkedKeys,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, preview, error, readyToAdd, needsReview, skipped, warnings, checkedKeys])

  async function handleFileSelect(file: File) {
    setError(null)
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    setState('processing')

    try {
      const result: ScanResult = await uploadReceipt(file)
      // The paid Vision call already happened by this point — if the tab
      // was switched away mid-upload and this instance is gone, there's no
      // UI left to hand the result to, but we must not silently drop it
      // either; the parent's snapshot only ever reflects a mounted
      // instance's state, so there is nothing further to persist here once
      // unmounted. Just avoid touching this detached instance's state.
      if (!isMountedRef.current) return
      setReadyToAdd(result.ready_to_add)
      setNeedsReview(result.needs_review)
      setSkipped(result.skipped)
      setWarnings(result.warnings ?? [])
      setCheckedKeys([])
      // A fresh scan's items don't correspond to whatever was restored from
      // an earlier snapshot — let ReviewSurface fall back to its default
      // seeding rule (ready_to_add checked, rest unchecked) instead of
      // matching stale keys against the new item set.
      restoredCheckedKeysRef.current = undefined
      setState('results')
    } catch (err) {
      if (!isMountedRef.current) return
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
    setCheckedKeys([])
    restoredCheckedKeysRef.current = undefined
    onItemsReady([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleReadyChange = (items: ScannedItem[]) => {
    setReadyToAdd(items)
  }

  const handleReviewChange = (items: ScannedItem[]) => {
    setNeedsReview(items)
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
            <ReviewSurface
              readyToAdd={readyToAdd}
              needsReview={needsReview}
              skipped={skipped}
              warnings={warnings}
              onReadyChange={handleReadyChange}
              onReviewChange={handleReviewChange}
              onSkippedChange={setSkipped}
              onConfirm={() => {/* confirm handled by PantryAddSheet */}}
              isSubmitting={false}
              hideConfirmButton
              onCheckedItemsChange={(checked) => onItemsReady(checked.map(scannedToAddItem))}
              initialCheckedKeys={restoredCheckedKeysRef.current}
              onCheckedKeysChange={setCheckedKeys}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
