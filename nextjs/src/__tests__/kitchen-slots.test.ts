/**
 * The 12 decoration slots on the pixel wall (issue #748). The keys are the
 * contract with the catalog and the `decorations` table and must not change;
 * only the positions moved.
 */
import { SLOTS, SLOT_KEYS } from '@/lib/kitchen/slots'
import { PLACE_BOXES } from '@/components/kitchen/KitchenWall'

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

  it('keeps every slot clear of the place tags (a decoration never hides a label)', () => {
    // A tag is drawn at 13px pixel type and is 24px tall (5.9 wall units). Widths
    // are measured off board A at 390px wide, in wall units, rounded up.
    const TAG_H = 6
    const TAG_W = { fridge: 19, freezer: 19, shelves: 16, basket: 19, chalkboard: 22 }
    const WALL_W = 96
    const WALL_H = 80
    for (const [name, { tag, anchorRight }] of Object.entries(PLACE_BOXES)) {
      const width = TAG_W[name as keyof typeof TAG_W]
      // `tag[0]` is the left edge, or the right edge for a right-anchored tag.
      const left = anchorRight ? tag[0] - width : tag[0]
      const tx = (left / WALL_W) * 100
      const ty = (tag[1] / WALL_H) * 100
      const tw = (width / WALL_W) * 100
      const th = (TAG_H / WALL_H) * 100
      for (const s of SLOTS) {
        const overlap = s.x < tx + tw && tx < s.x + s.w && s.y < ty + th && ty < s.y + s.h
        expect([name, s.key, overlap]).toEqual([name, s.key, false])
      }
    }
  })
})
