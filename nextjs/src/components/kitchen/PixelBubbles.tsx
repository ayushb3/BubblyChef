'use client'

/**
 * The pixel Bubbles in the kitchen scene (issue #752, Goal 2 of the signature
 * PRD). Board "Bubbles · spots and moves" of the Kitchen Home canvas.
 *
 * SVG nodes in wall units (the 96 x 80 grid), meant for `KitchenWall`'s
 * `bubblesLayer`: it is painted over the decorations and under the places' tags
 * and buttons, and it takes no taps. The caller decides where Bubbles should be
 * (`pickBubblesSpot`, `useBubblesSpot`); this draws it there.
 *
 *  - At rest it holds the spot's pose and idles with a stepped breathe (the body
 *    one pixel lower, every 700 ms).
 *  - When `spot` changes it walks there along the floor: turn, then the side view
 *    facing the way it is going, alternating two foot frames, 3 units a frame
 *    (`planWalk`), then turn and settle. Frames, not a glide: each one is a
 *    timeout, so the motion is stepped by construction. A change of spot mid-walk
 *    re-plans from wherever it is.
 *  - While `cooking`, the stove's pot steams in a three-frame stepped loop.
 *  - Reduced motion: Bubbles is at the spot, in its still pose, with no timer of
 *    any kind (no walk, no breathe, no steam loop). The steam is one still frame
 *    while cooking, so the cook is still visible.
 *
 * Decorative to assistive tech (`aria-hidden`): the scene's own label and the
 * places carry the meaning. It is absolutely painted in the wall's own SVG, so
 * nothing about it can shift the layout.
 */
import { useEffect, useRef, useState } from 'react'
import { rectsToPath } from '@/lib/kitchen/wall-art'
import { useMotionConfig } from '@/lib/motion'
import {
  BUBBLES_SHADOW,
  BUBBLES_W,
  STEAM_FRAMES,
  STEAM_STILL_FRAME,
  bubblesParts,
  type SpritePart,
} from '@/lib/kitchen/bubbles-art'
import {
  BUBBLES_Y,
  planWalk,
  restFrame,
  type BubblesFrame,
  type BubblesSpot,
} from '@/lib/kitchen/bubbles-spot'

/** One walking frame. Three units at 130 ms is a brisk 23 units a second. */
const WALK_FRAME_MS = 130
/** The idle breathe: down, up, every 700 ms. */
const IDLE_FRAME_MS = 700
/** The steam loop: three frames, 420 ms each. */
const STEAM_FRAME_MS = 420

export interface PixelBubblesProps {
  /** Where Bubbles should be. A change walks it there. */
  spot: BubblesSpot
  /** A cook session is active: the stove steams. */
  cooking?: boolean
}

function Parts({ parts }: { parts: readonly SpritePart[] }) {
  return (
    <>
      {parts.map(([fill, rects], i) => (
        <path key={i} d={rectsToPath(rects)} style={{ fill }} />
      ))}
    </>
  )
}

function sameFrame(a: BubblesFrame, b: BubblesFrame): boolean {
  return a.x === b.x && a.pose === b.pose && a.flip === b.flip && a.variant === b.variant
}

export default function PixelBubbles({ spot, cooking = false }: PixelBubblesProps) {
  const { reduced } = useMotionConfig()

  // The frame on screen. It starts at the spot's rest: Bubbles appears there
  // (on first paint and after a reload) and only walks when the spot changes.
  const [frame, setFrame] = useState<BubblesFrame>(() => restFrame(spot))
  const frameRef = useRef(frame)
  const [walking, setWalking] = useState(false)
  const [breathing, setBreathing] = useState(false)
  const [steamIndex, setSteamIndex] = useState(0)

  // Walk to the spot. Each frame is its own timeout, so nothing glides.
  useEffect(() => {
    if (reduced) return
    const plan = planWalk(frameRef.current.x, spot)
    if (plan.length === 1 && sameFrame(frameRef.current, plan[0])) return

    let i = 0
    let timer: ReturnType<typeof setTimeout>
    const play = () => {
      const next = plan[i]
      frameRef.current = next
      setFrame(next)
      const last = i === plan.length - 1
      setWalking(!last)
      if (last) setBreathing(false)
      i += 1
      if (!last) timer = setTimeout(play, WALK_FRAME_MS)
    }
    timer = setTimeout(play, 0)
    return () => clearTimeout(timer)
  }, [spot, reduced])

  // Reduced motion: the spot's still pose, straight away.
  const shown = reduced ? restFrame(spot) : frame
  const atRest = !reduced && sameFrame(frame, restFrame(spot))

  // Idle breathe, only while standing at the spot.
  useEffect(() => {
    if (!atRest) return
    const id = setInterval(() => setBreathing((b) => !b), IDLE_FRAME_MS)
    return () => clearInterval(id)
  }, [atRest])

  // The stove's steam loop, only while cooking.
  useEffect(() => {
    if (!cooking || reduced) return
    const id = setInterval(() => setSteamIndex((n) => (n + 1) % STEAM_FRAMES.length), STEAM_FRAME_MS)
    return () => clearInterval(id)
  }, [cooking, reduced])

  const variant = atRest && breathing ? 'squash' : shown.variant
  const steamFrame = reduced ? STEAM_STILL_FRAME : steamIndex

  return (
    <>
      {cooking && (
        <g data-testid="stove-steam" data-frame={steamFrame} aria-hidden="true" className="pointer-events-none">
          <Parts parts={STEAM_FRAMES[steamFrame]} />
        </g>
      )}
      <g
        data-testid="pixel-bubbles"
        data-spot={spot}
        data-pose={shown.pose}
        data-flip={shown.flip}
        data-frame={variant}
        data-x={shown.x}
        data-moving={!reduced && walking}
        aria-hidden="true"
        className="pointer-events-none"
        transform={`translate(${shown.x} ${BUBBLES_Y})`}
      >
        <Parts parts={[BUBBLES_SHADOW]} />
        {/* The art looks left; facing right is the same art mirrored about its centre. */}
        <g transform={shown.flip ? `translate(${BUBBLES_W} 0) scale(-1 1)` : undefined}>
          <Parts parts={bubblesParts(shown.pose, variant)} />
        </g>
      </g>
    </>
  )
}
