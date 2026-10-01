'use client'

/**
 * Put-away (issue #753, board A3 "After a scan: put the shopping away"): the
 * sheet that opens over the kitchen after a receipt scan.
 *
 * It is the shared scan review (`ReviewSurface`) regrouped by place, with the
 * confirm key under it. The scene stays visible above (no scrim, and the sheet
 * is capped to start below the places' tags), so each place's +N badge and
 * Bubbles at the door are part of the picture.
 *
 *   header     "Put the shopping away?", the store and the item count
 *   asked      "Did I read these right?": Fix / Yes on each unsure item
 *   going in   grouped by place, each group with Edit
 *   skipped    "Skipped N lines" with Show
 *   key        "Put away N items", under "Nothing goes in until you tap this."
 *
 * Confirm semantics are the scan's (CLAUDE.md): **nothing is written before the
 * key is tapped.** The tap writes through the one existing bulk pantry write
 * (`bulkAddPantryItems`), each item with the place it is displayed under. On
 * success the pending scan is cleared and the sheet closes (`onPutAway` runs
 * first, so home can refresh its counts); on failure the sheet stays open with
 * the items, a friendly error, and the key wiggles. The hop-into-place animation
 * is issue #754 and plays after a successful write.
 *
 * The record (`PendingPutAway`, in local storage) is the single source of truth:
 * every edit is written back to it, so the +N badges follow a moved place and a
 * reload reopens put-away exactly as it was left. Closing the sheet leaves the
 * scan pending; only Put away or Discard clears it.
 *
 * Contract for `frontend` (HeroHome):
 *  - `open` / `onClose`: controlled; `onClose` is Escape, a scrim tap, the close
 *    button and drag-dismiss. It never clears the pending scan.
 *  - `record`: from `usePendingPutAway()`. The sheet keeps the last record on
 *    screen while it animates out after the record clears.
 *  - `onPutAway(count)`: after the write succeeded, before the record clears.
 *    May return a promise (the counts refresh); a rejection is ignored, since
 *    the pantry is already written.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import PixelSheet from '@/components/ui/PixelSheet'
import BubblesMascot from '@/components/ui/BubblesMascot'
import SpringButton from '@/components/ui/SpringButton'
import ReviewSurface, { type PutAwayTiers } from '@/components/scan/ReviewSurface'
import { bulkAddPantryItems } from '@/lib/api/pantry'
import { scannedToBulkAddItem } from '@/lib/scan-helpers'
import { useReactionVariants } from '@/lib/motion'
import { WALL_H } from '@/lib/kitchen/slots'
import {
  clearPendingPutAway,
  pendingItemCount,
  savePendingPutAway,
  type PendingPutAway,
} from '@/lib/kitchen/pending-putaway'

/** Row at the bottom of the lowest place tag (the basket's, `PLACE_BOXES`). The sheet starts below it. */
const TAGS_END_ROW = 55.2

const PUT_AWAY_ERROR =
  "Couldn't put the shopping away. Nothing was added, so try again in a moment."

export interface PutAwaySheetProps {
  open: boolean
  onClose: () => void
  record: PendingPutAway | null
  onPutAway: (count: number) => void | Promise<void>
}

function plural(n: number): string {
  return n === 1 ? 'item' : 'items'
}

export default function PutAwaySheet({ open, onClose, record, onPutAway }: PutAwaySheetProps) {
  const queryClient = useQueryClient()
  const { wiggle } = useReactionVariants()
  const wiggleControls = useAnimationControls()

  // The record clears the moment the write lands; the sheet is still animating
  // out then, so it draws the last record it had rather than going blank.
  const [lastRecord, setLastRecord] = useState<PendingPutAway | null>(record)
  if (record && record !== lastRecord) setLastRecord(record)
  const shown = record ?? lastRecord

  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [wiggles, setWiggles] = useState(0)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [maxHeight, setMaxHeight] = useState<string | undefined>(undefined)

  // Start from a clean sheet each time it opens (adjusted during render, not in
  // an effect, so a reopened sheet never flashes the last attempt's error).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setError(null)
      setConfirmingDiscard(false)
    }
  }

  // Leave the scene visible above the sheet: back to the top of home, and cap
  // the sheet so it starts below the lowest place tag. Measured off the wall (the
  // header above it can be any height), and again if the phone turns.
  useLayoutEffect(() => {
    if (!open) return
    function fit() {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      const wall = document.querySelector<HTMLElement>('[data-testid="kitchen-wall"]')
      if (!wall) {
        setMaxHeight(undefined)
        return
      }
      const rect = wall.getBoundingClientRect()
      const sheetTop = rect.top + (rect.height * TAGS_END_ROW) / WALL_H + 8
      const vh = window.innerHeight
      // Never so short the form is unusable, never past the sheet's own 90% cap.
      const height = Math.min(vh * 0.9, Math.max(vh * 0.55, vh - sheetTop))
      setMaxHeight(`${Math.round(height)}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])

  if (!shown) return null

  const count = pendingItemCount(shown)

  function edit(next: PutAwayTiers) {
    if (!shown) return
    const everythingGone =
      next.readyToAdd.length + next.needsReview.length + next.skipped.length === 0
    if (everythingGone) {
      // Every line left out: there is no scan left to put away.
      clearPendingPutAway()
      onClose()
      return
    }
    savePendingPutAway({
      ...shown,
      ready: next.readyToAdd,
      review: next.needsReview,
      skipped: next.skipped,
    })
  }

  async function putAway() {
    if (!shown || submittingRef.current) return
    const items = [...shown.ready, ...shown.review]
    if (items.length === 0) return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)

    try {
      await bulkAddPantryItems(items.map(scannedToBulkAddItem))
    } catch {
      // Never the raw server message. The scan and the items stay as they were.
      setError(PUT_AWAY_ERROR)
      setWiggles((n) => n + 1)
      void wiggleControls.start('play')
      submittingRef.current = false
      setSubmitting(false)
      return
    }

    queryClient.invalidateQueries({ queryKey: ['pantry'] })
    queryClient.invalidateQueries({ queryKey: ['bubbles'] })
    try {
      await onPutAway(items.length)
    } catch {
      // The pantry is written; a failed refresh must not leave the scan pending
      // (a reload would put the same shopping away twice).
    }
    clearPendingPutAway()
    submittingRef.current = false
    setSubmitting(false)
    onClose()
  }

  function discard() {
    clearPendingPutAway()
    onClose()
  }

  const store = shown.store ? `${shown.store} · ` : ''

  return (
    <PixelSheet
      open={open}
      onClose={() => {
        // A write in flight is not an abandon gesture: it finishes, then closes.
        if (!submittingRef.current) onClose()
      }}
      closeDisabled={submitting}
      title="Put the shopping away?"
      subtitle={<span className="tabular-nums">{`${store}${count} ${plural(count)}`}</span>}
      icon={<BubblesMascot state="happy" size={36} animate={false} />}
      scrim={false}
      maxHeight={maxHeight}
      testId="put-away-sheet"
      footer={
        <div className="flex flex-col gap-1.5">
          {error && (
            <p
              role="alert"
              className="rounded-xl border-2 border-[color:var(--color-expired-text)] bg-[var(--color-expired)] px-3 py-2 text-[13px] font-bold text-[color:var(--color-expired-text)]"
            >
              {error}
            </p>
          )}
          <motion.div
            data-testid="put-away-key"
            data-wiggles={wiggles}
            variants={wiggle}
            initial="idle"
            animate={wiggleControls}
          >
            <SpringButton
              fullWidth
              loading={submitting}
              disabled={count === 0}
              onClick={putAway}
            >
              {submitting
                ? 'Putting away…'
                : count === 0
                  ? 'Nothing to put away'
                  : `Put away ${count} ${plural(count)}`}
            </SpringButton>
          </motion.div>
          <p className="self-center text-xs font-bold text-[color:var(--color-text)]">
            Nothing goes in until you tap this.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <ReviewSurface
          readyToAdd={shown.ready}
          needsReview={shown.review}
          skipped={shown.skipped}
          warnings={shown.warnings}
          onChange={edit}
          disabled={submitting}
        />

        {confirmingDiscard ? (
          <div
            role="group"
            aria-label="Discard this scan"
            className="flex flex-wrap items-center gap-2 text-xs font-bold text-[color:var(--color-text)]"
          >
            <span>Discard this scan?</span>
            <SpringButton size="sm" variant="danger" onClick={discard} disabled={submitting}>
              Yes, discard it
            </SpringButton>
            <SpringButton size="sm" variant="secondary" onClick={() => setConfirmingDiscard(false)}>
              Keep it
            </SpringButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDiscard(true)}
            disabled={submitting}
            className="min-h-[44px] self-start rounded-full px-1 text-xs font-extrabold text-[color:var(--color-text)] underline disabled:opacity-60"
          >
            Discard this scan
          </button>
        )}
      </div>
    </PixelSheet>
  )
}
