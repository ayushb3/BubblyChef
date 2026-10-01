'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ScanDropzone, { ScanHandoffPanel, ScanProcessingPanel } from '@/components/scan/ScanDropzone'
import ScanFailureNotice from '@/components/scan/ScanFailureNotice'
import { useFileDropzone } from '@/hooks/useFileDropzone'
import { uploadReceipt, ScanError } from '@/lib/api/scan'
import { isEmptyScan } from '@/lib/scan-helpers'
import { GENERIC_SCAN_ERROR_CODE, SCAN_NO_ITEMS_CODE } from '@/lib/scan-error-copy'
import type { ScanResult } from '@/types/scan'

/**
 * The add sheet's scan tab: upload a receipt, wait for it to parse, then hand
 * the parsed scan to the host (issue #753).
 *
 * It no longer reviews the scan itself. A parsed scan is put away on the kitchen
 * home, in the put-away sheet (`PutAwaySheet`), the same place the `/scan` page
 * ends up: `onParsed` is the hand-off, and the host keeps the result and takes
 * the user home (`useScanHandOff`). Nothing is written here; the only pantry write
 * is put-away's "Put away" tap.
 *
 * It still owns the upload -> processing state machine and everything around it
 * (cancel, timeouts, friendly errors, the double-submit and stale-scan guards).
 */

type ScanTabState = 'upload' | 'processing' | 'handoff'

interface ScanTabProps {
  /**
   * A scan parsed with at least one item. The host takes it from here (keeps it
   * as the pending put-away and goes to the kitchen). Not called for an empty
   * scan, which is the friendly "nothing found" state here.
   */
  onParsed: (result: ScanResult) => void
  /**
   * Reports whether a scan is currently in flight so the parent sheet can
   * lock the Type tab for the duration (issue #402). Must fire `true` right
   * before the upload starts and `false` on every path out of `processing` —
   * success and failure/timeout alike — or the lock never releases.
   */
  onProcessingChange?: (processing: boolean) => void
}

export default function ScanTab({ onParsed, onProcessingChange }: ScanTabProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ScanTabState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  // A second pick/drop while a scan is in flight (double tap, a drop during
  // the exit animation) must not start a second billed request (issue #642).
  const inFlightRef = useRef(false)

  useEffect(() => {
    // Reset on mount too: React Strict Mode runs effect cleanup then setup
    // again on the same instance, which would otherwise leave this `true`.
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      // Stop billing a vision call the user already walked away from.
      abortControllerRef.current?.abort()
    }
  }, [])

  async function handleFileSelect(file: File) {
    if (inFlightRef.current) return
    inFlightRef.current = true
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
      if (
        isEmptyScan({
          ready_to_add: result.ready_to_add,
          needs_review: result.needs_review,
          // Skipped lines alone leave nothing to put away (#753).
          skipped: [],
        })
      ) {
        // The scan worked but found nothing: say so, rather than handing an
        // empty scan to put-away (#642).
        setError(SCAN_NO_ITEMS_CODE)
        setState('upload')
        if (inputRef.current) inputRef.current.value = ''
        return
      }
      setState('handoff')
      onParsed(result)
    } catch (err) {
      if (isStale()) return
      // Never render a raw server/provider string — always route through the
      // code -> copy mapping, falling back to generic friendly copy for
      // anything unrecognized (issue #396). This also covers the
      // client-side upload timeout (issue #402): it comes back as a
      // `ScanError` and must land here, not in some separate stuck state.
      setError(err instanceof ScanError ? err.code : GENERIC_SCAN_ERROR_CODE)
      setState('upload')
      // Retrying the same receipt is the obvious next move after a transient
      // failure, but `onChange` doesn't fire for an unchanged value — so
      // without this the same file simply does nothing (#246).
      if (inputRef.current) inputRef.current.value = ''
    } finally {
      // Only the current scan may release the in-flight flag; a cancelled one
      // settling late must not free a newer scan's slot.
      if (scanTokenRef.current === token) inFlightRef.current = false
      setTimeout(() => URL.revokeObjectURL(objectUrl), 500)
      // Every path out of `processing` — handed off or upload/error — must
      // release the Type-tab lock (issue #402), but only for the scan that
      // is still current; an abandoned/superseded scan must not touch it
      // (issue #439).
      if (!isStale()) onProcessingChange?.(false)
    }
  }

  /** Abandon the scan in flight, release the Type-tab lock, back to upload. */
  function handleCancelScan() {
    scanTokenRef.current++ // the in-flight scan is now stale; its settle is ignored
    inFlightRef.current = false
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setState('upload')
    setPreview(null)
    setError(null)
    onProcessingChange?.(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      {error && <ScanFailureNotice code={error} onRetry={() => inputRef.current?.click()} />}

      <AnimatePresence mode="wait">
        {state === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            <ScanDropzone
              isDragActive={isDragActive}
              dropzoneHandlers={dropzoneHandlers}
              onChoose={() => inputRef.current?.click()}
              hasError={!!error}
            />

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
          >
            <ScanProcessingPanel preview={preview} onCancel={handleCancelScan} />
          </motion.div>
        )}

        {state === 'handoff' && (
          <motion.div
            key="handoff"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            role="status"
          >
            <ScanHandoffPanel />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
