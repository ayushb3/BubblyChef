/**
 * Issue #849 — after "Start now" on a step, every step downstream of it is
 * re-planned from the ACTUAL start, not the planned one. Reproduces the
 * reported "simmer ends 11:19, next says 11:25": the cook-along holds pending
 * steps to the baseline plan so dishes land together, but that floor also held
 * the dependent of an early-started step at its planned time, minutes after the
 * step it waits on had finished.
 */

import {
  deriveStream,
  buildStreamSteps,
  recordStartTimer,
  recordStartEarly,
  recordExtend,
} from '@/lib/meal-cook-stream'
import { scheduleMeal, type SchedulerDish } from '@/lib/meal-scheduler'
import type { MealCookSession } from '@/lib/meal-cook-session'
import type { Step } from '@/types/recipes'

function step(
  overrides: Partial<Step> & { text: string; label: string; duration_minutes: number; hands_on: boolean },
): Step {
  return { ongoing_label: null, duration_estimated: false, depends_on: [], exclusive: [], ...overrides }
}

function session(overrides: Partial<MealCookSession> = {}): MealCookSession {
  return {
    meal_id: 'meal-1',
    started_at_ms: 0,
    dish_ids: ['main'],
    dish_step_signatures: ['1:x'],
    steps: {},
    ingredient_amendments: {},
    ...overrides,
  }
}

// One dish: Chop (5, hands-on) -> Saute (5, hands-on) -> Simmer (9, hands-off)
// -> Serve (3, hands-on). Baseline: simmer planned [10, 19], Serve at 19.
const STEW: SchedulerDish = {
  dish_id: 'main',
  column: 'main',
  title: 'Stew',
  steps: [
    step({ text: 'Chop', label: 'Chop', duration_minutes: 5, hands_on: true }),
    step({ text: 'Saute', label: 'Saute', duration_minutes: 5, hands_on: true, depends_on: [0] }),
    step({ text: 'Simmer', label: 'Simmer', duration_minutes: 9, hands_on: false, depends_on: [1] }),
    step({ text: 'Serve', label: 'Serve', duration_minutes: 3, hands_on: true, depends_on: [2] }),
  ],
}

// The cook finishes Chop at 3 and Saute at 6, both early.
const DONE_EARLY: MealCookSession['steps'] = {
  'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 3 },
  'main:1': { status: 'done', started_at_minutes: 3, extra_minutes: 0, ended_at_minutes: 6 },
}

function simmerStep(dishes: SchedulerDish[]) {
  return buildStreamSteps(dishes, scheduleMeal({ dishes })).find((s) => s.key === 'main:2')!
}

function nextCardStart(dishes: SchedulerDish[], steps: MealCookSession['steps'], now: number) {
  const stream = deriveStream({
    dishes,
    exclusive_tags: [],
    session: session({ steps }),
    now_minutes: now,
  })
  expect(stream.now.kind).toBe('upcoming')
  if (stream.now.kind !== 'upcoming') throw new Error('unreachable')
  return { stream, card: stream.now }
}

describe('deriveStream - ETA after Start now (issue #849)', () => {
  it('the next step starts when the early-started simmer ends, not at the planned time', () => {
    const started = recordStartTimer(session({ steps: DONE_EARLY }), simmerStep([STEW]), 6, 'timer-1')
    const { stream, card } = nextCardStart([STEW], started.steps, 6)

    const simmer = stream.timeline.placements.find((p) => p.step_index === 2)!
    expect(simmer.end).toBe(15)
    expect(card.step.key).toBe('main:3')
    expect(card.step.start).toBe(simmer.end) // was 19, the planned time
    expect(card.starts_in_minutes).toBe(9)
  })

  it('a simmer started on the plan keeps the planned next-step time', () => {
    const started = recordStartTimer(session({ steps: DONE_EARLY }), simmerStep([STEW]), 10, 'timer-1')
    const { card } = nextCardStart([STEW], started.steps, 10)
    expect(card.step.start).toBe(19)
  })

  it('a +2 min on the early simmer still pushes the next step by 2', () => {
    const started = recordStartTimer(session({ steps: DONE_EARLY }), simmerStep([STEW]), 6, 'timer-1')
    const extended = recordExtend(started, 'main:2')
    const { card } = nextCardStart([STEW], extended.steps, 7)
    expect(card.step.start).toBe(17)
  })

  it('works for a hands-on step started early, via recordStartEarly', () => {
    const dish: SchedulerDish = {
      ...STEW,
      steps: [
        step({ text: 'Chop', label: 'Chop', duration_minutes: 5, hands_on: true }),
        step({ text: 'Rest', label: 'Rest', duration_minutes: 9, hands_on: false, depends_on: [0] }),
        step({ text: 'Saute', label: 'Saute', duration_minutes: 4, hands_on: true, depends_on: [1] }),
        step({ text: 'Serve', label: 'Serve', duration_minutes: 3, hands_on: true, depends_on: [2] }),
      ],
    }
    // Chop done early at 2, Rest started at 2 (baseline 5): Saute should follow at 11, not 14.
    const steps: MealCookSession['steps'] = {
      'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 2 },
      'main:1': { status: 'running', started_at_minutes: 2, extra_minutes: 0, timer_id: 't' },
    }
    const { card } = nextCardStart([dish], steps, 2)
    expect(card.step.key).toBe('main:2')
    expect(card.step.start).toBe(11)

    // And a hands-on early start pulls its own dependents forward the same way.
    const handsOn: SchedulerDish = {
      ...STEW,
      steps: [
        step({ text: 'Boil', label: 'Boil', duration_minutes: 10, hands_on: false }),
        step({ text: 'Drain', label: 'Drain', duration_minutes: 4, hands_on: true, depends_on: [0] }),
        step({ text: 'Toss', label: 'Toss', duration_minutes: 3, hands_on: true, depends_on: [1] }),
      ],
    }
    const early = recordStartEarly(
      session({ steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 1 } } }),
      buildStreamSteps([handsOn], scheduleMeal({ dishes: [handsOn] })).find((s) => s.key === 'main:1')!,
      1,
    )
    const after = deriveStream({ dishes: [handsOn], exclusive_tags: [], session: early, now_minutes: 1 })
    expect(after.timeline.placements.find((p) => p.step_index === 1)!.end).toBe(5)
    expect(after.timeline.placements.find((p) => p.step_index === 2)!.start).toBe(5) // was 14
  })

  it('does not pull another dish ahead of its plan', () => {
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Salad',
      steps: [step({ text: 'Chill', label: 'Chill', duration_minutes: 2, hands_on: false })],
    }
    const dishes = [STEW, side]
    const baselineSide = scheduleMeal({ dishes }).placements.find((p) => p.dish_id === 'side')!.start
    const started = recordStartTimer(
      session({ dish_ids: ['main', 'side'], steps: DONE_EARLY }),
      simmerStep(dishes),
      6,
      'timer-1',
    )
    const stream = deriveStream({ dishes, exclusive_tags: [], session: started, now_minutes: 6 })
    expect(stream.timeline.placements.find((p) => p.dish_id === 'side')!.start).toBe(Math.max(baselineSide, 6))
  })
})
