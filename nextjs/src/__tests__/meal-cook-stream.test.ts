/**
 * Issue #653 — `lib/meal-cook-stream.ts`: `deriveStream` (section 3's rules)
 * and the pure per-action recorders (section 4). Pure unit tests, no clock,
 * no storage — every `now_minutes` is passed in explicitly.
 */

import {
  deriveStream,
  recordBecomingActive,
  recordStartEarly,
  recordStartTimer,
  recordDone,
  recordExtend,
  recordSkip,
  applyOverdueRunningSteps,
  applyTimerState,
  findTimerCompletedSteps,
  timerIdsToDismiss,
  type StreamStep,
} from '@/lib/meal-cook-stream'
import type { SchedulerDish } from '@/lib/meal-scheduler'
import type { MealCookSession } from '@/lib/meal-cook-session'
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

function session(overrides: Partial<MealCookSession> = {}): MealCookSession {
  return {
    meal_id: 'meal-1',
    started_at_ms: 0,
    dish_ids: ['main', 'side'],
    steps: {},
    ingredient_amendments: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// deriveStream
// ---------------------------------------------------------------------------

describe('deriveStream', () => {
  it('an active hands-on step: a single dish, nothing started yet', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Sear', label: 'Sear', duration_minutes: 5, hands_on: true })],
    }

    const result = deriveStream({
      dishes: [main],
      exclusive_tags: [],
      session: session({ dish_ids: ['main'] }),
      now_minutes: 0,
    })

    expect(result.now.kind).toBe('active')
    if (result.now.kind === 'active') {
      expect(result.now.step.key).toBe('main:0')
      expect(result.now.step.hands_on).toBe(true)
    }
  })

  it('an upcoming card names the running step it is waiting on', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Simmer then serve',
      steps: [
        step({
          text: 'Simmer the sauce',
          label: 'Simmer',
          ongoing_label: 'it simmers',
          duration_minutes: 10,
          hands_on: false,
        }),
        step({ text: 'Serve', label: 'Serve', duration_minutes: 2, hands_on: true, depends_on: [0] }),
      ],
    }

    const result = deriveStream({
      dishes: [main],
      exclusive_tags: [],
      session: session({
        dish_ids: ['main'],
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
      }),
      now_minutes: 3,
    })

    expect(result.now.kind).toBe('upcoming')
    if (result.now.kind === 'upcoming') {
      expect(result.now.step.key).toBe('main:1')
      expect(result.now.starts_in_minutes).toBe(7) // start(10) - now(3)
      expect(result.now.waiting_on?.key).toBe('main:0')
      expect(result.now.waiting_on?.ongoing_label).toBe('it simmers')
    }
    // The running hands-off step shows up in `running`, for the dock strip.
    expect(result.running.map((s) => s.key)).toEqual(['main:0'])
  })

  it('at most one active step, even with a second dish ready to go', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Knead', label: 'Knead', duration_minutes: 5, hands_on: true })],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Chop', label: 'Chop', duration_minutes: 3, hands_on: true })],
    }

    const result = deriveStream({
      dishes: [main, side],
      exclusive_tags: [],
      session: session({
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
      }),
      now_minutes: 2,
    })

    expect(result.now.kind).toBe('active')
    if (result.now.kind === 'active') {
      expect(result.now.step.key).toBe('main:0')
    }
    // The side step is real and pending, but never surfaced as a second
    // active card — it's `next_up` at most, per "at most one is ever current".
    expect(result.next_up?.key).toBe('side:0')
  })

  it('next_up crosses from one dish to another', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Roast', label: 'Roast', duration_minutes: 4, hands_on: false })],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Warm rolls', label: 'Warm rolls', duration_minutes: 2, hands_on: false })],
    }

    const result = deriveStream({
      dishes: [main, side],
      exclusive_tags: [],
      session: session(),
      now_minutes: 0,
    })

    expect(result.now.kind).toBe('active')
    if (result.now.kind === 'active') {
      expect(result.now.step.dish_id).toBe('main')
    }
    // Both hands-off, no shared resource — ALAP aligns their finishes, so the
    // shorter (side) starts later than main, landing it after main in the
    // live-plan order.
    expect(result.next_up?.dish_id).toBe('side')
  })

  it('finished when every step is done or skipped', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Plate', label: 'Plate', duration_minutes: 2, hands_on: true })],
    }

    const result = deriveStream({
      dishes: [main],
      exclusive_tags: [],
      session: session({
        dish_ids: ['main'],
        steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      }),
      now_minutes: 2,
    })

    expect(result.now).toEqual({ kind: 'finished' })
    expect(result.next_up).toBeNull()
    expect(result.running).toEqual([])
  })

  it('a degraded (sequential-fallback) dish still flows through the stream in order', () => {
    // step 2's depends_on references a non-existent index — sanitizeDish
    // drops it and falls back to a strict sequential chain for the whole
    // dish (meal-scheduler.ts's own degrade rule).
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Degraded',
      steps: [
        step({ text: 'Chop', label: 'Chop', duration_minutes: 3, hands_on: true }),
        step({ text: 'Cook', label: 'Cook', duration_minutes: 3, hands_on: true }),
        step({ text: 'Serve', label: 'Serve', duration_minutes: 3, hands_on: true, depends_on: [99] }),
      ],
    }

    const first = deriveStream({
      dishes: [main],
      exclusive_tags: [],
      session: session({ dish_ids: ['main'] }),
      now_minutes: 0,
    })
    expect(first.timeline.degraded).toBe(true)
    expect(first.now.kind).toBe('active')
    if (first.now.kind === 'active') expect(first.now.step.key).toBe('main:0')
    expect(first.next_up?.key).toBe('main:1')

    // Chop marked done at 3 (on time) — Cook comes up next, in order.
    const second = deriveStream({
      dishes: [main],
      exclusive_tags: [],
      session: session({
        dish_ids: ['main'],
        steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      }),
      now_minutes: 3,
    })
    expect(second.now.kind).toBe('active')
    if (second.now.kind === 'active') expect(second.now.step.key).toBe('main:1')
    expect(second.next_up?.key).toBe('main:2')
  })

  it('an overdue running step extends the live plan honestly, without mutating the input session', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Sear', label: 'Sear', duration_minutes: 5, hands_on: true })],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Chop', label: 'Chop', duration_minutes: 2, hands_on: true })],
    }
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })

    const result = deriveStream({ dishes: [main, side], exclusive_tags: [], session: s, now_minutes: 8 })

    expect(result.now.kind).toBe('active')
    if (result.now.kind === 'active') {
      expect(result.now.step.key).toBe('main:0')
      expect(result.now.step.end).toBe(8) // extended to now (nominal was 5)
    }
    // The cook resource stays occupied by the (ephemerally extended) running
    // step until 8, so the side can't start before then.
    const sidePlacement = result.timeline.placements.find((p) => p.dish_id === 'side')!
    expect(sidePlacement.start).toBeGreaterThanOrEqual(8)

    // Ephemeral only — the session passed in is untouched.
    expect(s.steps['main:0'].extra_minutes).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// applyOverdueRunningSteps
// ---------------------------------------------------------------------------

describe('applyOverdueRunningSteps', () => {
  const main: SchedulerDish = {
    dish_id: 'main',
    column: 'main',
    title: 'Main',
    steps: [step({ text: 'Sear', label: 'Sear', duration_minutes: 5, hands_on: true })],
  }

  it('bumps extra_minutes so a running step ends at now, once overdue', () => {
    const s = session({
      dish_ids: ['main'],
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = applyOverdueRunningSteps(s, [main], 8)
    expect(updated.steps['main:0'].extra_minutes).toBe(3) // 0 + 5 + 3 = 8
  })

  it('never shrinks an already-larger extra_minutes', () => {
    const s = session({
      dish_ids: ['main'],
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 10 } },
    })
    // Nominal end is 0+5+10=15, well past now(8) — not overdue relative to
    // its already-extended nominal end, so nothing changes.
    const updated = applyOverdueRunningSteps(s, [main], 8)
    expect(updated.steps['main:0'].extra_minutes).toBe(10)
    expect(updated).toBe(s) // unchanged — same reference
  })

  it('does not touch a done, skipped, or not-yet-started step', () => {
    const s = session({
      dish_ids: ['main'],
      steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = applyOverdueRunningSteps(s, [main], 100)
    expect(updated).toBe(s)
  })
})

// ---------------------------------------------------------------------------
// applyTimerState / findTimerCompletedSteps / timerIdsToDismiss
// ---------------------------------------------------------------------------

describe('applyTimerState', () => {
  const main: SchedulerDish = {
    dish_id: 'main',
    column: 'main',
    title: 'Main',
    steps: [step({ text: 'Simmer', label: 'Simmer', duration_minutes: 10, hands_on: false })],
  }

  it('sets extra_minutes so the step ends where the dock timer says it will', () => {
    const s = session({
      dish_ids: ['main'],
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    const updated = applyTimerState(
      s,
      [{ id: 't1', status: 'running', remainingSeconds: 300 }], // 5 min left
      [main],
      8, // now
    )
    // end = 8 + ceil(300/60) = 13; extra = 13 - 0 - 10 = 3
    expect(updated.steps['main:0'].extra_minutes).toBe(3)
  })

  it('reflects a paused dock timer the same way', () => {
    const s = session({
      dish_ids: ['main'],
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    const updated = applyTimerState(
      s,
      [{ id: 't1', status: 'paused', remainingSeconds: 120 }],
      [main],
      8,
    )
    // end = 8 + ceil(120/60) = 10; extra = 10 - 0 - 10 = 0
    expect(updated.steps['main:0'].extra_minutes).toBe(0)
  })

  it('leaves a step alone once its linked timer has completed — that is recordDone\'s job', () => {
    const s = session({
      dish_ids: ['main'],
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    const updated = applyTimerState(s, [{ id: 't1', status: 'completed', remainingSeconds: 0 }], [main], 20)
    expect(updated).toBe(s)
  })

  it('leaves a step with no linked timer alone', () => {
    const s = session({
      dish_ids: ['main'],
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = applyTimerState(s, [], [main], 20)
    expect(updated).toBe(s)
  })
})

describe('findTimerCompletedSteps', () => {
  it('finds a running step whose linked timer completed', () => {
    const s = session({
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    const keys = findTimerCompletedSteps(s, [{ id: 't1', status: 'completed' }])
    expect(keys).toEqual(['main:0'])
  })

  it('finds a running step whose linked timer is missing (dismissed)', () => {
    const s = session({
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    expect(findTimerCompletedSteps(s, [])).toEqual(['main:0'])
  })

  it('does not flag a step whose timer is still running or paused', () => {
    const s = session({
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    expect(findTimerCompletedSteps(s, [{ id: 't1', status: 'running' }])).toEqual([])
    expect(findTimerCompletedSteps(s, [{ id: 't1', status: 'paused' }])).toEqual([])
  })

  it('ignores a done/skipped step even with a stale timer_id', () => {
    const s = session({
      steps: {
        'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    expect(findTimerCompletedSteps(s, [])).toEqual([])
  })
})

describe('timerIdsToDismiss', () => {
  it('collects every running step\'s linked timer id', () => {
    const s = session({
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
        'side:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 }, // hands-on, no timer
        'main:1': { status: 'done', started_at_minutes: 0, extra_minutes: 0, timer_id: 't-old' },
      },
    })
    expect(timerIdsToDismiss(s)).toEqual(['t1'])
  })
})

// ---------------------------------------------------------------------------
// Per-action recorders
// ---------------------------------------------------------------------------

function streamStep(overrides: Partial<StreamStep> & { key: string }): StreamStep {
  return {
    dish_id: 'main',
    column: 'main',
    dish_title: 'Main',
    step_index: 0,
    label: 'Step',
    ongoing_label: null,
    text: 'Do the step',
    duration_minutes: 5,
    hands_on: true,
    start: 0,
    end: 5,
    ...overrides,
  }
}

describe('recordBecomingActive', () => {
  it('records a hands-on step running at max(planned start, now), floored to a whole minute', () => {
    const s = session()
    const updated = recordBecomingActive(s, streamStep({ key: 'main:0', start: 2 }), 5)
    expect(updated.steps['main:0']).toEqual({ status: 'running', started_at_minutes: 5, extra_minutes: 0 })
  })

  it('uses the planned start when it is later than now', () => {
    const s = session()
    const updated = recordBecomingActive(s, streamStep({ key: 'main:0', start: 5 }), 2)
    expect(updated.steps['main:0'].started_at_minutes).toBe(5)
  })

  it('is a no-op for a hands-off step', () => {
    const s = session()
    const updated = recordBecomingActive(s, streamStep({ key: 'main:0', hands_on: false }), 0)
    expect(updated).toBe(s)
  })

  it('is a no-op once already recorded', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 4 } },
    })
    const updated = recordBecomingActive(s, streamStep({ key: 'main:0' }), 10)
    expect(updated).toBe(s)
  })
})

describe('recordStartEarly', () => {
  it('records a hands-on step running at now, ignoring its later planned start', () => {
    const s = session()
    const updated = recordStartEarly(s, streamStep({ key: 'main:0', start: 20 }), 4)
    expect(updated.steps['main:0']).toEqual({ status: 'running', started_at_minutes: 4, extra_minutes: 0 })
  })

  it('is a no-op for a hands-off step (that goes through recordStartTimer)', () => {
    const s = session()
    const updated = recordStartEarly(s, streamStep({ key: 'main:0', hands_on: false, start: 20 }), 4)
    expect(updated).toBe(s)
  })
})

describe('recordStartTimer', () => {
  it('records a hands-off step running at now, linked to the given timer id', () => {
    const s = session()
    const updated = recordStartTimer(s, streamStep({ key: 'main:0', hands_on: false }), 3, 'timer-abc')
    expect(updated.steps['main:0']).toEqual({
      status: 'running',
      started_at_minutes: 3,
      extra_minutes: 0,
      timer_id: 'timer-abc',
    })
  })
})

describe('recordDone', () => {
  it('marks an on-time step done without touching extra_minutes', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = recordDone(s, streamStep({ key: 'main:0', duration_minutes: 5 }), 5)
    expect(updated.steps['main:0']).toEqual({ status: 'done', started_at_minutes: 0, extra_minutes: 0 })
  })

  it('a late Done sets extra_minutes so the recorded end equals now', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = recordDone(s, streamStep({ key: 'main:0', duration_minutes: 5 }), 9)
    expect(updated.steps['main:0']).toEqual({ status: 'done', started_at_minutes: 0, extra_minutes: 4 })
  })

  it('an early Done leaves extra_minutes alone — the scheduler itself caps the recorded end', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = recordDone(s, streamStep({ key: 'main:0', duration_minutes: 10 }), 3)
    expect(updated.steps['main:0']).toEqual({ status: 'done', started_at_minutes: 0, extra_minutes: 0 })
  })

  it('falls back to the step\'s own start when there is no existing record', () => {
    const s = session()
    const updated = recordDone(s, streamStep({ key: 'main:0', start: 2, duration_minutes: 3 }), 4)
    expect(updated.steps['main:0']).toEqual({ status: 'done', started_at_minutes: 2, extra_minutes: 0 })
  })

  it('drops a timer_id once the step is done', () => {
    const s = session({
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    const updated = recordDone(s, streamStep({ key: 'main:0', duration_minutes: 5 }), 5)
    expect(updated.steps['main:0'].timer_id).toBeUndefined()
  })
})

describe('recordExtend', () => {
  it('adds 2 minutes to a running step\'s extra_minutes', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 2 } },
    })
    const updated = recordExtend(s, 'main:0')
    expect(updated.steps['main:0'].extra_minutes).toBe(4)
  })

  it('is a no-op on a step that is not running', () => {
    const s = session({
      steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
    })
    expect(recordExtend(s, 'main:0')).toBe(s)
  })

  it('is a no-op on an unknown key', () => {
    const s = session()
    expect(recordExtend(s, 'main:0')).toBe(s)
  })
})

describe('recordSkip', () => {
  it('marks the step skipped at now, with no extra_minutes', () => {
    const s = session()
    const updated = recordSkip(s, streamStep({ key: 'main:0' }), 6)
    expect(updated.steps['main:0']).toEqual({ status: 'skipped', started_at_minutes: 6, extra_minutes: 0 })
  })
})
