/**
 * Issue #849 — which step Ask Bubbly reports. It used to read the Now card's
 * own step, so with the simmer (step 3) running and the card showing step 4 as
 * "Next at ...", the overlay said "step 4". It reports the step the cook is
 * actually on: the running step an upcoming card is waiting on, else the card's.
 */

import { askBubblesStep, deriveStream, type StreamStep } from '@/lib/meal-cook-stream'
import type { SchedulerDish } from '@/lib/meal-scheduler'
import type { MealCookSession } from '@/lib/meal-cook-session'
import type { Step } from '@/types/recipes'

function step(
  overrides: Partial<Step> & { text: string; label: string; duration_minutes: number; hands_on: boolean },
): Step {
  return { ongoing_label: null, duration_estimated: false, depends_on: [], exclusive: [], ...overrides }
}

function session(steps: MealCookSession['steps']): MealCookSession {
  return {
    meal_id: 'meal-1',
    started_at_ms: 0,
    dish_ids: ['main'],
    dish_step_signatures: ['1:x'],
    steps,
    ingredient_amendments: {},
  }
}

const DISH: SchedulerDish = {
  dish_id: 'main',
  column: 'main',
  title: 'Stew',
  steps: [
    step({ text: 'Chop the onion', label: 'Chop', duration_minutes: 5, hands_on: true }),
    step({ text: 'Brown the meat', label: 'Brown', duration_minutes: 5, hands_on: true, depends_on: [0] }),
    step({ text: 'Simmer the stew', label: 'Simmer', duration_minutes: 20, hands_on: false, depends_on: [1] }),
    step({ text: 'Serve it', label: 'Serve', duration_minutes: 2, hands_on: true, depends_on: [2] }),
  ],
}

const DONE: MealCookSession['steps'] = {
  'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 5 },
  'main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0, ended_at_minutes: 10 },
}

describe('askBubblesStep (issue #849)', () => {
  it('while the simmer (step 3) runs and the card shows step 4, it reports step 3', () => {
    const stream = deriveStream({
      dishes: [DISH],
      exclusive_tags: [],
      session: session({ ...DONE, 'main:2': { status: 'running', started_at_minutes: 10, extra_minutes: 0, timer_id: 't' } }),
      now_minutes: 12,
    })
    expect(stream.now.kind).toBe('upcoming')
    if (stream.now.kind === 'upcoming') expect(stream.now.step.step_index).toBe(3)
    expect(askBubblesStep(stream.now)?.step_index).toBe(2)
  })

  it('an active card reports its own step', () => {
    const stream = deriveStream({ dishes: [DISH], exclusive_tags: [], session: session({}), now_minutes: 0 })
    expect(stream.now.kind).toBe('active')
    expect(askBubblesStep(stream.now)?.step_index).toBe(0)
  })

  it('an upcoming card with nothing running reports its own step', () => {
    const stream = deriveStream({ dishes: [DISH], exclusive_tags: [], session: session(DONE), now_minutes: 8 })
    expect(stream.now.kind).toBe('upcoming')
    if (stream.now.kind === 'upcoming') expect(stream.now.waiting_on).toBeUndefined()
    expect(askBubblesStep(stream.now)?.step_index).toBe(2)
  })

  it('a waiting or finished card has no step to ask about', () => {
    const s = { key: 'main:2' } as StreamStep
    expect(askBubblesStep({ kind: 'waiting', running: [s] })).toBeNull()
    expect(askBubblesStep({ kind: 'finished' })).toBeNull()
  })
})
