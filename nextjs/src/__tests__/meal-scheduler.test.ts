/**
 * Issue #649 — table + golden tests for `scheduleMeal`, against the
 * realistic fixture meals in `@/lib/meal-fixtures` (shared with the
 * timeline table's component tests and the dev fixture page). Expected
 * values below were captured from the implementation itself and reviewed
 * by hand (see the PR description) rather than derived independently —
 * they pin exact placements, rows and cue strings as goldens so a future
 * change to the algorithm's output is a deliberate, visible diff.
 */

import { scheduleMeal, SchedulerDish } from '@/lib/meal-scheduler'
import {
  PASTA_SAUCE_SALAD,
  ROAST_TWO_SIDES,
  ONE_PAN_MEAL,
  ONE_SIDE_MEAL,
} from '@/lib/meal-fixtures'
import type { Step } from '@/types/recipes'

function step(
  overrides: Partial<Step> & {
    text: string
    label: string
    duration_minutes: number
    hands_on: boolean
  },
): Step {
  return {
    ongoing_label: null,
    duration_estimated: false,
    depends_on: [],
    exclusive: [],
    ...overrides,
  }
}

describe('scheduleMeal — pasta + sauce + salad', () => {
  const timeline = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })

  it('never overlaps two hands-on steps (guarantee 1)', () => {
    const handsOn = timeline.placements.filter((p) => p.hands_on).sort((a, b) => a.start - b.start)
    for (let i = 1; i < handsOn.length; i++) {
      expect(handsOn[i].start).toBeGreaterThanOrEqual(handsOn[i - 1].end)
    }
  })

  it('finishes both dishes within the default 2-minute window, with no warning', () => {
    expect(timeline.finish_spread_minutes).toBeLessThanOrEqual(2)
    expect(timeline.warnings).not.toContain('finish_spread')
  })

  it('interleaves the salad while the sauce reduces, with the exact cue string', () => {
    const row = timeline.rows.find((r) => r.cue !== undefined)
    expect(row?.cue).toBe('While the sauce reduces, Chop salad veg')
  })

  it('matches the full golden timeline', () => {
    expect(timeline.total_minutes).toBe(20)
    expect(timeline.hands_on_minutes).toBe(13)
    expect(timeline.finish_spread_minutes).toBe(2)
    expect(timeline.warnings).toEqual([])
    expect(timeline.degraded).toBe(false)
    expect(timeline.placements.map((p) => [p.dish_id, p.step_index, p.start, p.end])).toEqual([
      ['main', 0, 0, 3],
      ['main', 1, 3, 18],
      ['main', 2, 7, 8],
      ['main', 3, 8, 18],
      ['salad', 0, 11, 16],
      ['salad', 1, 16, 18],
      ['main', 4, 18, 20],
    ])
    expect(timeline.rows.map((r) => r.offset_minutes)).toEqual([0, 3, 7, 8, 11, 16, 18])
    expect(timeline.rows.map((r) => r.cue)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'While the sauce reduces, Chop salad veg',
      'While the sauce reduces, Toss salad',
      undefined,
    ])
  })

  it('is byte-identical across repeated calls on the same input (guarantee 5)', () => {
    const again = scheduleMeal({ dishes: PASTA_SAUCE_SALAD.dishes })
    expect(again).toEqual(timeline)
  })

  it('a faded ongoing cell reports the ongoing label and minutes left', () => {
    const row = timeline.rows.find((r) => r.offset_minutes === 11)
    expect(row?.cells.main).toEqual({
      kind: 'ongoing',
      ongoing_label: 'the sauce reduces',
      label: 'Simmer sauce',
      remaining_minutes: 7,
      hands_on: false,
    })
  })

  it('is never longer than cooking the dishes one after another (guarantee 6)', () => {
    // Main alone (its own critical path) + salad alone.
    const mainAlone = scheduleMeal({ dishes: [PASTA_SAUCE_SALAD.dishes[0]] })
    const saladAlone = scheduleMeal({ dishes: [PASTA_SAUCE_SALAD.dishes[1]] })
    expect(timeline.total_minutes).toBeLessThanOrEqual(mainAlone.total_minutes + saladAlone.total_minutes)
  })
})

describe('scheduleMeal — roast + two sides', () => {
  const timeline = scheduleMeal({ dishes: ROAST_TWO_SIDES.dishes })

  it('all three dishes finish together', () => {
    expect(timeline.finish_spread_minutes).toBe(0)
    expect(timeline.warnings).not.toContain('finish_spread')
  })

  it('never overlaps two hands-on steps across three dishes', () => {
    const handsOn = timeline.placements.filter((p) => p.hands_on).sort((a, b) => a.start - b.start)
    for (let i = 1; i < handsOn.length; i++) {
      expect(handsOn[i].start).toBeGreaterThanOrEqual(handsOn[i - 1].end)
    }
  })

  it('matches the golden total and finish time', () => {
    expect(timeline.total_minutes).toBe(63)
    expect(timeline.hands_on_minutes).toBe(15)
    expect(timeline.degraded).toBe(false)
    const ends = ['roast', 'potatoes', 'greenbeans'].map(
      (id) => Math.max(...timeline.placements.filter((p) => p.dish_id === id).map((p) => p.end)),
    )
    expect(ends).toEqual([63, 63, 63])
  })

  it('cues alternate between whichever roast is the longest ongoing one', () => {
    const cues = timeline.rows.map((r) => r.cue).filter((c): c is string => c !== undefined)
    expect(cues).toEqual([
      'While the chicken roasts, Parboil potatoes',
      'While the chicken roasts, Toss potatoes',
      'While the chicken roasts, Roast potatoes',
      'While the potatoes roast, Rest chicken',
      'While the potatoes roast, Trim beans',
      'While the potatoes roast, Steam beans',
      'While the potatoes roast, Carve chicken',
    ])
  })
})

describe('scheduleMeal — one-pan meal (kitchen limits)', () => {
  const timeline = scheduleMeal({ dishes: ONE_PAN_MEAL.dishes })

  it('never overlaps two steps sharing the "pan" exclusive tag (guarantee 3)', () => {
    const panSteps = timeline.placements
      .filter((p) => {
        const dish = ONE_PAN_MEAL.dishes.find((d) => d.dish_id === p.dish_id)!
        return dish.steps[p.step_index].exclusive.includes('pan')
      })
      .sort((a, b) => a.start - b.start)
    expect(panSteps).toHaveLength(2)
    expect(panSteps[1].start).toBeGreaterThanOrEqual(panSteps[0].end)
  })

  it('the pan side runs strictly after the pan main step (golden)', () => {
    expect(timeline.total_minutes).toBe(11)
    expect(timeline.placements.map((p) => [p.dish_id, p.step_index, p.start, p.end])).toEqual([
      ['chicken', 0, 0, 6],
      ['chicken', 1, 6, 11],
      ['veg', 0, 7, 11],
    ])
  })
})

describe('scheduleMeal — one-side meal', () => {
  const timeline = scheduleMeal({ dishes: ONE_SIDE_MEAL.dishes })

  it('overlaps the flexible hands-on step with the long hands-off boil rather than running fully sequential', () => {
    // A naive schedule would run grill (8) fully after boil+mash (18), for a
    // total of 26. The scheduler should find the much shorter overlapped plan.
    expect(timeline.total_minutes).toBe(18)
  })

  it('reports finish_spread when the window genuinely cannot be met (guarantee 4, infeasible case)', () => {
    expect(timeline.finish_spread_minutes).toBeGreaterThan(2)
    expect(timeline.warnings).toContain('finish_spread')
  })

  it('is never longer than the two dishes cooked one after another (guarantee 6)', () => {
    const steakAlone = scheduleMeal({ dishes: [ONE_SIDE_MEAL.dishes[0]] })
    const mashAlone = scheduleMeal({ dishes: [ONE_SIDE_MEAL.dishes[1]] })
    expect(timeline.total_minutes).toBeLessThanOrEqual(steakAlone.total_minutes + mashAlone.total_minutes)
  })
})

describe('scheduleMeal — defensive degradation', () => {
  it('a missing duration defaults to 3 minutes and raises estimated_duration', () => {
    const dish: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Mystery dish',
      steps: [
        step({ text: 'Do something', label: 'Do something', duration_minutes: 0, hands_on: true }),
      ],
    }
    const timeline = scheduleMeal({ dishes: [dish] })
    expect(timeline.placements[0].duration_minutes).toBe(3)
    expect(timeline.warnings).toContain('estimated_duration')
  })

  it('propagates an upstream duration_estimated flag as the estimated_duration warning', () => {
    const dish: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Dish',
      steps: [
        step({
          text: 'Simmer',
          label: 'Simmer',
          duration_minutes: 5,
          duration_estimated: true,
          hands_on: false,
        }),
      ],
    }
    const timeline = scheduleMeal({ dishes: [dish] })
    expect(timeline.placements[0].duration_minutes).toBe(5)
    expect(timeline.warnings).toContain('estimated_duration')
  })

  it('an out-of-range depends_on index degrades the dish to strict order (sequential_fallback)', () => {
    const dish: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Broken recipe',
      steps: [
        step({ text: 'Step A', label: 'Step A', duration_minutes: 3, hands_on: true }),
        step({ text: 'Step B', label: 'Step B', duration_minutes: 3, hands_on: true, depends_on: [5] }),
        step({ text: 'Step C', label: 'Step C', duration_minutes: 3, hands_on: true }),
      ],
    }
    const timeline = scheduleMeal({ dishes: [dish] })
    expect(timeline.degraded).toBe(true)
    expect(timeline.warnings).toContain('sequential_fallback')
    expect(timeline.placements.map((p) => [p.step_index, p.start, p.end])).toEqual([
      [0, 0, 3],
      [1, 3, 6],
      [2, 6, 9],
    ])
  })

  it('a self-referencing depends_on is dropped and degrades the dish', () => {
    const dish: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Broken recipe',
      steps: [
        step({ text: 'Step A', label: 'Step A', duration_minutes: 3, hands_on: true, depends_on: [0] }),
      ],
    }
    const timeline = scheduleMeal({ dishes: [dish] })
    expect(timeline.degraded).toBe(true)
    expect(timeline.warnings).toContain('sequential_fallback')
  })
})

describe('scheduleMeal — edge shapes', () => {
  it('handles an empty dish list', () => {
    const timeline = scheduleMeal({ dishes: [] })
    expect(timeline).toEqual({
      placements: [],
      total_minutes: 0,
      hands_on_minutes: 0,
      finish_spread_minutes: 0,
      rows: [],
      warnings: [],
      degraded: false,
    })
  })

  it('a dish with only hands-on steps still serializes cleanly', () => {
    const dish: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'All hands-on',
      steps: [
        step({ text: 'A', label: 'A', duration_minutes: 2, hands_on: true }),
        step({ text: 'B', label: 'B', duration_minutes: 2, hands_on: true }),
        step({ text: 'C', label: 'C', duration_minutes: 2, hands_on: true }),
      ],
    }
    const timeline = scheduleMeal({ dishes: [dish] })
    expect(timeline.total_minutes).toBe(6)
    const handsOn = timeline.placements.sort((a, b) => a.start - b.start)
    for (let i = 1; i < handsOn.length; i++) {
      expect(handsOn[i].start).toBeGreaterThanOrEqual(handsOn[i - 1].end)
    }
  })

  it('a dish whose steps are all independent (no depends_on) still respects the cook resource', () => {
    const dish: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'All independent',
      steps: [
        step({ text: 'A', label: 'A', duration_minutes: 3, hands_on: true }),
        step({ text: 'B', label: 'B', duration_minutes: 4, hands_on: true }),
      ],
    }
    const timeline = scheduleMeal({ dishes: [dish] })
    expect(timeline.total_minutes).toBe(7)
    const [a, b] = timeline.placements.sort((x, y) => x.start - y.start)
    expect(b.start).toBeGreaterThanOrEqual(a.end)
  })
})
