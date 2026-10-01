/**
 * Where the pixel Bubbles stands, and how it walks there (issue #752, Goal 2 of
 * the signature PRD). The "Bubbles · spots and moves" board of the Kitchen Home
 * canvas: three fixed spots on the floor, one trigger each, a stepped walk
 * between them. There is no free wandering.
 *
 *   door    while a scan or put-away is open (it unpacks from there)
 *   stove   while any cook session is active
 *   fridge  when something is going off (the wilting set is not empty)
 *   stove   otherwise: the resting spot
 *
 * First match wins, in that order.
 *
 * Pure: `pickBubblesSpot` and `planWalk` take their inputs as arguments and read
 * no clock, storage or DOM, so every precedence case and every frame of every
 * walk is unit-tested without rendering (`kitchen-bubbles-spot.test.ts`).
 * `isCookingNow` is the one storage read, and it only reads.
 *
 * Geometry is in wall units (the 96 x 80 grid of `wall-art.ts`). The spots stand
 * where the board puts them, which keeps the whole sprite below every place's tap
 * box and label (the lowest tag ends at row 55.2, the floor starts at 56), so no
 * frame of any walk can cover one. `kitchen-bubbles-spot.test.ts` checks it
 * against `PLACE_BOXES`, `PLACE_CONTENT` and the tags.
 */
import { getActiveCookSession } from '@/lib/cook-session'
import { getActiveMealCookSession } from '@/lib/meal-cook-session'
import { PLACES, type PlaceSummaries } from '@/lib/kitchen/places'
import type { BubblesPose, BubblesVariant } from '@/lib/kitchen/bubbles-art'

export type BubblesSpot = 'fridge' | 'stove' | 'door'

/** In floor order, left to right. */
export const BUBBLES_SPOTS: readonly BubblesSpot[] = ['fridge', 'stove', 'door']

export interface BubblesSpotInput {
  /** The receipt scan or the put-away sheet is open. */
  scanOpen: boolean
  /** Any cook session (a guided recipe cook or a meal cook-along) is active. */
  cooking: boolean
  /** The wilting set is not empty: something is about to go off. */
  wilting: boolean
}

export function pickBubblesSpot({ scanOpen, cooking, wilting }: BubblesSpotInput): BubblesSpot {
  if (scanOpen) return 'door'
  if (cooking) return 'stove'
  if (wilting) return 'fridge'
  return 'stove'
}

/**
 * The wilting set is "not empty" when any place holds something to use soon:
 * expired, or expiring within 3 days (the Use Soon view's rule, `places.ts`).
 * `null` (the pantry is loading, or failed to load) is "unknown": Bubbles stays
 * where it is resting rather than being sent to the fridge on a guess.
 */
export function hasWilting(places: PlaceSummaries | null): boolean {
  return places !== null && PLACES.some((p) => places[p.key].useSoonCount > 0)
}

/**
 * Is any cook session on record: a guided recipe cook or a meal cook-along? Both
 * readers refuse an ended session and swallow corrupt or missing storage, so a
 * stale or junk record reads as "not cooking". Read-only.
 */
export function isCookingNow(): boolean {
  return getActiveCookSession() !== null || getActiveMealCookSession() !== null
}

/**
 * The scene's accessible label (the wall's `role="group"`), which is where
 * Bubbles is described: the sprite itself is decorative. The places inside it
 * carry their own names and counts.
 */
export function sceneLabel(spot: BubblesSpot, cooking: boolean): string {
  const where =
    spot === 'door'
      ? 'by the door'
      : spot === 'fridge'
        ? 'at the fridge, because something needs using soon'
        : cooking
          ? 'at the stove, cooking'
          : 'at the stove'
  return `Your kitchen: a fridge with a freezer drawer, shelves, a basket, the stove and the door. Bubbles is ${where}.`
}

/** Where each spot stands: the sprite's left edge, in wall units. The board's own offsets. */
export const SPOT_X: Record<BubblesSpot, number> = { fridge: 26, stove: 44, door: 78 }

/** The sprite's top edge: it stands on the floor (rows 56-80), feet at row 75. */
export const BUBBLES_Y = 58

/** How far one walking frame moves Bubbles, in wall units (3 px at the board's 1x). */
export const WALK_STEP_UNITS = 3

/** One frame of Bubbles' motion: where, which pose, which way it faces, which foot frame. */
export interface BubblesFrame {
  x: number
  pose: BubblesPose
  /** Mirror the art (it is drawn looking left) so it faces right. */
  flip: boolean
  variant: BubblesVariant
}

/**
 * The pose Bubbles holds at a spot: facing the room at the stove (the board's
 * pose), turned toward the fridge at the fridge, and with its back to us at the
 * door, facing it.
 */
export function restFrame(spot: BubblesSpot): BubblesFrame {
  const pose: BubblesPose = spot === 'stove' ? 'front' : spot === 'fridge' ? 'threeQuarter' : 'back'
  return { x: SPOT_X[spot], pose, flip: false, variant: 'base' }
}

/**
 * The stepped walk from `fromX` to a spot, as the frames to play in order: turn
 * to three-quarter facing the way it is going, then the side view (mirrored to
 * face right) alternating its two foot frames, `WALK_STEP_UNITS` at a time along
 * the floor, then turn again and settle into the spot's own pose. Already there:
 * just the resting frame.
 */
export function planWalk(fromX: number, to: BubblesSpot): BubblesFrame[] {
  const rest = restFrame(to)
  const distance = rest.x - fromX
  if (Math.abs(distance) < 0.5) return [rest]

  const dir = Math.sign(distance)
  const flip = dir > 0
  const frames: BubblesFrame[] = [{ x: fromX, pose: 'threeQuarter', flip, variant: 'base' }]

  let x = fromX
  for (let i = 0; Math.abs(rest.x - x) > 1e-9; i++) {
    x += dir * Math.min(WALK_STEP_UNITS, Math.abs(rest.x - x))
    frames.push({ x, pose: 'side', flip, variant: i % 2 === 0 ? 'squash' : 'passing' })
  }

  const turn: BubblesFrame = { x: rest.x, pose: 'threeQuarter', flip, variant: 'base' }
  if (turn.pose !== rest.pose || turn.flip !== rest.flip) frames.push(turn)
  frames.push(rest)
  return frames
}
