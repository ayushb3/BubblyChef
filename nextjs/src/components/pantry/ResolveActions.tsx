'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
   * `bar` (default): full-width keys under a card, split by hairlines.
   * `pills` (the storage sheet's List, issue #750): rounded ink-edged keys in one
   * row, so an expiring row stays a single compact strip.
   */
  variant?: 'bar' | 'pills'
  /**
   * "Cook something with it": a chat seeded with this item. Omit it when there
   * is nothing to cook (the food has already expired) and the row is just
   * Used it / Tossed.
   */
  cookHref?: string
}

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]'

/**
 * One row of three icon-only keys for expired and expiring-soon cards: cook
 * (🍳), used it (✓), tossed (🗑) (#813).
 *
 * The words ("Cook this", "Used it", "Tossed") used to sit on every card and
 * cost two rows of height, so they are gone from the surface. The meaning is
 * kept in the aria-label (assistive tech) and a native `title` (hover). The
 * keys stay a full 44px square (WCAG 2.5.5) and keep the fresh / expired colour
 * coding.
 *
 * Urgency buys the card real estate: these items are the whole point of the
 * expiry feature, so their resolve action is a present affordance rather than
 * something the user has to discover by dragging. Everything else in the pantry
 * gets `SwipeToResolve` instead, which keeps normal cards visually clean.
 *
 * "Tossed" is destructive and irreversible (the pantry row is deleted and an
 * append-only event is written), so it swaps to an inline confirm rather than
 * firing on first tap. "Used it" is the happy path and commits directly —
 * the item is gone either way, and only the recorded outcome differs.
 */
export default function ResolveActions({
  itemName,
  onResolve,
  pending = false,
  variant = 'bar',
  cookHref,
}: ResolveActionsProps) {
  const [confirmingToss, setConfirmingToss] = useState(false)
  const tossRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const pills = variant === 'pills'

  // Cancelling the confirm unmounts the button the keyboard was on; hand focus
  // back to the Tossed key rather than dropping it to the page.
  useEffect(() => {
    if (!confirmingToss && returnFocus.current) {
      returnFocus.current = false
      tossRef.current?.focus()
    }
  }, [confirmingToss])

  // Every key is a full 44px square (WCAG 2.5.5); the confirm's text stays text-xs.
  const base = 'flex-1 min-h-[44px] min-w-[44px] disabled:opacity-60'
  const icon = `${base} inline-flex items-center justify-center text-lg leading-none`
  const text = `${base} text-xs font-semibold`
  const pill =
    'rounded-full border-2 border-[var(--color-text)] font-extrabold shadow-[0_2px_0_var(--color-text)] active:translate-y-px'
  const hairline = 'border-l border-[var(--color-border)]'

  const rowClass = pills ? 'flex gap-2 px-2 pt-1 pb-2' : 'border-t border-[var(--color-border)] flex'

  if (confirmingToss) {
    return (
      <div className={rowClass}>
        <button
          type="button"
          disabled={pending}
          onClick={() => onResolve('tossed')}
          aria-label={`Confirm ${itemName} was tossed`}
          className={`${text} text-[var(--color-expired-text)] bg-[var(--color-expired)] ${FOCUS} ${
            pills ? pill : 'hover:brightness-95'
          }`}
        >
          {pending ? 'Tossing…' : 'Really toss?'}
        </button>
        <button
          type="button"
          autoFocus
          disabled={pending}
          onClick={() => {
            returnFocus.current = true
            setConfirmingToss(false)
          }}
          aria-label="Cancel"
          className={
            pills
              ? `${text} flex-none px-4 bg-[var(--color-surface)] text-[var(--color-text)] ${pill} ${FOCUS}`
              : `px-3 min-h-[44px] min-w-[44px] text-xs font-semibold text-[var(--color-muted)] ${hairline} hover:bg-[var(--color-border)] disabled:opacity-60 ${FOCUS}`
          }
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={rowClass}>
      {cookHref && (
        <Link
          href={cookHref}
          aria-label={`Cook something with ${itemName}`}
          title="Cook this"
          className={`${icon} text-[var(--color-text)] bg-[var(--color-primary)] ${FOCUS} ${
            pills ? pill : 'hover:brightness-95'
          }`}
        >
          <span aria-hidden="true">🍳</span>
        </Link>
      )}
      <motion.button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        whileTap={pending ? undefined : { scale: 0.97 }}
        transition={springs.snappy}
        onClick={() => onResolve('used')}
        aria-label={`Mark ${itemName} as used up`}
        title="Used it"
        className={`${icon} text-[var(--color-fresh-text)] bg-[var(--color-fresh)] ${FOCUS} ${
          pills ? pill : `hover:brightness-95 ${cookHref ? hairline : ''}`
        }`}
      >
        <span aria-hidden="true">{pending ? '…' : '✓'}</span>
      </motion.button>
      <motion.button
        ref={tossRef}
        type="button"
        disabled={pending}
        whileTap={pending ? undefined : { scale: 0.97 }}
        transition={springs.snappy}
        onClick={() => setConfirmingToss(true)}
        aria-label={`Mark ${itemName} as tossed`}
        title="Tossed"
        className={`${icon} text-[var(--color-expired-text)] bg-[var(--color-expired)] ${FOCUS} ${
          pills ? pill : `hover:brightness-95 ${hairline}`
        }`}
      >
        <span aria-hidden="true">🗑</span>
      </motion.button>
    </div>
  )
}
