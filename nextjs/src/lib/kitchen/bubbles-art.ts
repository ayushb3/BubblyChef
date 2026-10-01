/**
 * The pixel Bubbles, drawn in code (issue #752). Ported from the turnaround on
 * the "Bubbles · spots and moves" board of the Kitchen Home canvas: a 16 x 18
 * sprite on the wall's grid (1 unit = 1 source pixel; the board shows it at 4x).
 *
 * Proportions, from Ayush's turnaround guide: the hat is a flat oval over a
 * short band (rows 0-3, about 1/5 of the height); the body is a circle; the eyes
 * sit on its centreline (rows 9-10); the apron line crosses at about 2/3 (row
 * 12); two small oval feet (rows 16-17). The side shows one eye, the back shows
 * the apron knot. Front, three-quarter and side all look LEFT where they look
 * anywhere; a sprite that faces right is the same art mirrored (`flip`).
 *
 * Each part is [fill, rects]: one colour and its rects as "x,y,w,h" strings (the
 * same shape as `wall-art.ts`). The colours are literal hex: Bubbles does not
 * recolour with the kitchen theme, the same as the food in the wall's stock.
 *
 * Every rect is one pixel tall and no two overlap, so the frames below are built
 * by moving or dropping whole pixels, never by re-painting.
 *
 * Generated from the board once and then edited by hand; there is no build step.
 */
export type BubblesPose = 'front' | 'threeQuarter' | 'side' | 'back'

export type SpritePart = readonly [fill: string, rects: string]

export const BUBBLES_W = 16
export const BUBBLES_H = 18

/** The soft floor shadow under Bubbles' feet, in sprite units (one row below the last). */
export const BUBBLES_SHADOW: SpritePart = ['#d9bb9c', '1,17,14,2']

export const BUBBLES_POSES: Record<BubblesPose, readonly SpritePart[]> = {
  front: [
    ['#5a4038', '5,0,6,1 4,1,1,1 11,1,1,1 4,2,2,1 10,2,2,1 5,3,1,1 10,3,1,1 4,4,8,1 2,5,2,1 12,5,2,1 1,6,1,1 14,6,1,1 1,7,1,1 14,7,1,1 0,8,1,1 15,8,1,1 0,9,1,1 15,9,1,1 0,10,1,1 15,10,1,1 0,11,1,1 7,11,2,1 15,11,1,1 0,12,1,1 15,12,1,1 1,13,1,1 14,13,1,1 2,14,2,1 12,14,2,1 4,15,8,1 2,16,1,1 5,16,1,1 10,16,1,1 13,16,1,1 3,17,2,1 11,17,2,1'],
    ['#a9cdea', '5,1,6,1 3,13,10,1 4,14,8,1'],
    ['#8fbde3', '6,2,4,1 6,3,4,1 1,12,14,1'],
    ['#f6e6d6', '4,5,8,1 2,6,12,1 2,7,12,1 1,8,14,1 1,9,4,1 6,9,4,1 11,9,4,1 1,10,4,1 6,10,4,1 11,10,4,1 1,11,2,1 5,11,2,1 9,11,2,1 13,11,2,1 2,13,1,1 13,13,1,1'],
    ['#3b2a26', '5,9,1,1 10,9,1,1 5,10,1,1 10,10,1,1'],
    ['#ffb7c5', '3,11,2,1 11,11,2,1'],
    ['#e6cdb6', '3,16,2,1 11,16,2,1'],
  ],
  threeQuarter: [
    ['#5a4038', '5,0,6,1 4,1,1,1 11,1,1,1 4,2,2,1 10,2,2,1 5,3,1,1 10,3,1,1 4,4,8,1 2,5,2,1 12,5,2,1 1,6,1,1 14,6,1,1 1,7,1,1 14,7,1,1 0,8,1,1 15,8,1,1 0,9,1,1 15,9,1,1 0,10,1,1 15,10,1,1 0,11,1,1 5,11,1,1 15,11,1,1 0,12,1,1 15,12,1,1 1,13,1,1 14,13,1,1 2,14,2,1 12,14,2,1 4,15,8,1 2,16,1,1 5,16,1,1 9,16,1,1 12,16,1,1 3,17,2,1 10,17,2,1'],
    ['#a9cdea', '5,1,6,1 2,13,9,1 4,14,6,1'],
    ['#8fbde3', '6,2,4,1 6,3,4,1 1,12,14,1'],
    ['#f6e6d6', '4,5,8,1 2,6,11,1 2,7,11,1 1,8,12,1 1,9,2,1 4,9,3,1 8,9,5,1 1,10,2,1 4,10,3,1 8,10,5,1 3,11,2,1 6,11,2,1 10,11,3,1 11,13,2,1 10,14,1,1'],
    ['#e9d2bd', '13,6,1,1 13,7,1,1 13,8,2,1 13,9,2,1 13,10,2,1 13,11,2,1 13,13,1,1 11,14,1,1'],
    ['#3b2a26', '3,9,1,1 7,9,1,1 3,10,1,1 7,10,1,1'],
    ['#ffb7c5', '1,11,2,1 8,11,2,1'],
    ['#e6cdb6', '3,16,2,1 10,16,2,1'],
  ],
  side: [
    ['#5a4038', '5,0,6,1 4,1,1,1 11,1,1,1 4,2,2,1 10,2,2,1 5,3,1,1 10,3,1,1 4,4,8,1 2,5,2,1 12,5,2,1 1,6,1,1 14,6,1,1 1,7,1,1 14,7,1,1 0,8,1,1 15,8,1,1 0,9,1,1 15,9,1,1 0,10,1,1 15,10,1,1 0,11,1,1 15,11,1,1 0,12,1,1 15,12,1,1 1,13,1,1 14,13,1,1 2,14,2,1 12,14,2,1 4,15,8,1 4,16,1,1 7,16,2,1 11,16,1,1 5,17,2,1 9,17,2,1'],
    ['#a9cdea', '5,1,6,1 2,13,5,1 4,14,4,1'],
    ['#8fbde3', '6,2,4,1 6,3,4,1 1,12,14,1'],
    ['#f6e6d6', '4,5,8,1 2,6,11,1 2,7,11,1 1,8,12,1 2,9,11,1 2,10,11,1 3,11,10,1 7,13,6,1 8,14,3,1'],
    ['#e9d2bd', '13,6,1,1 13,7,1,1 13,8,2,1 13,9,2,1 13,10,2,1 13,11,2,1 13,13,1,1 11,14,1,1'],
    ['#3b2a26', '1,9,1,1 1,10,1,1'],
    ['#ffb7c5', '1,11,2,1'],
    ['#e6cdb6', '5,16,2,1 9,16,2,1'],
  ],
  back: [
    ['#5a4038', '5,0,6,1 4,1,1,1 11,1,1,1 4,2,2,1 10,2,2,1 5,3,1,1 10,3,1,1 4,4,8,1 2,5,2,1 12,5,2,1 1,6,1,1 14,6,1,1 1,7,1,1 14,7,1,1 0,8,1,1 15,8,1,1 0,9,1,1 15,9,1,1 0,10,1,1 15,10,1,1 0,11,1,1 15,11,1,1 0,12,1,1 15,12,1,1 1,13,1,1 14,13,1,1 2,14,2,1 12,14,2,1 4,15,8,1 2,16,1,1 5,16,1,1 10,16,1,1 13,16,1,1 3,17,2,1 11,17,2,1'],
    ['#a9cdea', '5,1,6,1'],
    ['#8fbde3', '6,2,4,1 6,3,4,1 1,12,6,1 9,12,6,1'],
    ['#f6e6d6', '4,5,8,1 2,6,12,1 2,7,12,1 1,8,14,1 1,9,14,1 1,10,14,1 1,11,14,1 2,13,4,1 7,13,2,1 10,13,4,1 4,14,8,1'],
    ['#6f9fcc', '7,12,2,1 6,13,1,1 9,13,1,1'],
    ['#e6cdb6', '3,16,2,1 11,16,2,1'],
  ],
}

/** The last body row; rows below it are the feet. */
const LAST_BODY_ROW = 15

function mapRects(
  parts: readonly SpritePart[],
  fn: (x: number, y: number, w: number, h: number) => string | null,
): SpritePart[] {
  return parts
    .map(([fill, rects]): SpritePart => {
      const out: string[] = []
      for (const r of rects.split(' ')) {
        const [x, y, w, h] = r.split(',').map(Number)
        const next = fn(x, y, w, h)
        if (next) out.push(next)
      }
      return [fill, out.join(' ')]
    })
    .filter(([, rects]) => rects !== '')
}

/**
 * The squash: the body sits one pixel lower, its outline covering the top row
 * of the feet. It is the idle "breathe" (the board's 1px stepped breathe) and
 * the contact frame of the walk. The same pixels, one row lower.
 */
export function squash(parts: readonly SpritePart[]): SpritePart[] {
  return mapRects(parts, (x, y, w, h) => {
    if (y <= LAST_BODY_ROW) return `${x},${y + 1},${w},${h}`
    // The feet's top row (16) is covered by the lowered body outline.
    if (y === LAST_BODY_ROW + 1) return null
    return `${x},${y},${w},${h}`
  })
}

/**
 * The passing frame of the walk: the body at full height, the two feet drawn
 * together under it as one small oval, as a foot swings through.
 */
export function passing(parts: readonly SpritePart[]): SpritePart[] {
  const body = mapRects(parts, (x, y, w, h) => (y <= LAST_BODY_ROW ? `${x},${y},${w},${h}` : null))
  return [...body, ['#5a4038', '6,16,1,1 9,16,1,1 7,17,2,1'], ['#e6cdb6', '7,16,2,1']]
}

export type BubblesVariant = 'base' | 'squash' | 'passing'

/**
 * The stove's steam while a cook is active, in wall units (not sprite units: it
 * rises off the pot, which does not move). Three stepped frames in a loop. The
 * pot's own static wisps (rows 33-35) are part of the wall and stay; these rise
 * from them, drifting a pixel left and right on the way up, the highest in a
 * paler tone. `STEAM_STILL_FRAME` is the one frame reduced motion shows.
 */
export const STEAM_FRAMES: readonly (readonly SpritePart[])[] = [
  [['#ffffff', '47,32,1,2 50,31,1,2 53,32,1,2']],
  [
    ['#ffffff', '49,32,1,2 52,31,1,2 55,32,1,2'],
    ['#e6eef3', '48,30,1,1 51,29,1,1 54,30,1,1'],
  ],
  [
    ['#ffffff', '48,31,1,2 51,30,1,2 54,31,1,2'],
    ['#e6eef3', '47,29,1,1 50,28,1,1 53,29,1,1'],
  ],
]

export const STEAM_STILL_FRAME = 1

/** The parts to paint for a pose in one of its frames. */
export function bubblesParts(
  pose: BubblesPose,
  variant: BubblesVariant = 'base',
): readonly SpritePart[] {
  const parts = BUBBLES_POSES[pose]
  if (variant === 'squash') return squash(parts)
  if (variant === 'passing') return passing(parts)
  return parts
}
