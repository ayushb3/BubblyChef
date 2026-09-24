'use client'

import { useState } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { useMotionConfig } from '@/lib/motion'

export type BubblesState = 'happy' | 'surprised' | 'thinking' | 'worried' | 'celebrate'

interface BubblesMascotProps {
  state?: BubblesState
  size?: number
  className?: string
  animate?: boolean
}

// Exported (not just module-private) so tests can walk every entry and
// assert the rendered `src` and the on-disk file both match — see issue
// #612 (a wrong path here renders nothing, silently, because of the
// `onError` handler below).
export const STATE_SRC: Record<BubblesState, string> = {
  happy: '/mascot/bubbles-happy.png',
  surprised: '/mascot/bubbles-surprised.png',
  thinking: '/mascot/bubbles-thinking.png',
  // placeholder until art: #401 — no dedicated "worried" art yet, so the
  // thinking pose is reused; the 💧 badge below is what actually reads as
  // "worried" until real art lands.
  worried: '/mascot/bubbles-thinking.png',
  celebrate: '/mascot/bubbles-happy.png',
}

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
}: BubblesMascotProps) {
  // Gates all new motion (bounce, sparkle burst) on top of the existing
  // `animate` prop gate — `prefers-reduced-motion: reduce` still swaps the
  // image/badge for the right state, it just skips the movement.
  const { reduced: prefersReducedMotion } = useMotionConfig()
  const motionEnabled = animate && !prefersReducedMotion

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
  const floatAnimation = motionEnabled ? { y: [0, -6, 0] } : {}
  const floatTransition = motionEnabled
    ? { duration: 3, repeat: Infinity, ease: 'easeInOut' as const }
    : {}

  // Wobble is new-ish motion layered on top of `thinking` — gated on reduced
  // motion (not just `animate`) so `prefers-reduced-motion: reduce` drops it
  // entirely (the float it would otherwise fall back to is itself gated off
  // above), same as the bounce/sparkle below.
  const wobbleAnimation =
    motionEnabled && state === 'thinking' ? { rotate: [0, -3, 3, -2, 2, 0] } : {}
  const wobbleTransition =
    motionEnabled && state === 'thinking'
      ? { duration: 2, repeat: Infinity, ease: 'easeInOut' as const, type: 'tween' as const }
      : {}

  const isCelebrating = state === 'celebrate'

  const combinedAnimate =
    motionEnabled && state === 'thinking'
      ? { ...floatAnimation, ...wobbleAnimation }
      : isCelebrating && motionEnabled
        ? { scale: [1, 1.25, 0.95, 1.05, 1] }
        : floatAnimation

  const combinedTransition =
    motionEnabled && state === 'thinking'
      ? wobbleTransition
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
          alt={`Bubbles ${state}`}
          width={size}
          height={size}
          style={{ width: size, height: size, objectFit: 'contain' }}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      </motion.div>

      {state === 'worried' && (
        <span
          className="absolute -top-1 -right-1 text-base leading-none"
          style={{ fontSize: Math.max(14, size * 0.22) }}
          aria-hidden="true"
          data-testid="bubbles-worried-badge"
        >
          💧
        </span>
      )}

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
