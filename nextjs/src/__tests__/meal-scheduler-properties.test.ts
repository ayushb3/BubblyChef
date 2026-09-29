/**
 * Issue #649 — property-style assertions of guarantees 1-7 over randomly
 * generated but seeded dish sets (mulberry32 — see `@/lib/seeded-random`,
 * no new dependency). Complements the golden fixture tests in
 * `meal-scheduler.test.ts`, which pin exact output for a handful of
 * realistic meals; these instead sweep many structurally-varied inputs to
 * catch guarantee violations a handful of hand-picked fixtures could miss.
 */

import { mulberry32, randInt, randChoice } from '@/lib/seeded-random'
import { scheduleMeal, Column, SchedulerDish, MealProgress } from '@/lib/meal-scheduler'
import type { Step } from '@/types/recipes'

const COLUMNS: Column[] = ['main', 'side_1', 'side_2']
const TAGS = ['pan', 'oven', 'board']

function makeStep(rng: () => number, index: number): Step {
  const handsOn = rng() < 0.5
  const hasDep = index > 0 && rng() < 0.6
  const exclusive = rng() < 0.2 ? [randChoice(rng, TAGS)] : []
  return {
    text: `Step ${index}`,
    label: `Step ${index}`,
    ongoing_label: handsOn ? null : `step ${index} runs`,
    duration_minutes: randInt(rng, 1, 12),
    duration_estimated: false,
    hands_on: handsOn,
    // A dependency, when present, always points at the immediately
    // preceding step — keeps the random graphs realistic (a linear chain
    // with occasional independent steps) without ever generating a cycle.
    depends_on: hasDep ? [index - 1] : [],
    exclusive,
  }
}

function makeDish(rng: () => number, column: Column, stepCount: number): SchedulerDish {
  const steps: Step[] = []
  for (let i = 0; i < stepCount; i++) steps.push(makeStep(rng, i))
  return { dish_id: column, column, title: `Dish ${column}`, steps }
}

function makeDishes(rng: () => number): SchedulerDish[] {
  const dishCount = randInt(rng, 1, 3)
  return COLUMNS.slice(0, dishCount).map((col) => makeDish(rng, col, randInt(rng, 1, 5)))
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 97 + 1)

describe('scheduleMeal — property tests over seeded random dish sets', () => {
  it('guarantee 1: no two hands-on steps ever overlap', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const dishes = makeDishes(rng)
      const timeline = scheduleMeal({ dishes })
      const handsOn = timeline.placements.filter((p) => p.hands_on).sort((a, b) => a.start - b.start)
      for (let i = 1; i < handsOn.length; i++) {
        expect(handsOn[i].start).toBeGreaterThanOrEqual(handsOn[i - 1].end)
      }
    }
  })

  it('guarantee 2: no step starts before all of its dependencies have ended', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const dishes = makeDishes(rng)
      const timeline = scheduleMeal({ dishes })
      const byKey = new Map(timeline.placements.map((p) => [`${p.dish_id}:${p.step_index}`, p]))
      for (const dish of dishes) {
        dish.steps.forEach((s, i) => {
          const validDeps = s.depends_on.filter((d) => d >= 0 && d < i)
          const self = byKey.get(`${dish.dish_id}:${i}`)!
          for (const d of validDeps) {
            const dep = byKey.get(`${dish.dish_id}:${d}`)!
            expect(self.start).toBeGreaterThanOrEqual(dep.end)
          }
        })
      }
    }
  })

  it('guarantee 3: no two steps sharing an exclusive tag ever overlap', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const dishes = makeDishes(rng)
      const timeline = scheduleMeal({ dishes })
      const tagPlacements = new Map<string, typeof timeline.placements>()
      for (const dish of dishes) {
        dish.steps.forEach((s, i) => {
          const p = timeline.placements.find((pl) => pl.dish_id === dish.dish_id && pl.step_index === i)!
          for (const tag of s.exclusive) {
            const arr = tagPlacements.get(tag) ?? []
            arr.push(p)
            tagPlacements.set(tag, arr)
          }
        })
      }
      for (const arr of tagPlacements.values()) {
        arr.sort((a, b) => a.start - b.start)
        for (let i = 1; i < arr.length; i++) {
          expect(arr[i].start).toBeGreaterThanOrEqual(arr[i - 1].end)
        }
      }
    }
  })

  it('guarantee 4: finish_spread_minutes always matches the actual spread, and warns iff it exceeds the window', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const dishes = makeDishes(rng)
      const timeline = scheduleMeal({ dishes })
      const ends = dishes
        .filter((d) => d.steps.length > 0)
        .map((d) =>
          Math.max(...timeline.placements.filter((p) => p.dish_id === d.dish_id).map((p) => p.end)),
        )
      const actualSpread = ends.length > 0 ? Math.max(...ends) - Math.min(...ends) : 0
      expect(timeline.finish_spread_minutes).toBe(actualSpread)
      expect(timeline.warnings.includes('finish_spread')).toBe(actualSpread > 2)
    }
  })

  it('guarantee 5: identical input gives byte-identical output', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const dishes = makeDishes(rng)
      const a = scheduleMeal({ dishes })
      const b = scheduleMeal({ dishes: JSON.parse(JSON.stringify(dishes)) })
      expect(b).toEqual(a)
    }
  })

  it('guarantee 6: the plan is never longer than cooking the dishes one after another', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const dishes = makeDishes(rng)
      const timeline = scheduleMeal({ dishes })
      const sequentialTotal = dishes.reduce(
        (acc, d) => acc + scheduleMeal({ dishes: [d] }).total_minutes,
        0,
      )
      expect(timeline.total_minutes).toBeLessThanOrEqual(sequentialTotal)
    }
  })

  it('guarantee 7: with progress, fixed placements are unchanged and nothing new is placed before now_minutes', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const dishes = makeDishes(rng)
      const fresh = scheduleMeal({ dishes })
      if (fresh.placements.length === 0) continue

      // Mark roughly the first third of steps (by start time) as resolved,
      // and pick `now_minutes` as the latest of their fixed ends.
      const sorted = [...fresh.placements].sort((a, b) => a.start - b.start)
      const resolvedCount = Math.max(1, Math.floor(sorted.length / 3))
      const resolved = sorted.slice(0, resolvedCount)

      const progress: MealProgress = { now_minutes: 0, steps: {} }
      let nowMinutes = 0
      for (const p of resolved) {
        const status = rng() < 0.5 ? 'done' : 'skipped'
        progress.steps[`${p.dish_id}:${p.step_index}`] = {
          status,
          started_at_minutes: p.start,
          extra_minutes: 0,
        }
        nowMinutes = Math.max(nowMinutes, p.end)
      }
      progress.now_minutes = nowMinutes

      const replanned = scheduleMeal({ dishes, progress })

      // Fixed placements are unchanged.
      for (const p of resolved) {
        const match = replanned.placements.find(
          (pl) => pl.dish_id === p.dish_id && pl.step_index === p.step_index,
        )!
        expect(match.start).toBe(p.start)
        expect(match.end).toBe(p.end)
      }

      // Nothing *new* (i.e. not already fixed by progress) starts before
      // now_minutes — fixed/past placements are expected to predate it.
      const resolvedKeys = new Set(resolved.map((p) => `${p.dish_id}:${p.step_index}`))
      for (const p of replanned.placements) {
        if (resolvedKeys.has(`${p.dish_id}:${p.step_index}`)) continue
        expect(p.start).toBeGreaterThanOrEqual(nowMinutes)
      }
    }
  })
})
