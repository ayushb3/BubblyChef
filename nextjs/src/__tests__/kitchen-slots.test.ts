/**
 * The 12 decoration slots on the pixel wall (issue #748). The keys are the
 * contract with the catalog and the `decorations` table and must not change;
 * only the positions moved.
 */
import { SLOTS, SLOT_KEYS } from '@/lib/kitchen/slots'
import { PLACE_BOXES, PLACE_CONTENT, TAG_UNITS } from '@/components/kitchen/KitchenWall'

const OLD_SLOT_KEYS = [
  'wall_shelf',
  'wall_art',
  'window_sill',
  'lights',
  'hanging_plant',
  'fridge_door',
  'counter_left',
  'counter_right',
  'stove_top',
  'table',
  'rug',
  'floor_corner',
]

describe('SLOTS on the wall (#748)', () => {
  it('keeps exactly the 12 slot keys, so nobody loses a decoration', () => {
    expect([...SLOT_KEYS].sort()).toEqual([...OLD_SLOT_KEYS].sort())
  })

  it('keeps every box inside the wall (to rounding)', () => {
    for (const s of SLOTS) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.w).toBeGreaterThan(0)
      expect(s.h).toBeGreaterThan(0)
      expect(s.x + s.w).toBeLessThanOrEqual(100.05)
      expect(s.y + s.h).toBeLessThanOrEqual(100.05)
    }
  })

  it('has no two slots overlapping, so two decorations never sit on each other', () => {
    for (let i = 0; i < SLOTS.length; i++) {
      for (let j = i + 1; j < SLOTS.length; j++) {
        const a = SLOTS[i]
        const b = SLOTS[j]
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect([a.key, b.key, overlap]).toEqual([a.key, b.key, false])
      }
    }
  })

  // Rects in percent of the wall, from wall units.
  const pct = (x: number, y: number, w: number, h: number) => ({
    x: (x / 96) * 100,
    y: (y / 80) * 100,
    w: (w / 96) * 100,
    h: (h / 80) * 100,
  })
  // Touching edges are not an overlap (EPS absorbs float and rounding noise).
  const EPS = 0.05
  const hits = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS

  it('keeps every slot clear of the place tags (a decoration never hides a label)', () => {
    for (const [name, { tag, anchorRight }] of Object.entries(PLACE_BOXES)) {
      const width = TAG_UNITS.w[name as keyof typeof TAG_UNITS.w]
      // `tag[0]` is the left edge, or the right edge for a right-anchored tag.
      const left = anchorRight ? tag[0] - width : tag[0]
      const rect = pct(left, tag[1], width, TAG_UNITS.h)
      for (const s of SLOTS) {
        expect([name, s.key, hits(s, rect)]).toEqual([name, s.key, false])
      }
    }
  })

  it('keeps every slot clear of what each place draws (a decoration never covers the contents)', () => {
    for (const [name, box] of Object.entries(PLACE_CONTENT)) {
      const rect = pct(...box)
      for (const s of SLOTS) {
        expect([name, s.key, hits(s, rect)]).toEqual([name, s.key, false])
      }
    }
  })
})
