/**
 * Issue #891 — a preheat is a hands-off wait: it blocks only the steps that
 * need the hot oven, and unrelated hands-on prep (seasoning, chopping) runs
 * inside the wait instead of after it. The dependency chain the model emits
 * ("each step after the previous one") must not turn a preheat into 5 idle
 * minutes.
 */

import { scheduleMeal, sanitizedDependencyKeys } from '@/lib/meal-scheduler'
import type { SchedulerDish } from '@/lib/meal-scheduler'
import type { Step } from '@/types/recipes'

function step(
  overrides: Partial<Step> & { text: string; label: string; duration_minutes: number; hands_on: boolean },
): Step {
  return { ongoing_label: null, duration_estimated: false, depends_on: [], exclusive: [], ...overrides }
}

function carrotDish(opts: {
  seasonDeps?: number[]
  roastDeps?: number[]
  preheatHandsOn?: boolean
  roastText?: string
}): SchedulerDish {
  return {
    dish_id: 'carrots',
    column: 'main',
    title: 'Roasted carrots',
    steps: [
      step({
        text: 'Preheat the oven to 220C.',
        label: 'Preheat the oven',
        ongoing_label: 'the oven heats',
        duration_minutes: 5,
        hands_on: opts.preheatHandsOn ?? false,
        depends_on: [],
      }),
      step({
        text: 'Toss the carrots with oil, salt and pepper.',
        label: 'Season the carrots',
        duration_minutes: 3,
        hands_on: true,
        depends_on: opts.seasonDeps ?? [0],
      }),
      step({
        text: opts.roastText ?? 'Roast the carrots for 25 minutes until golden.',
        label: 'Roast the carrots',
        ongoing_label: 'the carrots roast',
        duration_minutes: 25,
        hands_on: false,
        depends_on: opts.roastDeps ?? [1],
      }),
    ],
  }
}

function placement(dish: SchedulerDish, index: number) {
  const tl = scheduleMeal({ dishes: [dish] })
  const p = tl.placements.find((x) => x.step_index === index)
  if (!p) throw new Error(`no placement for step ${index}`)
  return { p, tl }
}

describe('preheat does not block prep (issue #891)', () => {
  it('seasoning runs during the preheat and the roast waits for it (chained deps, as the model emits)', () => {
    const dish = carrotDish({})
    const { tl } = placement(dish, 0)
    const preheat = tl.placements.find((x) => x.step_index === 0)!
    const season = tl.placements.find((x) => x.step_index === 1)!
    const roast = tl.placements.find((x) => x.step_index === 2)!

    expect(season.start).toBeLessThan(preheat.end)
    expect(season.end).toBeLessThanOrEqual(roast.start)
    expect(roast.start).toBeGreaterThanOrEqual(preheat.end)
    expect(roast.start).toBeGreaterThanOrEqual(season.end)
    // 5 min preheat overlapping the 3 min seasoning, then the 25 min roast.
    expect(tl.total_minutes).toBe(30)
  })

  it('still holds when the roast only lists the seasoning as its prerequisite (preheat reached only transitively)', () => {
    const { tl } = placement(carrotDish({ seasonDeps: [0], roastDeps: [1] }), 0)
    const preheat = tl.placements.find((x) => x.step_index === 0)!
    const roast = tl.placements.find((x) => x.step_index === 2)!
    expect(roast.start).toBeGreaterThanOrEqual(preheat.end)
    expect(tl.total_minutes).toBe(30)
  })

  it('treats a preheat the model marked hands-on as a wait too, so the cook can season meanwhile', () => {
    const { tl } = placement(carrotDish({ preheatHandsOn: true }), 0)
    const preheat = tl.placements.find((x) => x.step_index === 0)!
    const season = tl.placements.find((x) => x.step_index === 1)!
    expect(season.start).toBeLessThan(preheat.end)
    expect(tl.total_minutes).toBe(30)
  })

  it('keeps the preheat as a prerequisite of a step that needs the oven even if that step is prep-like', () => {
    const dish = carrotDish({})
    dish.steps[1] = step({
      text: 'Toss the carrots with oil and put them in the oven.',
      label: 'Season and load the carrots',
      duration_minutes: 3,
      hands_on: true,
      depends_on: [0],
    })
    const { tl } = placement(dish, 1)
    const preheat = tl.placements.find((x) => x.step_index === 0)!
    const load = tl.placements.find((x) => x.step_index === 1)!
    expect(load.start).toBeGreaterThanOrEqual(preheat.end)
  })

  it('keeps the prep step own prerequisites (a chop before the preheat) when it drops the preheat', () => {
    const dish: SchedulerDish = {
      dish_id: 'carrots',
      column: 'main',
      title: 'Roasted carrots',
      steps: [
        step({ text: 'Peel and chop the carrots.', label: 'Chop the carrots', duration_minutes: 4, hands_on: true, depends_on: [] }),
        step({ text: 'Preheat the oven to 220C.', label: 'Preheat the oven', duration_minutes: 5, hands_on: false, depends_on: [0] }),
        step({ text: 'Season the chopped carrots.', label: 'Season the carrots', duration_minutes: 2, hands_on: true, depends_on: [1] }),
        step({ text: 'Roast the carrots.', label: 'Roast the carrots', duration_minutes: 20, hands_on: false, depends_on: [2] }),
      ],
    }
    const tl = scheduleMeal({ dishes: [dish] })
    const at = (i: number) => tl.placements.find((x) => x.step_index === i)!
    expect(at(2).start).toBeGreaterThanOrEqual(at(0).end) // seasoning still needs the chopped carrots
    expect(at(2).start).toBeLessThan(at(1).end) // but not the oven
    expect(at(3).start).toBeGreaterThanOrEqual(at(1).end)
  })

  it('does not mistake a baking sheet for the oven: lining the tray is prep that can run during the preheat', () => {
    const dish = carrotDish({})
    dish.steps[1] = step({
      text: 'Spread the carrots on a baking sheet and season them.',
      label: 'Season on the baking sheet',
      duration_minutes: 3,
      hands_on: true,
      depends_on: [0],
    })
    const { tl } = placement(dish, 1)
    const preheat = tl.placements.find((x) => x.step_index === 0)!
    const season = tl.placements.find((x) => x.step_index === 1)!
    expect(season.start).toBeLessThan(preheat.end)
  })

  it('exposes the relaxed dependencies to the cook-along wait reasons', () => {
    const dishes = [carrotDish({})]
    expect(sanitizedDependencyKeys(dishes, 'carrots', 1)).toEqual([])
    expect(sanitizedDependencyKeys(dishes, 'carrots', 2)).toEqual(['carrots:0', 'carrots:1'])
  })

  it('leaves a dish whose dependencies are invalid on the strict-order fallback', () => {
    const dish = carrotDish({ seasonDeps: [0, 7] })
    const tl = scheduleMeal({ dishes: [dish] })
    expect(tl.degraded).toBe(true)
    const preheat = tl.placements.find((x) => x.step_index === 0)!
    const season = tl.placements.find((x) => x.step_index === 1)!
    expect(season.start).toBeGreaterThanOrEqual(preheat.end)
  })

  it('does not touch a dependency on a non-preheat step', () => {
    const dish: SchedulerDish = {
      dish_id: 'soup',
      column: 'main',
      title: 'Soup',
      steps: [
        step({ text: 'Chop the onion.', label: 'Chop the onion', duration_minutes: 3, hands_on: true, depends_on: [] }),
        step({ text: 'Fry the onion.', label: 'Fry the onion', duration_minutes: 5, hands_on: true, depends_on: [0] }),
      ],
    }
    expect(sanitizedDependencyKeys([dish], 'soup', 1)).toEqual(['soup:0'])
  })
})
