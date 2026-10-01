/**
 * The put-away flight (issue #754, board A3's confirmation animation).
 *
 * After "Put away" succeeds, each ingredient hops from its row in the list to
 * its place on the wall, one by one in list order, and the place's +N ticks up
 * as each lands. This module is the pure part: the schedule and the path, so the
 * time budget is tested without rendering (`kitchen-putaway-flight-plan.test.ts`).
 * `components/kitchen/PutAwayFlight.tsx` plays it.
 *
 * Length stays bounded however long the receipt is (the rejected alternative was
 * a fixed per-item stagger, which makes a 40-line receipt take half a minute):
 *  - up to `INDIVIDUAL_MAX` items hop one at a time, `STAGGER_MAX_MS` apart,
 *    closer together as there are more of them;
 *  - the rest land in batches, one chip per place with a count;
 *  - the whole thing, sparkle included, fits `TOTAL_BUDGET_MS`.
 */
import { PLACE_KEYS, type PlaceKey } from '@/lib/kitchen/places'

/** One hop, start to landing. World motion: it plays in `HOP_FRAMES` stepped frames. */
export const HOP_MS = 420
/** The fewest stills in a hop; a long way (the list is far below the wall) gets more, up to `HOP_FRAMES_MAX`. */
export const HOP_FRAMES = 5
export const HOP_FRAMES_MAX = 9
/** About how far the chip jumps between two stills, in px: a long hop reads as steps, not as a few big leaps. */
export const HOP_FRAME_PX = 70
/** How high the middle of the hop is lifted above the straight line, in px. */
export const HOP_LIFT_PX = 26

/** The sparkle stays this long after the last item lands (the canvas note: "briefly"). */
export const SPARKLE_MS = 400
/** Beyond this many items the rest land in batches per place. */
export const INDIVIDUAL_MAX = 12
/** The longest gap between two departures: a short receipt is unhurried. */
export const STAGGER_MAX_MS = 260
/** The last landing is no later than this, so the sequence is under about 4 s with the sparkle. */
export const LANDING_BUDGET_MS = 3000
export const TOTAL_BUDGET_MS = LANDING_BUDGET_MS + SPARKLE_MS

/** The flying chip's size: 28 px at the board's 390 px wall (4.0625 px a wall unit), in wall units. */
export const CHIP_PX = 28
export const CHIP_UNITS = 7

/**
 * Where each item lands, in wall units (the 96 x 80 grid): on the drawn object,
 * clear of the place's tag so a landing never covers a label (`PLACE_BOXES`,
 * `TAG_UNITS`; pinned by `kitchen-putaway-flight-plan.test.ts`).
 */
export const FLIGHT_ANCHORS: Record<PlaceKey, { x: number; y: number }> = {
  fridge: { x: 14, y: 22 },
  freezer: { x: 14, y: 52 },
  shelves: { x: 48, y: 27.5 },
  basket: { x: 66, y: 39 },
}

export interface FlightStep<T> {
  /** Departure, ms from the start. */
  at: number
  /** Landing, ms from the start. */
  landAt: number
  place: PlaceKey
  /** One item, or the batch of the tail's items for this place. */
  items: T[]
}

export interface FlightPlan<T> {
  steps: FlightStep<T>[]
  /** From the start to the sparkle fading: the whole sequence. 0 when there is nothing to play. */
  totalMs: number
}

/** The schedule for `items` (list order). A step per item up to `INDIVIDUAL_MAX`, then one per place. */
export function planFlight<T extends { place: PlaceKey }>(items: readonly T[]): FlightPlan<T> {
  if (items.length === 0) return { steps: [], totalMs: 0 }

  const singles = items.slice(0, INDIVIDUAL_MAX)
  const tail = items.slice(INDIVIDUAL_MAX)
  const groups: Array<{ place: PlaceKey; items: T[] }> = singles.map((i) => ({
    place: i.place,
    items: [i],
  }))
  for (const place of PLACE_KEYS) {
    const batch = tail.filter((i) => i.place === place)
    if (batch.length > 0) groups.push({ place, items: batch })
  }

  // The stagger shrinks so the last departure still lands inside the budget.
  const gap =
    groups.length > 1
      ? Math.min(STAGGER_MAX_MS, Math.floor((LANDING_BUDGET_MS - HOP_MS) / (groups.length - 1)))
      : 0
  const steps = groups.map((g, i) => ({
    at: i * gap,
    landAt: i * gap + HOP_MS,
    place: g.place,
    items: g.items,
  }))
  const lastLanding = Math.max(...steps.map((s) => s.landAt))
  return { steps, totalMs: lastLanding + SPARKLE_MS }
}

function emptyCounts(): Record<PlaceKey, number> {
  return Object.fromEntries(PLACE_KEYS.map((k) => [k, 0])) as Record<PlaceKey, number>
}

/** How many items have landed at each place by `elapsedMs` (a landing at that very ms counts). */
export function landedBy<T>(plan: FlightPlan<T>, elapsedMs: number): Record<PlaceKey, number> {
  const counts = emptyCounts()
  for (const s of plan.steps) if (s.landAt <= elapsedMs) counts[s.place] += s.items.length
  return counts
}

/** What each place ends with. */
export function finalLanded<T>(plan: FlightPlan<T>): Record<PlaceKey, number> {
  const counts = emptyCounts()
  for (const s of plan.steps) counts[s.place] += s.items.length
  return counts
}

export interface Point {
  x: number
  y: number
}

/** How many stills the hop from `from` to `to` has: `HOP_FRAMES`, more for a long way, at most `HOP_FRAMES_MAX`. */
export function hopFrames(from: Point, to: Point): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  return Math.min(HOP_FRAMES_MAX, Math.max(HOP_FRAMES, Math.round(distance / HOP_FRAME_PX)))
}

/**
 * The stills of one hop, as framer keyframes: `hopFrames + 1` positions from
 * `from` to `to`, evenly along the line, each lifted by a parabola so the chip
 * hops. Played with a stepped ease it holds each still and jumps to the next.
 */
export function hopPath(from: Point, to: Point): { x: number[]; y: number[] } {
  const frames = hopFrames(from, to)
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i <= frames; i++) {
    const t = i / frames
    x.push(Math.round(from.x + (to.x - from.x) * t))
    y.push(Math.round(from.y + (to.y - from.y) * t - 4 * HOP_LIFT_PX * t * (1 - t)))
  }
  return { x, y }
}
