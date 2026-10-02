'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import BubblesHeader from '@/components/layout/BubblesHeader'
import ProfileHeaderButton from '@/components/layout/ProfileHeaderButton'
import ScanDropzone, { ScanHandoffPanel, ScanProcessingPanel } from '@/components/scan/ScanDropzone'
import ScanFailureNotice from '@/components/scan/ScanFailureNotice'
import { useFileDropzone } from '@/hooks/useFileDropzone'
import { useGroceryCount } from '@/hooks/useGroceryCount'
import { useScanHandOff } from '@/hooks/useScanHandOff'
import { uploadReceipt, ScanError } from '@/lib/api/scan'
import {
  GENERIC_SCAN_ERROR_CODE,
  SCAN_NO_ITEMS_CODE,
  SCAN_NOT_A_RECEIPT_CODE,
} from '@/lib/scan-error-copy'
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
  const router = useRouter()
  const groceryCount = useGroceryCount()
  const inputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<ScanPageState>('upload')
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { isDragActive, dropzoneHandlers } = useFileDropzone({ onFile: handleFileSelect })

  // Leaving mid-scan (the bottom nav) tears down a scan still in flight
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
          // Skipped lines alone leave nothing to put away (#753).
          skipped: [],
        })
      ) {
        // The scan worked but found nothing: say so, rather than putting an
        // empty scan away (#642).
        // Not a receipt and nothing in it (#856): say that, not "nothing found".
        setError(result.is_receipt === false ? SCAN_NOT_A_RECEIPT_CODE : SCAN_NO_ITEMS_CODE)
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
      setError(err instanceof ScanError ? err.code : GENERIC_SCAN_ERROR_CODE)
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
      <BubblesHeader rightSlot={<ProfileHeaderButton />} />

      <div className="px-6 pt-4">
        {/* The page's own heading: the shared header above says BubblyChef (#894). */}
        <h2 className="mb-3 text-2xl leading-[30px] font-bold text-[color:var(--color-text)]">
          Scan a receipt
        </h2>

        {error && (
          <ScanFailureNotice code={error} onRetry={() => inputRef.current?.click()} />
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
              <ScanDropzone
                isDragActive={isDragActive}
                dropzoneHandlers={dropzoneHandlers}
                onChoose={() => inputRef.current?.click()}
                hasError={!!error}
              />

              {/* The way into the grocery list: the header carries no grocery button (#905). */}
              <div className="mt-4 flex justify-center">
                <SpringButton variant="secondary" onClick={() => router.push('/grocery')}>
                  <span aria-hidden="true">🛒</span> Grocery list
                  {!groceryCount.loading && groceryCount.count > 0 && (
                    <span className="tabular-nums">
                      · {groceryCount.count} {groceryCount.count === 1 ? 'item' : 'items'}
                    </span>
                  )}
                </SpringButton>
              </div>

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
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              role="status"
            >
              <ScanHandoffPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
