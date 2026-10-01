'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesHeader from '@/components/layout/BubblesHeader'
import BubblesMascot from '@/components/ui/BubblesMascot'
import { useFileDropzone } from '@/hooks/useFileDropzone'
import { useScanHandOff } from '@/hooks/useScanHandOff'
import { uploadReceipt, ScanError } from '@/lib/api/scan'
import { scanErrorCopy, SCAN_NO_ITEMS_CODE } from '@/lib/scan-error-copy'
import { isEmptyScan } from '@/lib/scan-helpers'
import type { ScanResult } from '@/types/scan'

/**
 * `/scan` — full-viewport receipt OCR upload.
 *
 * Owns the upload → processing → hand-off pipeline for this entry point. It no
 * longer reviews the scan (issue #753): a parsed receipt is kept as the pending
 * put-away and the user goes to the kitchen home, where the put-away sheet
 * (`PutAwaySheet`, over `ReviewSurface`) opens over the scene. The add sheet's
 * scan tab ends in the same place. Nothing is written to the pantry here: that
 * is put-away's "Put away" tap, and only that (issue #259's confirm semantics).
 */

type ScanPageState = 'upload' | 'processing' | 'handoff'

export default function ScanPage() {
  const handOff = useScanHandOff()
  const inputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<ScanPageState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { isDragActive, dropzoneHandlers } = useFileDropzone({ onFile: handleFileSelect })

  // Leaving mid-scan (the bottom nav, Cancel) tears down a scan still in flight
  // (issue #642): the request is aborted so a vision call nobody is waiting for
  // stops billing, and `unmountedRef` keeps its late settle from touching state
  // or handing a scan to a user who has gone elsewhere.
  const scanTokenRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      abortControllerRef.current?.abort()
    }
  }, [])

  async function handleFileSelect(file: File) {
    // A second pick/drop while a scan is in flight (double tap, a drop during
    // the exit animation) must not start a second billed request.
    if (inFlightRef.current) return
    inFlightRef.current = true
    const token = ++scanTokenRef.current
    const controller = new AbortController()
    abortControllerRef.current = controller
    const isStale = () => unmountedRef.current || scanTokenRef.current !== token

    setError(null)
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    setState('processing')

    try {
      const result: ScanResult = await uploadReceipt(file, { signal: controller.signal })
      if (isStale()) return
      if (
        isEmptyScan({
          ready_to_add: result.ready_to_add,
          needs_review: result.needs_review,
          skipped: result.skipped,
        })
      ) {
        // The scan worked but found nothing: say so, rather than putting an
        // empty scan away (#642).
        setError(scanErrorCopy(SCAN_NO_ITEMS_CODE))
        setState('upload')
        if (inputRef.current) inputRef.current.value = ''
        return
      }
      setState('handoff')
      handOff(result)
    } catch (err) {
      if (isStale()) return
      // #396 — never render a raw error at the user. ScanTab had this fixed;
      // this route builds its own state machine and was missed, so a network
      // TypeError or a proxy 502 still leaked raw text here.
      setError(scanErrorCopy(err instanceof ScanError ? err.code : undefined))
      setState('upload')
      // Retrying the same receipt is the obvious next move after a transient
      // failure, but `onChange` doesn't fire for an unchanged value — so
      // without this the same file simply does nothing (#246).
      if (inputRef.current) inputRef.current.value = ''
    } finally {
      // Only the scan that is still current may release the in-flight flag —
      // a cancelled scan settling late must not free a newer one's slot.
      if (scanTokenRef.current === token) inFlightRef.current = false
      setTimeout(() => URL.revokeObjectURL(objectUrl), 500)
    }
  }

  /** Abandon the scan in flight and go back to the upload step, no error. */
  function handleCancelScan() {
    scanTokenRef.current++ // the in-flight scan is now stale; its settle is ignored
    inFlightRef.current = false
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setState('upload')
    setPreview(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="min-h-screen pb-24">
      <BubblesHeader
        rightSlot={
          <Link
            href="/"
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
              <button
                type="button"
                onClick={handleCancelScan}
                className="mt-4 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] underline transition-colors"
              >
                Cancel scan
              </button>
            </motion.div>
          )}

          {state === 'handoff' && (
            <motion.div
              key="handoff"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              className="text-center"
              role="status"
            >
              <div className="flex justify-center mb-3">
                <BubblesMascot state="happy" size={72} />
              </div>
              <p className="font-semibold text-[var(--color-text)]">
                Taking your shopping to the kitchen…
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
