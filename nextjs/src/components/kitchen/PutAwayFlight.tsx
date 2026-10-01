'use client'

/**
 * The put-away flight (issue #754, board A3 "A3 confirmation animation"): after
 * "Put away" succeeds, each ingredient hops from its row in the list to its own
 * place on the wall, one by one, in stepped frames. The wall's tags tick up and
 * bounce as each one lands (`KitchenWall`'s `bounce`), and a sparkle stays at the
 * place briefly.
 *
 * It draws only the flying chips, in a fixed layer over the page. The counts
 * live with the caller: it hears each landing through `onLanded` (cumulative, per
 * place) and the end through `onDone`.
 *
 * Contract for `frontend` (HeroHome):
 *  - mount it only after the bulk write succeeded; a failed write never mounts it;
 *  - `hops`: in list order, each with the place it was written to, its emoji and
 *    the client-px centre of the row it leaves from (`PutAwaySheet` builds them);
 *  - `onLanded(landed)`: cumulative items landed per place, called on every
 *    landing. It is the "+N tick" (and, as it only ever rises, the bounce key);
 *  - `onDone()`: once, when the sparkle has faded, or at once when skipped. Hold
 *    the real counts back until then, and refresh them there;
 *  - unmount it to abandon the flight (no further callbacks).
 *
 * Taps are never blocked: the layer takes no pointer events, and a pointer press
 * or key press anywhere jumps to the end state (`onLanded` with the final counts,
 * `onDone`) while the press carries on to what it was aimed at.
 *
 * Reduced motion: nothing flies and nothing translates. The counts update at
 * once; the rows fade out with the sheet (`PixelSheet`'s fade). With no wall to
 * land on (it is not on this screen) it does the same.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { steppedEase, useMotionConfig } from '@/lib/motion'
import { PLACE_KEYS, type PlaceKey } from '@/lib/kitchen/places'
import { WALL_H, WALL_W } from '@/lib/kitchen/slots'
import {
  CHIP_PX,
  FLIGHT_ANCHORS,
  HOP_MS,
  HOP_FRAMES,
  finalLanded,
  hopPath,
  planFlight,
  type Point,
} from '@/lib/kitchen/put-away-flight'

export interface PutAwayHop {
  id: string
  place: PlaceKey
  emoji: string
  name: string
  /** Where it leaves from: the centre of its row, in viewport px. */
  from: Point
}

export interface PutAwayFlightProps {
  hops: readonly PutAwayHop[]
  onLanded: (landed: Record<PlaceKey, number>) => void
  onDone: () => void
}

interface Flying {
  index: number
  to: Point
}

const WALL_SELECTOR = '[data-testid="kitchen-wall"]'

/** Each frame holds its still, then jumps to the next (world motion, not a glide). */
const FRAME_EASE = Array.from({ length: HOP_FRAMES }, () => steppedEase(1))

function wallTarget(wall: Element, place: PlaceKey): Point {
  const r = wall.getBoundingClientRect()
  const a = FLIGHT_ANCHORS[place]
  return { x: r.left + (a.x / WALL_W) * r.width, y: r.top + (a.y / WALL_H) * r.height }
}

export default function PutAwayFlight({ hops, onLanded, onDone }: PutAwayFlightProps) {
  const { reduced } = useMotionConfig()
  const plan = useMemo(() => planFlight(hops), [hops])
  const [flying, setFlying] = useState<Flying[]>([])

  // The callbacks are the caller's, and change identity every render; the flight
  // must not restart for that.
  const cb = useRef({ onLanded, onDone })
  useEffect(() => {
    cb.current = { onLanded, onDone }
  })

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    let finished = false
    const skip = () => finish(true)
    const finish = (jump: boolean) => {
      if (finished) return
      finished = true
      timers.forEach(clearTimeout)
      window.removeEventListener('pointerdown', skip, true)
      window.removeEventListener('keydown', skip, true)
      setFlying([])
      if (jump && plan.steps.length > 0) cb.current.onLanded(finalLanded(plan))
      cb.current.onDone()
    }

    const wall = document.querySelector(WALL_SELECTOR)
    if (reduced || !wall || plan.steps.length === 0) {
      // Nothing to fly (or nowhere to fly to): the counts just update.
      timers.push(setTimeout(() => finish(true), 0))
      return () => {
        finished = true
        timers.forEach(clearTimeout)
      }
    }

    const landed = Object.fromEntries(PLACE_KEYS.map((k) => [k, 0])) as Record<PlaceKey, number>
    plan.steps.forEach((step, index) => {
      timers.push(
        setTimeout(() => {
          // Aimed where the wall is now, in case the page moved since the tap.
          const target = wallTarget(document.querySelector(WALL_SELECTOR) ?? wall, step.place)
          setFlying((f) => [...f, { index, to: target }])
        }, step.at),
      )
      timers.push(
        setTimeout(() => {
          setFlying((f) => f.filter((x) => x.index !== index))
          landed[step.place] += step.items.length
          cb.current.onLanded({ ...landed })
        }, step.landAt),
      )
    })
    timers.push(setTimeout(() => finish(false), plan.totalMs))

    // A tap (or key) anywhere skips to the end. Listening in the capture phase
    // without stopping it, the press still reaches whatever it was aimed at.
    window.addEventListener('pointerdown', skip, true)
    window.addEventListener('keydown', skip, true)
    return () => {
      finished = true
      timers.forEach(clearTimeout)
      window.removeEventListener('pointerdown', skip, true)
      window.removeEventListener('keydown', skip, true)
    }
  }, [plan, reduced])

  if (reduced || flying.length === 0) {
    // Keep the layer mounted while flying only; an idle flight draws nothing.
    return null
  }

  return (
    <div
      data-testid="put-away-flight"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
    >
      {flying.map(({ index, to }) => {
        const step = plan.steps[index]
        const first = step.items[0]
        const path = hopPath(first.from, to)
        const half = CHIP_PX / 2
        const batch = step.items.length > 1
        return (
          <motion.div
            key={index}
            data-testid="put-away-chip"
            data-item-id={first.id}
            data-place={step.place}
            data-batch={batch ? 'true' : undefined}
            className="pointer-events-none absolute top-0 left-0 flex h-7 w-7 items-center justify-center border-2 border-[color:var(--color-text)] bg-[color:var(--color-surface)] text-[16px] leading-none shadow-[2px_2px_0_var(--color-text)]"
            initial={{ x: path.x[0] - half, y: path.y[0] - half }}
            animate={{
              x: path.x.map((v) => v - half),
              y: path.y.map((v) => v - half),
            }}
            transition={{ duration: HOP_MS / 1000, ease: FRAME_EASE }}
          >
            <span aria-hidden="true">{first.emoji}</span>
            {batch && (
              <span className="absolute -right-2 -bottom-2 border-2 border-[color:var(--color-text)] bg-[color:var(--color-surface)] px-0.5 font-sans text-[10px] leading-3 font-extrabold tabular-nums text-[color:var(--color-text)]">
                ×{step.items.length}
              </span>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
