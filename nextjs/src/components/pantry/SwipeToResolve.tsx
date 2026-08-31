'use client'

import { useState } from 'react'
import { motion, useReducedMotion, type PanInfo } from 'framer-motion'
import { springs } from '@/lib/motion'
import type { ResolveOutcome } from '@/lib/api/pantry'

/** Drag distance (px) at which the action icon is fully revealed. */
export const REVEAL_DISTANCE = 64
/** Drag distance (px) past which releasing commits the action outright. */
export const COMMIT_DISTANCE = 132

/**
 * A swipe can only ever mean "used" or "tossed". `ResolveOutcome` also allows
 * "cooked", which is recorded by the cook flow rather than by a gesture, so the
 * gesture is typed to the narrower set — otherwise the reveal state has to
 * pretend it can hold a value this component can never produce.
 */
export type SwipeOutcome = Extract<ResolveOutcome, 'used' | 'tossed'>

export type GestureVerdict =
  | { kind: 'commit'; outcome: SwipeOutcome }
  | { kind: 'reveal'; outcome: SwipeOutcome }
  | { kind: 'reset' }

/**
 * What a released drag of `dx` pixels means. Pure, and exported, because this
 * is the safety mechanism: the spec dropped the confirm dialog on the grounds
 * that a light swipe cannot commit, so "how far is far enough" is the rule that
 * has to be right. framer-motion's drag does not run under jsdom, so testing it
 * through the component would assert nothing.
 *
 * Right is "used up", left is "tossed".
 */
export function gestureVerdict(dx: number): GestureVerdict {
  const outcome: SwipeOutcome = dx > 0 ? 'used' : 'tossed'
  if (Math.abs(dx) >= COMMIT_DISTANCE) return { kind: 'commit', outcome }
  if (Math.abs(dx) >= REVEAL_DISTANCE) return { kind: 'reveal', outcome }
  return { kind: 'reset' }
}

export interface SwipeToResolveProps {
  itemName: string
  onResolve: (outcome: ResolveOutcome) => void
  pending?: boolean
  children: React.ReactNode
}

type Revealed = SwipeOutcome | null

/**
 * Graduated swipe-to-resolve for ordinary pantry cards (#140).
 *
 * Swipe right = "Used it up", swipe left = "Tossed it" — one continuous drag,
 * not two discrete gestures:
 *
 * 1. A short drag reveals the action icon and stops there. Releasing at this
 *    stage does nothing and the card springs back.
 * 2. From the revealed state, tapping the icon commits.
 * 3. Continuing the same drag past COMMIT_DISTANCE commits on release.
 *
 * The graduation *is* the safety mechanism, which is why there's no confirm
 * dialog or undo toast on top of it: a light swipe cannot commit, and only a
 * deliberate tap or a decisive drag does. Layering a confirm on top would make
 * the fast path slower than the buttons it exists to avoid.
 *
 * Expiring and expired cards use `ResolveActions` instead — urgency earns a
 * visible affordance, and this component is what keeps every *other* card clean.
 *
 * Reduced motion: the drag is disabled entirely rather than merely shortened,
 * and the parent is expected to fall back to `ResolveActions`. A gesture whose
 * whole feedback channel is movement is not usable without it.
 */
export default function SwipeToResolve({
  itemName,
  onResolve,
  pending = false,
  children,
}: SwipeToResolveProps) {
  const [revealed, setRevealed] = useState<Revealed>(null)
  const prefersReduced = useReducedMotion()

  function handleDragEnd(_e: unknown, info: PanInfo) {
    const verdict = gestureVerdict(info.offset.x)

    if (verdict.kind === 'commit') {
      // Past the threshold: the drag itself is the confirmation.
      onResolve(verdict.outcome)
      setRevealed(null)
      return
    }

    if (verdict.kind === 'reveal') {
      // Hold the icon open, awaiting a tap.
      setRevealed(verdict.outcome)
      return
    }

    // A stray touch — reset with no side effect.
    setRevealed(null)
  }

  const dragEnabled = !pending && !prefersReduced

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Action layer, revealed as the card slides off it. aria-hidden because
          the buttons below are the accessible path; a screen-reader user should
          never be asked to perform a drag. */}
      <div className="absolute inset-0 flex items-stretch" aria-hidden>
        <div className="flex-1 flex items-center justify-start px-4 bg-[var(--color-fresh)] text-[var(--color-fresh-text)] text-xs font-semibold">
          ✓ Used it
        </div>
        <div className="flex-1 flex items-center justify-end px-4 bg-[var(--color-expired)] text-[var(--color-expired-text)] text-xs font-semibold">
          🗑 Tossed
        </div>
      </div>

      <motion.div
        drag={dragEnabled ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        animate={{
          x:
            revealed === 'used'
              ? REVEAL_DISTANCE
              : revealed === 'tossed'
                ? -REVEAL_DISTANCE
                : 0,
        }}
        transition={springs.snappy}
        className="relative bg-[var(--color-surface)] touch-pan-y"
      >
        {children}
      </motion.div>

      {/* The commit control for stage 2. Rendered only while revealed, and
          always as a real button so the action is reachable by keyboard and
          assistive tech even though the reveal itself is a gesture. */}
      {revealed && (
        <motion.button
          type="button"
          autoFocus
          disabled={pending}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={springs.snappy}
          onClick={() => {
            onResolve(revealed)
            setRevealed(null)
          }}
          onBlur={() => setRevealed(null)}
          aria-label={
            revealed === 'used'
              ? `Confirm ${itemName} was used up`
              : `Confirm ${itemName} was tossed`
          }
          className={[
            'absolute inset-y-0 w-16 flex items-center justify-center text-lg',
            'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary-dark)]',
            revealed === 'used'
              ? 'left-0 text-[var(--color-fresh-text)]'
              : 'right-0 text-[var(--color-expired-text)]',
          ].join(' ')}
        >
          {revealed === 'used' ? '✓' : '🗑'}
        </motion.button>
      )}
    </div>
  )
}
