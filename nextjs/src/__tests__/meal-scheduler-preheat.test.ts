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

  it('roast text that says "preheated oven" still waits for the preheat while seasoning runs during it', () => {
    const dish = carrotDish({ roastText: 'Roast the carrots in the preheated oven for 25 minutes.' })
    const tl = scheduleMeal({ dishes: [dish] })
    const at = (i: number) => tl.placements.find((x) => x.step_index === i)!
    expect(at(1).start).toBeLessThan(at(0).end)
    expect(at(2).start).toBeGreaterThanOrEqual(at(0).end)
    expect(tl.total_minutes).toBe(30)
  })
})

describe('only a step that IS a preheat is treated as one (issue #891 review)', () => {
  const dishOf = (steps: Step[]): SchedulerDish => ({ dish_id: 'd', column: 'main', title: 'Dish', steps })
  const prep = (text: string, label: string, deps: number[], handsOn = true, minutes = 4) =>
    step({ text, label, duration_minutes: minutes, hands_on: handsOn, depends_on: deps })

  it('"Bake in the preheated oven" is an oven step: it waits for the preheat and the mixing', () => {
    const dish = dishOf([
      prep('Preheat the oven to 180C.', 'Preheat the oven', [], false, 10),
      prep('Mix the batter.', 'Mix the batter', [0]),
      prep('Bake in the preheated oven for 30 minutes.', 'Bake the cake', [1], false, 30),
    ])
    const tl = scheduleMeal({ dishes: [dish] })
    const at = (i: number) => tl.placements.find((x) => x.step_index === i)!
    expect(at(1).start).toBeLessThan(at(0).end) // mixing runs during the preheat
    expect(at(2).start).toBeGreaterThanOrEqual(at(0).end)
    expect(at(2).start).toBeGreaterThanOrEqual(at(1).end)
  })

  it('a step that only mentions a preheated oven keeps its dependencies and its hands_on', () => {
    const dish = dishOf([
      prep('Mix the batter.', 'Mix the batter', []),
      prep('Bake in the preheated oven for 30 minutes.', 'Bake the cake', [0], true, 30),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual(['d:0'])
    const tl = scheduleMeal({ dishes: [dish] })
    expect(tl.placements.find((x) => x.step_index === 1)!.hands_on).toBe(true)
    expect(tl.placements.find((x) => x.step_index === 1)!.start).toBeGreaterThanOrEqual(
      tl.placements.find((x) => x.step_index === 0)!.end,
    )
  })

  it('"Roast the carrots in the preheated oven" does not start before the oven is hot', () => {
    const dish = dishOf([
      prep('Peel the carrots.', 'Peel the carrots', []),
      prep('Roast the carrots in the preheated oven for 25 minutes.', 'Roast the carrots', [0], false, 25),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual(['d:0'])
  })

  it('"While the oven preheats, chop the carrots" is prep, not a preheat: stays hands-on, not held behind the oven', () => {
    const dish = dishOf([
      prep('Preheat the oven to 220C.', 'Preheat the oven', [], false, 10),
      prep('While the oven preheats, chop the carrots.', 'Chop the carrots', [0]),
      prep('Roast the carrots.', 'Roast the carrots', [1], false, 20),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual([])
    const tl = scheduleMeal({ dishes: [dish] })
    const chop = tl.placements.find((x) => x.step_index === 1)!
    expect(chop.hands_on).toBe(true)
    expect(chop.start).toBeLessThan(tl.placements.find((x) => x.step_index === 0)!.end)
  })

  it('a lone "While the oven preheats..." step is not forced hands-off and keeps its dependencies', () => {
    const dish = dishOf([
      prep('Peel the carrots.', 'Peel the carrots', []),
      prep('While the oven preheats, chop the carrots.', 'Chop the carrots', [0]),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual(['d:0'])
    const tl = scheduleMeal({ dishes: [dish] })
    expect(tl.placements.find((x) => x.step_index === 1)!.hands_on).toBe(true)
  })

  it('"The oven preheats for 10 minutes" (a mention, not a command) is not a preheat', () => {
    const dish = dishOf([
      prep('Peel the carrots.', 'Peel the carrots', []),
      prep('The oven preheats for 10 minutes; chop the carrots meanwhile.', 'Chop the carrots', [0]),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual(['d:0'])
  })

  it('"Heat the oil" and "Heat a grill pan" are not appliance preheats', () => {
    const dish = dishOf([
      prep('Heat the oil in a pan.', 'Heat the oil', []),
      prep('Heat a grill pan over high heat.', 'Heat the grill pan', [0]),
      prep('Fry the onions.', 'Fry the onions', [1]),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual(['d:0'])
    expect(sanitizedDependencyKeys([dish], 'd', 2)).toEqual(['d:1'])
  })

  it('recognises the imperative in the title or the text, in the usual wordings', () => {
    for (const [label, text] of [
      ['Preheat the oven', 'Set it to 220C.'],
      ['Get the oven hot', 'Preheat your oven to 220C.'],
      ['Heat the oven', 'Heat the oven to 200C.'],
      ['Preheat the air fryer', 'Preheat the air fryer to 190C.'],
    ]) {
      const dish = dishOf([prep(text, label, [], false, 5), prep('Season the veg.', 'Season the veg', [0])])
      expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual([])
    }
  })

  it('two preheats: every dependency is computed from the original ones, none leaks from the first pass', () => {
    const dish = dishOf([
      prep('Preheat the oven to 220C.', 'Preheat the oven', [], false, 8),
      prep('Preheat the broiler. Keep the oven door shut.', 'Preheat the broiler', [0], false, 8),
      prep('Season the carrots.', 'Season the carrots', [1]),
      prep('Roast the carrots.', 'Roast the carrots', [2], false, 20),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 0)).toEqual([])
    expect(sanitizedDependencyKeys([dish], 'd', 1)).toEqual([])
    expect(sanitizedDependencyKeys([dish], 'd', 2)).toEqual([])
    expect(sanitizedDependencyKeys([dish], 'd', 3)).toEqual(['d:0', 'd:2'])
    const tl = scheduleMeal({ dishes: [dish] })
    const at = (i: number) => tl.placements.find((x) => x.step_index === i)!
    expect(at(2).start).toBeLessThan(at(0).end)
    expect(at(3).start).toBeGreaterThanOrEqual(at(0).end)
  })

  it('two preheats around a chop: the chop still comes first for the seasoning', () => {
    const dish = dishOf([
      prep('Chop the carrots.', 'Chop the carrots', []),
      prep('Preheat the oven to 220C.', 'Preheat the oven', [0], false, 8),
      prep('Preheat the grill to high.', 'Preheat the grill', [1], false, 8),
      prep('Season the carrots.', 'Season the carrots', [2]),
    ])
    expect(sanitizedDependencyKeys([dish], 'd', 3)).toEqual(['d:0'])
  })
})
