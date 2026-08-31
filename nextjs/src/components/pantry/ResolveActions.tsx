'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { springs } from '@/lib/motion'
import type { ResolveOutcome } from '@/lib/api/pantry'

export interface ResolveActionsProps {
  /** Item being resolved — used for accessible labels only. */
  itemName: string
  /** Fires with the chosen outcome. The parent owns the mutation. */
  onResolve: (outcome: ResolveOutcome) => void
  /** True while the parent's mutation is in flight. */
  pending?: boolean
}

/**
 * Visible "Used it up" / "Tossed it" buttons for expired and expiring-soon
 * cards (#140).
 *
 * Urgency buys the card real estate: these items are the whole point of the
 * expiry feature, so their resolve action is a present affordance rather than
 * something the user has to discover by dragging. Everything else in the pantry
 * gets `SwipeToResolve` instead, which keeps normal cards visually clean.
 *
 * "Tossed it" is destructive and irreversible (the pantry row is deleted and an
 * append-only event is written), so it swaps to an inline confirm rather than
 * firing on first tap. "Used it up" is the happy path and commits directly —
 * the item is gone either way, and only the recorded outcome differs.
 */
export default function ResolveActions({
  itemName,
  onResolve,
  pending = false,
}: ResolveActionsProps) {
  const [confirmingToss, setConfirmingToss] = useState(false)

  if (confirmingToss) {
    return (
      <div className="border-t border-[var(--color-border)] flex">
        <button
          type="button"
          disabled={pending}
          onClick={() => onResolve('tossed')}
          aria-label={`Confirm ${itemName} was tossed`}
          className="flex-1 min-h-[44px] text-xs font-semibold text-[var(--color-expired-text)] bg-[var(--color-expired)] hover:brightness-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]"
        >
          {pending ? 'Tossing…' : 'Really toss?'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmingToss(false)}
          aria-label="Cancel"
          className="px-3 min-h-[44px] text-xs font-semibold text-[var(--color-muted)] border-l border-[var(--color-border)] hover:bg-[var(--color-border)] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--color-border)] flex">
      {/* Both targets are a full 44px tall (WCAG 2.5.5) while the labels stay
          text-xs, so the two-column card grid doesn't reflow. */}
      <motion.button
        type="button"
        disabled={pending}
        whileTap={pending ? undefined : { scale: 0.97 }}
        transition={springs.snappy}
        onClick={() => onResolve('used')}
        aria-label={`Mark ${itemName} as used up`}
        className="flex-1 min-h-[44px] text-xs font-semibold text-[var(--color-fresh-text)] bg-[var(--color-fresh)] hover:brightness-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]"
      >
        {pending ? 'Saving…' : '✓ Used it'}
      </motion.button>
      <motion.button
        type="button"
        disabled={pending}
        whileTap={pending ? undefined : { scale: 0.97 }}
        transition={springs.snappy}
        onClick={() => setConfirmingToss(true)}
        aria-label={`Mark ${itemName} as tossed`}
        className="flex-1 min-h-[44px] text-xs font-semibold text-[var(--color-muted)] border-l border-[var(--color-border)] hover:bg-[var(--color-border)] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]"
      >
        🗑 Tossed
      </motion.button>
    </div>
  )
}
