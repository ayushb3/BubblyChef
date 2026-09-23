'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import ReviewSurface from '@/components/scan/ReviewSurface'
import { useFileDropzone } from '@/hooks/useFileDropzone'
import { uploadReceipt, ScanError } from '@/lib/api/scan'
import { scannedToBulkAddItem, assignScanIds, type ScannedItemWithId } from '@/lib/scan-helpers'
import { scanErrorCopy } from '@/lib/scan-error-copy'
import type { ScanResult } from '@/types/scan'
import type { AddItem } from './PantryAddSheet'

type ScanTabState = 'upload' | 'processing' | 'results'

interface ScanTabProps {
  onItemsReady: (items: AddItem[]) => void
  /**
   * Reports whether a scan is currently in flight so the parent sheet can
   * lock the Type tab for the duration (issue #402). Must fire `true` right
   * before the upload starts and `false` on every path out of `processing`
   * — success and failure/timeout alike — or the lock never releases.
   */
  onProcessingChange?: (processing: boolean) => void
}

function scannedToAddItem(item: ScannedItemWithId): AddItem {
  return { ...scannedToBulkAddItem(item), source: 'scan' }
}

export default function ScanTab({ onItemsReady, onProcessingChange }: ScanTabProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ScanTabState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [readyToAdd, setReadyToAdd] = useState<ScannedItemWithId[]>([])
  const [needsReview, setNeedsReview] = useState<ScannedItemWithId[]>([])
  const [skipped, setSkipped] = useState<ScannedItemWithId[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  const { isDragActive, dropzoneHandlers } = useFileDropzone({ onFile: handleFileSelect })

  // Guards against a scan abandoned by closing the sheet mid-flight (issue
  // #439): PantryAddSheet's own inner content — and this ScanTab along with
  // it — unmounts on close and remounts fresh on reopen, but the
  // `scanProcessing` state (and the `onProcessingChange` setter that writes
  // it) lives on the persistent parent, so an old scan's `finally` settling
  // after a new scan has started would otherwise clear the lock the new scan
  // still holds. `scanTokenRef` disambiguates overlapping scans within the
  // same mount; `unmountedRef` + the aborted request cover the cross-mount
  // case where a whole new instance (with its own fresh token) is scanning.
  const scanTokenRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const unmountedRef = useRef(false)

  useEffect(() => {
    return () => {
      unmountedRef.current = true
      // Stop billing a vision call the user already walked away from.
      abortControllerRef.current?.abort()
    }
  }, [])

  async function handleFileSelect(file: File) {
    const token = ++scanTokenRef.current
    const controller = new AbortController()
    abortControllerRef.current = controller

    setError(null)
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    setState('processing')
    onProcessingChange?.(true)

    const isStale = () => unmountedRef.current || scanTokenRef.current !== token

    try {
      const result: ScanResult = await uploadReceipt(file, { signal: controller.signal })
      if (isStale()) return
      const withIds = assignScanIds(result)
      setReadyToAdd(withIds.ready_to_add)
      setNeedsReview(withIds.needs_review)
      setSkipped(withIds.skipped)
      setWarnings(result.warnings ?? [])
      setState('results')
    } catch (err) {
      if (isStale()) return
      // Never render a raw server/provider string — always route through the
      // code -> copy mapping, falling back to generic friendly copy for
      // anything unrecognized (issue #396). This also covers the
      // client-side upload timeout (issue #402): it comes back as a
      // `ScanError` and must land here, not in some separate stuck state.
      const code = err instanceof ScanError ? err.code : undefined
      setError(scanErrorCopy(code))
      setState('upload')
      // Retrying the same receipt is the obvious next move after a transient
      // failure, but `onChange` doesn't fire for an unchanged value — so
      // without this the same file simply does nothing (#246).
      if (inputRef.current) inputRef.current.value = ''
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 500)
      // Every path out of `processing` — results or upload/error — must
      // release the Type-tab lock (issue #402), but only for the scan that
      // is still current; an abandoned/superseded scan must not touch it
      // (issue #439).
      if (!isStale()) onProcessingChange?.(false)
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
    onItemsReady([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleReadyChange = (items: ScannedItemWithId[]) => {
    setReadyToAdd(items)
  }

  const handleReviewChange = (items: ScannedItemWithId[]) => {
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
              {...dropzoneHandlers}
              className={`w-full border-2 border-dashed rounded-3xl p-10 text-center transition-colors active:scale-95 ${
                isDragActive
                  ? 'border-[var(--color-primary)] bg-[var(--color-border)] scale-[1.02]'
                  : 'border-[var(--color-primary)] bg-[var(--color-surface)] hover:bg-[var(--color-border)]'
              }`}
            >
              <div className="flex justify-center mb-3">
                <BubblesMascot state="happy" size={72} />
              </div>
              <p className="font-semibold text-[var(--color-text)] mb-1">
                {isDragActive ? 'Drop it here!' : 'Drop your receipt here'}
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
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
