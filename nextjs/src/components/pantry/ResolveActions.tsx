'use client'

import { useState, type ReactNode } from 'react'
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
  /**
   * `bar` (default): two full-width halves under a card, split by hairlines.
   * `pills` (the storage sheet's List, issue #750): rounded ink-edged keys in one
   * row, so an expiring row stays a single compact strip.
   */
  variant?: 'bar' | 'pills'
  /** `pills` only: extra keys to the left of Used it / Tossed (the "Cook this" link). */
  leading?: ReactNode
}

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]'

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
  variant = 'bar',
  leading,
}: ResolveActionsProps) {
  const [confirmingToss, setConfirmingToss] = useState(false)
  const pills = variant === 'pills'

  // Both targets are a full 44px tall (WCAG 2.5.5) while the labels stay
  // text-xs, so the layout doesn't reflow.
  const base = 'flex-1 min-h-[44px] text-xs font-semibold disabled:opacity-60'
  const pill =
    'rounded-full border-2 border-[var(--color-text)] font-extrabold shadow-[0_2px_0_var(--color-text)] active:translate-y-px'

  if (confirmingToss) {
    return (
      <div
        className={
          pills
            ? 'flex gap-2 px-2 pt-1 pb-2'
            : 'border-t border-[var(--color-border)] flex'
        }
      >
        <button
          type="button"
          disabled={pending}
          onClick={() => onResolve('tossed')}
          aria-label={`Confirm ${itemName} was tossed`}
          className={`${base} text-[var(--color-expired-text)] bg-[var(--color-expired)] ${FOCUS} ${
            pills ? pill : 'hover:brightness-95'
          }`}
        >
          {pending ? 'Tossing…' : 'Really toss?'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmingToss(false)}
          aria-label="Cancel"
          className={
            pills
              ? `${base} flex-none px-4 bg-[var(--color-surface)] text-[var(--color-text)] ${pill} ${FOCUS}`
              : `px-3 min-h-[44px] text-xs font-semibold text-[var(--color-muted)] border-l border-[var(--color-border)] hover:bg-[var(--color-border)] disabled:opacity-60 ${FOCUS}`
          }
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div
      className={
        pills ? 'flex gap-2 px-2 pt-1 pb-2' : 'border-t border-[var(--color-border)] flex'
      }
    >
      {pills && leading}
      <motion.button
        type="button"
        disabled={pending}
        whileTap={pending ? undefined : { scale: 0.97 }}
        transition={springs.snappy}
        onClick={() => onResolve('used')}
        aria-label={`Mark ${itemName} as used up`}
        className={`${base} text-[var(--color-fresh-text)] bg-[var(--color-fresh)] ${FOCUS} ${
          pills ? pill : 'hover:brightness-95'
        }`}
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
        className={
          pills
            ? `${base} bg-[var(--color-surface)] text-[var(--color-expired-text)] ${pill} ${FOCUS}`
            : `${base} text-[var(--color-muted)] border-l border-[var(--color-border)] hover:bg-[var(--color-border)] ${FOCUS}`
        }
      >
        🗑 Tossed
      </motion.button>
    </div>
  )
}
