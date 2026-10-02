'use client'

import { useState } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { useMotionConfig, useSteppedFrame } from '@/lib/motion'

export type BubblesState = 'happy' | 'surprised' | 'thinking' | 'worried' | 'celebrate'

interface BubblesMascotProps {
  state?: BubblesState
  size?: number
  className?: string
  animate?: boolean
  /**
   * The two-frame flip-book (issue #887): the original image, then the mirrored
   * one, a hard cut every `FLIP_MS`. On by default for `thinking` and off for
   * every other pose; pass `flip` to give any pose the flip (a tap reaction, say)
   * or `flip={false}` to hold the thinking pose still. Always still under
   * reduced motion or `animate={false}`.
   */
  flip?: boolean
  /** The flip's beat in ms (default `FLIP_MS`). A tap reaction wants a quicker one. */
  flipMs?: number
  /**
   * Whether `celebrate` plays its one-shot scale bounce and sparkle burst (default
   * true). Pass `false` to use the celebrate art as a resting pose that only
   * bobs (the page header, issue #894), so it does not go off on every mount.
   */
  burst?: boolean
}

// Exported (not just module-private) so tests can walk every entry and
// assert the rendered `src` and the on-disk file both match — see issue
// #612 (a wrong path here renders nothing, silently, because of the
// `onError` handler below).
export const STATE_SRC: Record<BubblesState, string> = {
  happy: '/mascot/bubbles-happy.png',
  surprised: '/mascot/bubbles-surprised.png',
  thinking: '/mascot/bubbles-thinking.png',
  // Final art (issue #527): dedicated "sad" expression, no longer the
  // thinking pose + droplet badge placeholder.
  worried: '/mascot/bubbles-sad.png',
  celebrate: '/mascot/bubbles-celebrate.png',
}

/**
 * The flip-book beat (issue #887): the original image, then the same image
 * mirrored, a hard stepped cut (no tween) every `FLIP_MS`. Bubbly is part of the
 * world, so it steps frame by frame rather than gliding. Under reduced motion, or
 * with `animate={false}`, it holds the original frame.
 */
export const FLIP_MS = 450
/** The thinking pose's beat; the same flip-book. */
export const THINKING_FLIP_MS = FLIP_MS

/** Sparkle burst positions fired outward from the mascot on `celebrate` (issue #525). */
const SPARKLES = [
  { emoji: '✨', x: -18, y: -22, delay: 0 },
  { emoji: '✨', x: 20, y: -18, delay: 0.05 },
  { emoji: '✨', x: 0, y: -30, delay: 0.1 },
] as const

export default function BubblesMascot({
  state = 'happy',
  size = 80,
  className,
  animate = true,
  flip,
  flipMs = FLIP_MS,
  burst = true,
}: BubblesMascotProps) {
  // Gates all new motion (bounce, sparkle burst) on top of the existing
  // `animate` prop gate — `prefers-reduced-motion: reduce` still swaps the
  // image/badge for the right state, it just skips the movement.
  const { reduced: prefersReducedMotion } = useMotionConfig()
  const motionEnabled = animate && !prefersReducedMotion
  // `useSteppedFrame` already holds frame 0 under reduced motion; `flips &&
  // animate` keeps every still use off the timer.
  const flips = flip ?? state === 'thinking'
  const flipFrame = useSteppedFrame(2, flipMs, flips && animate)
  const mirrored = flips && flipFrame === 1

  // Re-mounting BubblesMascot with `state="celebrate"` already replays the
  // bounce (it's driven by `animate` running from `initial` on mount), but a
  // long-lived instance that flips into `celebrate` and back needs its own
  // replay key so the transition into `celebrate` always restarts the
  // animation rather than being a no-op re-render. Computed during render
  // (comparing against the previous state via a ref-like piece of state)
  // rather than in an effect, per React's guidance on adjusting state when a
  // prop changes — an effect here would cause an extra, avoidable render.
  const [prevState, setPrevState] = useState(state)
  const [celebrateKey, setCelebrateKey] = useState(0)
  if (state !== prevState) {
    setPrevState(state)
    if (state === 'celebrate') setCelebrateKey((k) => k + 1)
  }

  // Gated on `motionEnabled` (not just `animate`) so `prefers-reduced-motion:
  // reduce` also stops the idle float — otherwise every state that falls
  // through to this branch (celebrate/worried/happy/surprised with reduced
  // motion) would still bounce forever.
  // The bob scales down for a small mascot (a 36 px header mascot would lurch
  // 6 px); at 75 px and up it is the original 6 px.
  const floatPx = Math.min(6, Math.round(size * 0.08))
  const floatAnimation = motionEnabled ? { y: [0, -floatPx, 0] } : {}
  const floatTransition = motionEnabled
    ? { duration: 3, repeat: Infinity, ease: 'easeInOut' as const }
    : {}

  const isCelebrating = state === 'celebrate' && burst

  // Thinking has no float or wobble: the flip-book is its one visible motion
  // (issue #887), so the pose reads as stepped frames, not a drifting still.
  const isThinking = state === 'thinking'
  const combinedAnimate = isThinking
    ? {}
    : isCelebrating && motionEnabled
      ? { scale: [1, 1.25, 0.95, 1.05, 1] }
      : floatAnimation

  const combinedTransition = isThinking
    ? {}
    : isCelebrating && motionEnabled
      ? { duration: 0.6, ease: 'easeOut' as const }
      : floatTransition

  return (
    <motion.div
      className={className}
      style={{ display: 'inline-block', lineHeight: 0, position: 'relative' }}
    >
      <motion.div
        key={isCelebrating ? `celebrate-${celebrateKey}` : state}
        initial={isCelebrating && motionEnabled ? { scale: 1 } : undefined}
        animate={combinedAnimate}
        transition={combinedTransition}
        style={{ display: 'inline-block', lineHeight: 0 }}
      >
        <Image
          src={STATE_SRC[state]}
          alt={`Bubbly ${state}`}
          width={size}
          height={size}
          data-flip-frame={flips ? (mirrored ? 'mirrored' : 'original') : undefined}
          style={{
            width: size,
            height: size,
            objectFit: 'contain',
            ...(mirrored ? { transform: 'scaleX(-1)' } : {}),
          }}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      </motion.div>

      <AnimatePresence>
        {isCelebrating && motionEnabled && (
          <span data-testid="bubbles-sparkle-burst" style={{ position: 'absolute', inset: 0 }}>
            {SPARKLES.map((sparkle, i) => (
              <motion.span
                key={`${celebrateKey}-${i}`}
                aria-hidden="true"
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
                animate={{ opacity: [0, 1, 0], x: sparkle.x, y: sparkle.y, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, delay: sparkle.delay, ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  fontSize: Math.max(12, size * 0.18),
                  pointerEvents: 'none',
                }}
              >
                {sparkle.emoji}
              </motion.span>
            ))}
          </span>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
