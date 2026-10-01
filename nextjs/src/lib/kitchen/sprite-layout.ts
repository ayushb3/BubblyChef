/**
 * Where the category sprites and wilting items sit on the wall (issue #751).
 *
 * Pure geometry in wall units (the 96 x 80 grid of `wall-art.ts`; 1 unit = 1
 * sprite pixel). Each place has a handful of slots, read off Main board A: the
 * fridge's two shelves, the freezer drawer, the shelf of jars, the basket. A slot
 * is a centre x and the y of the surface the sprite stands on, so a tall and a
 * short sprite both sit flat. `layoutStock` turns a place's chosen sprites and
 * wilting items into positioned sprites and tag boxes; `KitchenSprites` draws them.
 *
 * Slot counts are the density cap: "about 80 items without clutter" is a few
 * sprites per place, not one per item. `places.ts` reads `PLACE_SLOTS` to know how
 * many it may choose.
 */
import { WALL_H, WALL_W } from '@/lib/kitchen/slots'
import { spriteArt, type SpriteKind } from '@/lib/kitchen/sprites/category'
import { rowsSize } from '@/lib/kitchen/sprites/pixel'
import type { KitchenStock, PlaceKey, WiltingItem } from '@/lib/kitchen/places'

export interface SpriteSlot {
  /** Centre of the sprite, in wall units. */
  cx: number
  /** The y of the surface the sprite stands on (its bottom edge). */
  base: number
}

/**
 * Left to right, top to bottom. Fridge: the two shelves of the cut-away (the
 * shelf lines are at y 26 and 39). Freezer: the two bags in the drawer. Shelves:
 * the jars on the plank at y 31. Basket: the fruit sitting a pixel into the rim.
 * Reproduces board A: milk (7,18), meat (7,33); jar (28,23), can (35,24), bread
 * (41,27), bottle (50,22), jar (56,23), can (63,24); apple (60,34), bananas
 * (64,35). The fridge's right-hand slots sit one unit right of the board's (cheese
 * and romaine at x 14, not 13): an 8-wide egg box on the left shelf would otherwise
 * touch the sprite beside it, and eggs are in most fridges.
 */
export const PLACE_SLOTS: Record<PlaceKey, readonly SpriteSlot[]> = {
  fridge: [
    { cx: 9.5, base: 26 },
    { cx: 17.5, base: 26 },
    { cx: 10, base: 39 },
    { cx: 17.5, base: 39 },
  ],
  freezer: [
    { cx: 10, base: 55 },
    { cx: 17, base: 55 },
  ],
  shelves: [
    { cx: 31, base: 31 },
    { cx: 37.5, base: 31 },
    { cx: 45, base: 31 },
    { cx: 52.5, base: 31 },
    { cx: 59, base: 31 },
    { cx: 65.5, base: 31 },
  ],
  basket: [
    { cx: 63, base: 41 },
    { cx: 68, base: 40 },
  ],
}

/**
 * The slots wilting items take, first choice first: the ones board A gives them
 * (the romaine bottom right of the fridge, the bread third on the shelf, the
 * bananas in the basket) and then slots spread out so two tags rarely meet.
 */
const WILT_ORDER: Record<PlaceKey, readonly number[]> = {
  fridge: [3, 2, 1, 0],
  freezer: [1, 0],
  shelves: [2, 4, 0, 5, 1, 3],
  basket: [1, 0],
}

/** A tag's box, in wall units: 12 px type, so about 4.8 units tall (board: 19 px at 390). */
const TAG_H = 4.8
const tagWidth = (text: string) => Math.round((3.5 + 1.75 * text.length) * 10) / 10

/**
 * Where a place's wilting tags go. Above the sprite where there is room (the
 * fridge, the shelves). The freezer's and the basket's are below, clear of their
 * own name tags: below the drawer, and under the basket's plank (board A's "2
 * days"). `shift` is the way a second tag in the same place moves to clear the
 * first.
 */
const TAGS: Record<PlaceKey, { side: 'above' | 'below'; y?: number; shift: 'up' | 'down' | 'right' }> = {
  fridge: { side: 'above', shift: 'up' },
  freezer: { side: 'below', y: 58.4, shift: 'down' },
  shelves: { side: 'above', shift: 'up' },
  basket: { side: 'below', y: 44.2, shift: 'right' },
}

export interface PlacedSprite {
  /** Stable React key: the place and the slot. */
  key: string
  place: PlaceKey
  kind: SpriteKind
  /** Top-left, in wall units. */
  x: number
  y: number
  w: number
  h: number
  /** Set for an item drawn by itself and drooped; `null` for a category sprite. */
  wilting: WiltingItem | null
}

export interface PlacedTag {
  /** The wilting item's id. */
  id: string
  place: PlaceKey
  text: string
  x: number
  y: number
  w: number
  h: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi))

function overlaps(a: PlacedTag, b: PlacedTag): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Position everything a stock draws. Category sprites come first, then the
 * wilting items (so a wilting item is painted over any neighbour it brushes), the
 * wilting ones in urgency order; `tags` follows the same order.
 */
export function layoutStock(stock: KitchenStock): { sprites: PlacedSprite[]; tags: PlacedTag[] } {
  const categorySprites: PlacedSprite[] = []
  const wiltingSprites: PlacedSprite[] = []

  for (const place of Object.keys(PLACE_SLOTS) as PlaceKey[]) {
    const slots = PLACE_SLOTS[place]
    const { kinds, wilting } = stock[place]
    const wiltSlots = WILT_ORDER[place].slice(0, wilting.length)
    const freeSlots = slots.map((_, i) => i).filter((i) => !wiltSlots.includes(i))

    const put = (slotIndex: number, kind: SpriteKind, item: WiltingItem | null) => {
      const { cx, base } = slots[slotIndex]
      const { w, h } = rowsSize(spriteArt(kind, item !== null).rows)
      return {
        key: `${place}-${slotIndex}`,
        place,
        kind,
        x: Math.round(cx - w / 2),
        y: base - h,
        w,
        h,
        wilting: item,
      } satisfies PlacedSprite
    }

    kinds.slice(0, freeSlots.length).forEach((kind, i) => {
      categorySprites.push(put(freeSlots[i], kind, null))
    })
    wilting.forEach((item, i) => {
      wiltingSprites.push(put(wiltSlots[i], item.kind, item))
    })
  }

  wiltingSprites.sort(
    (a, b) => a.wilting!.daysLeft - b.wilting!.daysLeft || a.wilting!.id.localeCompare(b.wilting!.id),
  )

  const tags: PlacedTag[] = []
  for (const s of wiltingSprites) {
    const item = s.wilting!
    const cfg = TAGS[s.place]
    const w = tagWidth(item.tag)
    const tag: PlacedTag = {
      id: item.id,
      place: s.place,
      text: item.tag,
      x: clamp(s.x - 0.3, 1, WALL_W - w - 1),
      y: cfg.side === 'above' ? s.y - TAG_H + 0.5 : cfg.y!,
      w,
      h: TAG_H,
    }
    // Nudge clear of a tag already placed (at most three tags exist).
    for (let attempt = 0; attempt < 6 && tags.some((t) => overlaps(t, tag)); attempt++) {
      if (cfg.shift === 'right') tag.x = clamp(tag.x + tag.w + 0.4, 1, WALL_W - w - 1)
      else tag.y += (cfg.shift === 'up' ? -1 : 1) * (TAG_H + 0.4)
    }
    tag.y = clamp(tag.y, 0, WALL_H - TAG_H)
    tags.push(tag)
  }

  return { sprites: [...categorySprites, ...wiltingSprites], tags }
}
