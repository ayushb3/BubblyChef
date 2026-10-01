'use client'

import { useEffect, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { useCountUp, useMotionConfig, useReactionVariants } from '@/lib/motion'

/**
 * The bubbles counter (signature component #7, issue #741; board 7 of the
 * Signature components canvas).
 *
 * Settled with Ayush 2026-10-01: pixel digits (Pixelify Sans 700, tabular) in a
 * 2px stepped ink frame with a 2px hard shadow, beside an 8x8 pixel bubble at
 * 2x. It is the one header element in pixel type: the PRD counts the counter's
 * digits as in-world lettering. It is not a button; if a caller makes it one,
 * pad its hit area to 44px.
 *
 * When `value` rises it pops (scale 1 -> 1.12 -> 1, 260 ms), the digits count
 * up from the old value (~600 ms, at most 30 ticks, eased out) and a "+N" tag
 * rises 16px and fades (700 ms). It does none of that on first render or on a
 * drop. With reduced motion the number swaps once and "+N" fades in place.
 * The accessible name is always the final value ("240 bubbles"), never the
 * in-between digits.
 */
export interface BubblesCounterProps {
  /** The current balance. */
  value: number
  className?: string
  /** `data-testid` for the counter itself (the element carrying the aria-label). */
  testId?: string
}

// Stepped corners, as drawn on the boards: each corner is cut in two 2px stairs.
const STEPPED_CLIP =
  'polygon(0 4px, 2px 4px, 2px 2px, 4px 2px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 2px, calc(100% - 2px) 2px, calc(100% - 2px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 2px) calc(100% - 4px), calc(100% - 2px) calc(100% - 2px), calc(100% - 4px) calc(100% - 2px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 2px), 2px calc(100% - 2px), 2px calc(100% - 4px), 0 calc(100% - 4px))'

// The 8x8 pixel bubble: X ink outline, a accent body, W highlight.
const BUBBLE_ROWS = [
  '..XXXX..',
  '.XaaaaX.',
  'XaWWaaaX',
  'XaWaaaaX',
  'XaaaaaaX',
  'XaaaaaaX',
  '.XaaaaX.',
  '..XXXX..',
]
const BUBBLE_FILL: Record<string, string> = {
  X: 'var(--color-text)',
  a: 'var(--color-accent)',
  W: 'var(--color-surface)',
}

function PixelBubble() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="block shrink-0"
    >
      {BUBBLE_ROWS.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={BUBBLE_FILL[c]} />,
        ),
      )}
    </svg>
  )
}

const fmt = (n: number) => Math.max(0, Math.round(n)).toLocaleString('en-US')

export default function BubblesCounter({ value, className, testId }: BubblesCounterProps) {
  const { shown, rise, riseKey } = useCountUp(value)
  const { reduced } = useMotionConfig()
  const reactions = useReactionVariants()
  const controls = useAnimationControls()
  const [doneKey, setDoneKey] = useState(0)

  // Pop on every rise (not on first render or a drop). Under reduced motion the
  // number just swaps, so there is no pop.
  useEffect(() => {
    if (riseKey > 0 && !reduced) void controls.start('play')
  }, [riseKey, reduced, controls])

  // Reserve the width of the final value's digits so the frame never jitters
  // while the digits tick.
  const digitsWidth = `${fmt(value).length}ch`
  const showTag = riseKey > 0 && doneKey !== riseKey

  return (
    <div className={`relative inline-flex ${className ?? ''}`.trim()}>
      {showTag && (
        <motion.span
          key={riseKey}
          aria-hidden="true"
          data-testid="bubbles-counter-rise"
          className="font-pixel pointer-events-none absolute top-0 right-[calc(100%+8px)] border-2 border-[color:var(--color-text)] px-[5px] text-sm leading-[18px] font-bold whitespace-nowrap text-[color:var(--color-text)] shadow-[2px_2px_0_var(--color-text)]"
          style={{ background: 'var(--color-accent)' }}
          initial={reduced ? { opacity: 0 } : { opacity: 1, y: 0 }}
          animate={reduced ? { opacity: [0, 1, 1, 0] } : { opacity: 0, y: -16 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          onAnimationComplete={() => setDoneKey(riseKey)}
        >
          +{fmt(rise)}
        </motion.span>
      )}
      <motion.div
        role="group"
        aria-label={`${value} bubbles`}
        data-testid={testId}
        className="inline-flex"
        style={{ filter: 'drop-shadow(2px 2px 0 var(--color-text))' }}
        variants={reactions.pop}
        initial="idle"
        animate={controls}
      >
        <div
          className="p-0.5"
          style={{ background: 'var(--color-text)', clipPath: STEPPED_CLIP }}
        >
          <div
            className="font-pixel flex items-center gap-1.5 py-1 pr-2.5 pl-2 text-[17px] leading-5 font-bold text-[color:var(--color-text)] tabular-nums"
            style={{ background: 'var(--color-surface)', clipPath: STEPPED_CLIP }}
          >
            <PixelBubble />
            <span className="inline-block text-right" style={{ minWidth: digitsWidth }}>
              {fmt(shown)}
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
