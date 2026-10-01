/**
 * The put-away flight plan (issue #754, board A3's confirmation animation):
 * each item hops from the list to its own place, one by one, in list order, and
 * a long receipt stays short (the stagger shrinks, the tail lands in batches per
 * place). Pure: the schedule is computed here, so the time budget is tested
 * without rendering anything.
 */
import {
  CHIP_UNITS,
  FLIGHT_ANCHORS,
  HOP_FRAMES,
  HOP_MS,
  INDIVIDUAL_MAX,
  SPARKLE_MS,
  finalLanded,
  hopPath,
  landedBy,
  planFlight,
} from '@/lib/kitchen/put-away-flight'
import { PLACE_CONTENT, PLACE_BOXES, TAG_UNITS } from '@/components/kitchen/KitchenWall'
import { PLACE_KEYS, type PlaceKey } from '@/lib/kitchen/places'

const ROTATION: PlaceKey[] = ['fridge', 'freezer', 'shelves', 'basket']

function items(n: number): Array<{ id: string; place: PlaceKey }> {
  return Array.from({ length: n }, (_, i) => ({ id: `i${i}`, place: ROTATION[i % 4] }))
}

describe('planFlight', () => {
  it('flies 11 items one by one, in list order, each to its own place', () => {
    const list = items(11)
    const plan = planFlight(list)

    expect(plan.steps).toHaveLength(11)
    expect(plan.steps.map((s) => s.items[0].id)).toEqual(list.map((i) => i.id))
    plan.steps.forEach((s, i) => {
      expect(s.items).toHaveLength(1)
      expect(s.place).toBe(list[i].place)
      expect(s.landAt).toBe(s.at + HOP_MS)
    })
    // One by one: every departure is later than the last.
    for (let i = 1; i < plan.steps.length; i++) {
      expect(plan.steps[i].at).toBeGreaterThan(plan.steps[i - 1].at)
    }
    expect(plan.steps[0].at).toBe(0)
  })

  it("each place's count ends correct", () => {
    const plan = planFlight(items(11))
    // 11 items round-robin over four places: 3, 3, 3, 2.
    expect(finalLanded(plan)).toEqual({ fridge: 3, freezer: 3, shelves: 3, basket: 2 })
    expect(landedBy(plan, plan.totalMs)).toEqual(finalLanded(plan))
  })

  it('ticks a place up as each of its items lands, and not before', () => {
    const plan = planFlight(items(11))
    expect(landedBy(plan, 0)).toEqual({ fridge: 0, freezer: 0, shelves: 0, basket: 0 })
    // Just before the first hop ends nothing has landed; right at it, the fridge has one.
    expect(landedBy(plan, HOP_MS - 1).fridge).toBe(0)
    expect(landedBy(plan, HOP_MS)).toEqual({ fridge: 1, freezer: 0, shelves: 0, basket: 0 })
  })

  it('finishes 30 items in under about 4 seconds, sparkle included', () => {
    const plan = planFlight(items(30))
    expect(plan.totalMs).toBeLessThan(4000)
    expect(plan.totalMs).toBe(Math.max(...plan.steps.map((s) => s.landAt)) + SPARKLE_MS)
  })

  it('stays under budget however long the receipt is (a 40-line receipt is not half a minute)', () => {
    for (const n of [1, 2, 5, 11, 12, 13, 20, 30, 40, 100]) {
      expect(planFlight(items(n)).totalMs).toBeLessThan(4000)
    }
  })

  it('shrinks the stagger as the item count grows', () => {
    const gap = (n: number) => {
      const s = planFlight(items(n)).steps
      return s[1].at - s[0].at
    }
    expect(gap(11)).toBeGreaterThanOrEqual(gap(12))
    expect(gap(30)).toBeLessThan(gap(5))
  })

  it('lands everything beyond about 12 items in batches, one per place', () => {
    const list = items(30)
    const plan = planFlight(list)
    const singles = plan.steps.filter((s) => s.items.length === 1)
    const batches = plan.steps.filter((s) => s.items.length > 1)

    expect(singles).toHaveLength(INDIVIDUAL_MAX)
    expect(singles.map((s) => s.items[0].id)).toEqual(list.slice(0, INDIVIDUAL_MAX).map((i) => i.id))
    // The remaining 18 land as one batch per place, after the singles have left.
    expect(batches.map((b) => b.place)).toEqual(PLACE_KEYS.filter((k) => batches.some((b) => b.place === k)))
    expect(batches.length).toBeLessThanOrEqual(4)
    expect(batches.reduce((n, b) => n + b.items.length, 0)).toBe(30 - INDIVIDUAL_MAX)
    for (const b of batches) {
      expect(b.at).toBeGreaterThan(singles[singles.length - 1].at)
    }
    // Nothing is lost: the counts still add up per place.
    expect(finalLanded(plan)).toEqual({ fridge: 8, freezer: 8, shelves: 7, basket: 7 })
  })

  it('a batch only leaves for places that have items in the tail', () => {
    const list = [
      ...items(INDIVIDUAL_MAX),
      { id: 'x1', place: 'basket' as PlaceKey },
      { id: 'x2', place: 'basket' as PlaceKey },
    ]
    const plan = planFlight(list)
    const batches = plan.steps.filter((s) => s.items.length > 1)
    expect(batches).toHaveLength(1)
    expect(batches[0].place).toBe('basket')
    expect(batches[0].items.map((i) => i.id)).toEqual(['x1', 'x2'])
  })

  it('a single item still hops, and an empty receipt has nothing to play', () => {
    expect(planFlight(items(1)).steps).toHaveLength(1)
    const none = planFlight([])
    expect(none.steps).toEqual([])
    expect(none.totalMs).toBe(0)
  })
})

describe('hopPath', () => {
  it('steps from the row to the place in HOP_FRAMES + 1 stills, with a hop in the middle', () => {
    const { x, y } = hopPath({ x: 200, y: 600 }, { x: 60, y: 100 })
    expect(x).toHaveLength(HOP_FRAMES + 1)
    expect(y).toHaveLength(HOP_FRAMES + 1)
    expect([x[0], y[0]]).toEqual([200, 600])
    expect([x[HOP_FRAMES], y[HOP_FRAMES]]).toEqual([60, 100])
    // Frame by frame it keeps heading to the place (x only ever decreases here)...
    for (let i = 1; i < x.length; i++) expect(x[i]).toBeLessThan(x[i - 1])
    // ...and the middle frames are lifted above the straight line (the hop).
    const mid = Math.floor(HOP_FRAMES / 2)
    const straight = 600 + (100 - 600) * (mid / HOP_FRAMES)
    expect(y[mid]).toBeLessThan(straight)
  })
})

describe('the flight never covers a place tag or leaves the place', () => {
  for (const place of PLACE_KEYS) {
    it(`${place}: lands on its drawn object, clear of its tag`, () => {
      const { x, y } = FLIGHT_ANCHORS[place]
      const half = CHIP_UNITS / 2
      const chip = { l: x - half, r: x + half, t: y - half, b: y + half }

      const [cx, cy, cw, ch] = PLACE_CONTENT[place]
      expect(chip.l).toBeGreaterThanOrEqual(cx)
      expect(chip.r).toBeLessThanOrEqual(cx + cw)
      expect(chip.t).toBeGreaterThanOrEqual(cy)
      expect(chip.b).toBeLessThanOrEqual(cy + ch)

      const [tx, ty] = PLACE_BOXES[place].tag
      const tag = { l: tx, r: tx + TAG_UNITS.w[place], t: ty, b: ty + TAG_UNITS.h }
      const overlaps = chip.l < tag.r && chip.r > tag.l && chip.t < tag.b && chip.b > tag.t
      expect(overlaps).toBe(false)
    })
  }
})
