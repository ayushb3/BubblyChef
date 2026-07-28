'use client'

import { useEffect, useRef, useState } from 'react'
import { resolvePantryItem, type ResolveOutcome } from '@/lib/api/pantry'

interface ResolveActionsProps {
  itemId: string
  /** Raw (non-title-cased) pantry name — only used for accessible labels/copy. */
  itemName: string
  /** Called after a successful resolve so the caller can refetch/remove the row. */
  onResolved: () => void
  className?: string
}

type Status = 'idle' | 'confirm-toss' | 'resolving'

/**
 * "Used it up" / "Tossed it" — issue #140's UI half.
 *
 * Both outcomes delete the pantry item (`resolvePantryItem`), so a stray tap
 * on either one loses the row. "Used it up" fires immediately: it's the
 * outcome the whole app is nudging toward (finish food before it expires),
 * and a false positive here costs nothing you weren't already about to
 * do — the item was going to be consumed anyway. "Tossed it" is the one that
 * more plausibly comes from a mis-tap (it sits right next to "Used it up",
 * same size, same row) and is the one a user is likely to regret logging by
 * accident (it also miscounts food waste). So only "Tossed it" gets a second,
 * explicit tap via an inline confirm swap — same pattern as
 * `RecipeDeleteConfirm` / `AddItemModal`'s delete-confirm toggle — rather
 * than a swipe gesture or a modal.
 */
export default function ResolveActions({ itemId, itemName, onResolved, className }: ResolveActionsProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [pendingOutcome, setPendingOutcome] = useState<ResolveOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tossButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const hasMountedRef = useRef(false)

  const busy = status === 'resolving'

  // The confirm swap unmounts whichever button triggered it, which strands
  // focus on <body> for keyboard/screen-reader users unless we move it
  // ourselves. Skip the very first render (mount) — this effect should only
  // react to the idle <-> confirm-toss transition, never steal focus on load.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    if (status === 'confirm-toss') {
      // Land on "Cancel", not "Yes, toss it": this is the one destructive,
      // hard-to-undo action in the component, and whichever control has
      // focus is the one a bare Enter/Space keypress will hit next.
      cancelButtonRef.current?.focus()
    } else if (status === 'idle') {
      // Cancelling (or a failed toss resolve) returns to idle — send focus
      // back to the "Tossed it" button that opened the confirm view rather
      // than dropping it.
      tossButtonRef.current?.focus()
    }
  }, [status])

  async function resolve(outcome: ResolveOutcome) {
    if (busy) return // guards double-tap while a request is in flight
    setStatus('resolving')
    setPendingOutcome(outcome)
    setError(null)
    try {
      await resolvePantryItem(itemId, outcome)
      onResolved()
      // No further state update on success: the parent's refetch removes
      // this row/card entirely, so there's nothing left to render here.
    } catch (err) {
      // The one route-specific 500 (event recorded, delete failed) surfaces
      // here with its own message from resolvePantryItem — the caller must
      // not be left thinking the item quietly vanished when it didn't.
      setStatus('idle')
      setPendingOutcome(null)
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    }
  }

  if (status === 'confirm-toss') {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className="text-xs text-[var(--color-muted)] flex-1 min-w-0 truncate">
          Toss {itemName}?
        </span>
        <button
          type="button"
          onClick={() => resolve('tossed')}
          disabled={busy}
          className="focus-ring min-h-[44px] px-3 rounded-full text-xs font-semibold bg-[var(--color-expired)] text-[var(--color-expired-text)] disabled:opacity-50"
        >
          {busy ? 'Tossing…' : 'Yes, toss it'}
        </button>
        <button
          ref={cancelButtonRef}
          type="button"
          onClick={() => setStatus('idle')}
          disabled={busy}
          className="focus-ring min-h-[44px] px-3 rounded-full text-xs font-semibold border border-[var(--color-border)] text-[var(--color-muted)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => resolve('used')}
          disabled={busy}
          aria-label={`Mark ${itemName} used up`}
          className="focus-ring flex-1 min-h-[44px] px-2 rounded-full text-xs font-semibold bg-[var(--color-fresh)] text-[var(--color-fresh-text)] disabled:opacity-50"
        >
          {busy && pendingOutcome === 'used' ? 'Saving…' : '✅ Used it up'}
        </button>
        <button
          ref={tossButtonRef}
          type="button"
          onClick={() => setStatus('confirm-toss')}
          disabled={busy}
          aria-label={`Toss ${itemName}`}
          className="focus-ring flex-1 min-h-[44px] px-2 rounded-full text-xs font-semibold border border-[var(--color-border)] text-[var(--color-muted)] disabled:opacity-50"
        >
          🗑️ Tossed it
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-1.5 flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl text-xs bg-[var(--color-expired)] text-[var(--color-expired-text)]"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="focus-ring flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
