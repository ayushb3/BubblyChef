import { useEffect, useRef, useState } from 'react'
import { useReducedMotion, type Transition, type Variants } from 'framer-motion'

export const springs = {
  soft: { type: 'spring', stiffness: 260, damping: 24, mass: 0.7 },
  snappy: { type: 'spring', stiffness: 500, damping: 30, mass: 0.7 },
  pop: { type: 'spring', stiffness: 700, damping: 18, mass: 0.5 },
  page: { type: 'spring', stiffness: 260, damping: 28, mass: 0.8 },
} as const satisfies Record<string, Transition>

const reducedTransition: Transition = { duration: 0.01 }

export const heartPopVariants: Variants = {
  idle: { scale: 1, rotate: 0 },
  pop: {
    scale: [1, 1.4, 0.95, 1.1, 1],
    rotate: [0, -12, 8, -4, 0],
    transition: { type: 'tween', duration: 0.4, ease: [0.34, 1.56, 0.64, 1] },
  },
}

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
}

export const staggerItem: Variants = {
  hidden: { y: 6, opacity: 0 },
  show: { y: 0, opacity: 1, transition: springs.snappy },
}

type SpringName = keyof typeof springs

export interface MotionConfig {
  springs: Record<SpringName, Transition>
  reduced: boolean
}

export function useMotionConfig(): MotionConfig {
  const reduced = useReducedMotion() ?? false
  if (reduced) {
    return {
      reduced: true,
      springs: {
        soft: reducedTransition,
        snappy: reducedTransition,
        pop: reducedTransition,
        page: reducedTransition,
      },
    }
  }
  return { reduced: false, springs }
}

// ---------------------------------------------------------------------------
// Signature motion (issue #741, Goal 3).
//
// Two families, per the PRD: the WORLD moves in stepped, frame-based motion
// (Bubbles' walk, wilting, the loading dots); the UI moves on the soft springs
// above. The existing reduced-motion switch (`useMotionConfig`) stays the only
// switch: world loops become still poses, UI motion becomes opacity fades.
// ---------------------------------------------------------------------------

/**
 * A `steps(n)` easing: the value holds for each of `frames` equal slices of the
 * transition and jumps between them, so a tween reads as frame-by-frame
 * animation instead of a glide. Pass it as framer's `ease`.
 */
export function steppedEase(frames: number): (t: number) => number {
  const n = Math.max(1, Math.floor(frames))
  return (t) => (t >= 1 ? 1 : Math.floor(Math.max(0, t) * n) / n)
}

/** A tween that plays in `frames` visible steps over `durationMs`. */
export function steppedTransition(frames: number, durationMs: number): Transition {
  return { type: 'tween', duration: durationMs / 1000, ease: steppedEase(frames) }
}

/**
 * Discrete frame index for a looping world animation (e.g. the keycap's three
 * loading dots: 3 frames, 160 ms each). Holds frame 0 (a still pose) when
 * reduced motion is on or `active` is false.
 */
export function useSteppedFrame(frames: number, frameMs: number, active = true): number {
  const { reduced } = useMotionConfig()
  const [frame, setFrame] = useState(0)
  const running = active && !reduced
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setFrame((f) => (f + 1) % frames), frameMs)
    return () => clearInterval(id)
  }, [running, frames, frameMs])
  return running ? frame : 0
}

/** Reaction names, shared by `reactionVariants` and its callers. */
export type ReactionName = 'pop' | 'droop' | 'bounce' | 'wiggle'

const reducedFade: Variants[string] = {
  opacity: [0.6, 1],
  transition: { duration: 0.15, ease: 'easeOut' },
}

/**
 * The four reactions as reusable variants. Each has an `idle` pose and a
 * `play` pose; set `animate="play"` to run it. The reduced form is a still pose
 * for world reactions (droop, bounce) and an opacity fade for UI reactions
 * (pop, wiggle): nothing moves or scales when `reduced` is true.
 *
 * - pop: the counter springs scale 1 -> 1.12 -> 1 over 260 ms (UI).
 * - droop: the expiring food sags and fades in 2 stepped frames, then holds
 *   (world).
 * - bounce: a 2 px landing hop in 3 stepped frames (world).
 * - wiggle: 3 px side to side, 3 cycles in 300 ms, then still (UI error).
 */
export function reactionVariants(reduced: boolean): Record<ReactionName, Variants> {
  if (reduced) {
    return {
      pop: { idle: { opacity: 1 }, play: reducedFade },
      droop: {
        idle: { rotate: 0, y: 0, opacity: 1 },
        play: { rotate: 0, y: 0, opacity: 1, transition: { duration: 0 } },
      },
      bounce: { idle: { y: 0 }, play: { y: 0, transition: { duration: 0 } } },
      wiggle: { idle: { opacity: 1 }, play: reducedFade },
    }
  }
  return {
    pop: {
      idle: { scale: 1 },
      play: { scale: [1, 1.12, 1], transition: { duration: 0.26, ease: [0.34, 1.56, 0.64, 1] } },
    },
    droop: {
      idle: { rotate: 0, y: 0, opacity: 1 },
      play: { rotate: -4, y: 2, opacity: 0.85, transition: steppedTransition(2, 360) },
    },
    bounce: {
      idle: { y: 0 },
      play: { y: [0, -2, 0], transition: steppedTransition(3, 240) },
    },
    wiggle: {
      idle: { x: 0 },
      play: { x: [0, -3, 3, -3, 3, -3, 3, 0], transition: { duration: 0.3, ease: 'linear' } },
    },
  }
}

/** `reactionVariants` bound to the live reduced-motion setting. */
export function useReactionVariants(): Record<ReactionName, Variants> {
  const { reduced } = useMotionConfig()
  return reactionVariants(reduced)
}

/** Most visible number changes in a count-up. */
export const COUNT_UP_MAX_TICKS = 30
/** Total count-up duration. */
export const COUNT_UP_MS = 600

/**
 * The values a count-up steps through from `from` to `to`: at most
 * `COUNT_UP_MAX_TICKS` of them, eased out (big early steps, small late ones),
 * always ending exactly on `to`. A drop or no change yields just `[to]`.
 */
export function countUpValues(from: number, to: number): number[] {
  if (to <= from) return [to]
  const delta = to - from
  const ticks = Math.min(COUNT_UP_MAX_TICKS, delta)
  const out: number[] = []
  for (let i = 1; i <= ticks; i++) {
    const eased = 1 - Math.pow(1 - i / ticks, 3)
    const v = i === ticks ? to : from + Math.round(delta * eased)
    if (out.length === 0 || v !== out[out.length - 1]) out.push(v)
  }
  return out
}

/**
 * The number to *show* for a balance-like value. It follows `value` instantly
 * on first render, on a drop, and under reduced motion; when the value rises it
 * counts up from the old value over ~600 ms. `rise` is the size of the latest
 * increase and `riseKey` changes on every rise, so callers can key a pop and a
 * "+N" tag off it. `riseKey` is 0 until the first rise.
 */
export function useCountUp(value: number): { shown: number; rise: number; riseKey: number } {
  const { reduced } = useMotionConfig()
  const [shown, setShown] = useState(value)
  const [rise, setRise] = useState(0)
  const [riseKey, setRiseKey] = useState(0)
  const [prevValue, setPrevValue] = useState(value)
  const shownRef = useRef(value)

  // React's "adjust state while rendering" pattern: react to a changed prop
  // without an effect round-trip. A drop (and any change under reduced motion)
  // lands on the new value at once; a rise starts a count-up in the effect below.
  if (value !== prevValue) {
    setPrevValue(value)
    if (value < prevValue) {
      setShown(value)
    } else {
      setRise(value - prevValue)
      setRiseKey(riseKey + 1)
      if (reduced) setShown(value)
    }
  }

  useEffect(() => {
    shownRef.current = shown
  }, [shown])

  useEffect(() => {
    if (reduced || riseKey === 0 || shownRef.current >= value) return
    const steps = countUpValues(shownRef.current, value)
    const every = COUNT_UP_MS / steps.length
    const timers = steps.map((v, i) => setTimeout(() => setShown(v), every * (i + 1)))
    return () => timers.forEach(clearTimeout)
  }, [riseKey, value, reduced])

  return { shown, rise, riseKey }
}
