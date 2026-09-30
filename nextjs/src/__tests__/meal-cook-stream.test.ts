/**
 * Issue #653 — `lib/meal-cook-stream.ts`: `deriveStream` (section 3's rules)
 * and the pure per-action recorders (section 4). Pure unit tests, no clock,
 * no storage — every `now_minutes` is passed in explicitly.
 */

import {
  deriveStream,
  buildStreamSteps,
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
  isMealCookFinished,
  type StreamStep,
} from '@/lib/meal-cook-stream'
import { scheduleMeal, type SchedulerDish } from '@/lib/meal-scheduler'
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
    dish_step_signatures: ['1:x', '1:x'],
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

  it('issue #653 review round 1 (B1) — hands-off never waits behind hands-on: a due pending hands-off step wins the Now card over a running hands-on step', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Sear', label: 'Sear', duration_minutes: 20, hands_on: true })],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Boil water', label: 'Boil water', duration_minutes: 5, hands_on: false })],
    }
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })

    // now_minutes comfortably past any plausible live-plan start for side's
    // one hands-off step, so it's unambiguously "due" regardless of exactly
    // where the scheduler places it.
    const result = deriveStream({ dishes: [main, side], exclusive_tags: [], session: s, now_minutes: 100 })

    expect(result.now.kind).toBe('active')
    if (result.now.kind === 'active') {
      expect(result.now.step.key).toBe('side:0')
      expect(result.now.step.hands_on).toBe(false)
    }
  })

  it('issue #653 review round 1 (B2) — waiting: nothing pending or hands-on running, but a hands-off step is still ticking in the dock', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Simmer', label: 'Simmer', duration_minutes: 10, hands_on: false })],
    }
    const s = session({
      dish_ids: ['main'],
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })

    const result = deriveStream({ dishes: [main], exclusive_tags: [], session: s, now_minutes: 3 })

    expect(result.now.kind).toBe('waiting')
    if (result.now.kind === 'waiting') {
      expect(result.now.running.map((r) => r.key)).toEqual(['main:0'])
    }
    expect(result.next_up).toBeNull()
    expect(result.running.map((r) => r.key)).toEqual(['main:0'])
  })
})

// ---------------------------------------------------------------------------
// isMealCookFinished (issue #654 §3, S9)
// ---------------------------------------------------------------------------

describe("isMealCookFinished agrees with deriveStream's finished", () => {
  it('true when every step across every dish is done or skipped', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Plate', label: 'Plate', duration_minutes: 2, hands_on: true })],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Toss', label: 'Toss', duration_minutes: 1, hands_on: true })],
    }
    const s = session({
      dish_ids: ['main', 'side'],
      steps: {
        'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
        'side:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 },
      },
    })

    expect(isMealCookFinished(s, [main, side])).toBe(true)
    const result = deriveStream({ dishes: [main, side], exclusive_tags: [], session: s, now_minutes: 5 })
    expect(result.now).toEqual({ kind: 'finished' })
  })

  it('false while any step is still pending or running, agreeing with deriveStream', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Plate', label: 'Plate', duration_minutes: 2, hands_on: true })],
    }
    const s = session({ dish_ids: ['main'], steps: {} })

    expect(isMealCookFinished(s, [main])).toBe(false)
    const result = deriveStream({ dishes: [main], exclusive_tags: [], session: s, now_minutes: 0 })
    expect(result.now).not.toEqual({ kind: 'finished' })
  })

  it('false when there are zero steps overall — a meal with nothing to cook is not "finished"', () => {
    const empty: SchedulerDish = { dish_id: 'main', column: 'main', title: 'Main', steps: [] }
    const s = session({ dish_ids: ['main'], steps: {} })
    expect(isMealCookFinished(s, [empty])).toBe(false)
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
      8 * 60_000, // now, 8 minutes after started_at_ms (0)
    )
    // elapsed = 8; end = ceil(8 + 300/60) = 13; extra = 13 - 0 - 10 = 3
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
      8 * 60_000,
    )
    // elapsed = 8; end = ceil(8 + 120/60) = 10; extra = 10 - 0 - 10 = 0
    expect(updated.steps['main:0'].extra_minutes).toBe(0)
  })

  it('leaves a step alone once its linked timer has completed — that is recordDone\'s job', () => {
    const s = session({
      dish_ids: ['main'],
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    const updated = applyTimerState(
      s,
      [{ id: 't1', status: 'completed', remainingSeconds: 0 }],
      [main],
      20 * 60_000,
    )
    expect(updated).toBe(s)
  })

  it('leaves a step with no linked timer alone', () => {
    const s = session({
      dish_ids: ['main'],
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = applyTimerState(s, [], [main], 20 * 60_000)
    expect(updated).toBe(s)
  })

  it('issue #653 review round 1 (S2) — the computed end is stable across 15s ticks, unlike the old double-floored minute math', () => {
    const s = session({
      meal_id: 'meal-1',
      started_at_ms: 1_000_000, // an arbitrary non-zero wall-clock start
      dish_ids: ['main'],
      steps: {
        'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
    })
    const timer = [{ id: 't1', status: 'running' as const, remainingSeconds: 400 }]

    // Six consecutive 15s ticks, all landing inside the same wall-clock
    // minute except for crossing exactly one boundary partway through — the
    // extra_minutes the timer settles on should only ever move forward
    // (never oscillate down) as real elapsed time increases, in contrast to
    // the old `nowMinutes + ceil(remainingSeconds/60)` formula, which could
    // independently floor "now" and ceil the remainder and disagree tick to
    // tick even though nothing about the timer itself changed.
    const extras: number[] = []
    for (let tick = 0; tick < 6; tick++) {
      const nowMs = s.started_at_ms + tick * 15_000
      extras.push(applyTimerState(s, timer, [main], nowMs).steps['main:0'].extra_minutes)
    }
    for (let i = 1; i < extras.length; i++) {
      expect(extras[i]).toBeGreaterThanOrEqual(extras[i - 1])
    }
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
    expect(updated.steps['main:0']).toEqual({
      status: 'done',
      started_at_minutes: 0,
      extra_minutes: 0,
      ended_at_minutes: 5,
    })
  })

  it('a late Done sets extra_minutes so the recorded end equals now', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = recordDone(s, streamStep({ key: 'main:0', duration_minutes: 5 }), 9)
    expect(updated.steps['main:0']).toEqual({
      status: 'done',
      started_at_minutes: 0,
      extra_minutes: 4,
      ended_at_minutes: 9,
    })
  })

  it('an early Done leaves extra_minutes alone — the scheduler itself caps the recorded end', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
    })
    const updated = recordDone(s, streamStep({ key: 'main:0', duration_minutes: 10 }), 3)
    expect(updated.steps['main:0']).toEqual({
      status: 'done',
      started_at_minutes: 0,
      extra_minutes: 0,
      ended_at_minutes: 3,
    })
  })

  it('falls back to the step\'s own start when there is no existing record', () => {
    const s = session()
    const updated = recordDone(s, streamStep({ key: 'main:0', start: 2, duration_minutes: 3 }), 4)
    expect(updated.steps['main:0']).toEqual({
      status: 'done',
      started_at_minutes: 2,
      extra_minutes: 0,
      ended_at_minutes: 4,
    })
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

  it('issue #653 review round 1 (S1) — a done step\'s recorded lateness never shrinks on a later derive, unlike the old min(nominalEnd, now) recompute', () => {
    const dish: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [
        step({ text: 'Sear', label: 'Sear', duration_minutes: 5, hands_on: true }),
        step({ text: 'Rest', label: 'Rest', duration_minutes: 3, hands_on: true, depends_on: [0] }),
      ],
    }
    // Sear (duration 5) started at 0, marked done late at 9 — 4 minutes late,
    // via `recordDone` itself, so this test exercises the exact record shape
    // it produces rather than reconstructing one by hand.
    const doneRecord = recordDone(
      session({ dish_ids: ['main'] }),
      streamStep({ key: 'main:0', start: 0, duration_minutes: 5 }),
      9,
    ).steps['main:0']
    const s = session({ dish_ids: ['main'], steps: { 'main:0': doneRecord } })
    // Sear's own placement is read off the live plan at increasingly later
    // `now_minutes`, simulating the page re-deriving on every clock tick long
    // after Sear actually finished. A *pending* dependent's start legitimately
    // still floors at `now_minutes` (it can't have started before "now" if it
    // hasn't been tapped) — S1's promise is specifically about the done
    // step's own recorded end never drifting, which this checks directly.
    const searEndAt = (nowMinutes: number) => {
      const result = deriveStream({ dishes: [dish], exclusive_tags: [], session: s, now_minutes: nowMinutes })
      return result.timeline.placements.find((p) => p.dish_id === 'main' && p.step_index === 0)!.end
    }
    const at10 = searEndAt(10)
    const at60 = searEndAt(60)
    const at600 = searEndAt(600)
    // Fixed at 9 (the tap moment) forever after — never climbs toward a later
    // `now_minutes` (the exact drift the pre-S1 `min(nominalEnd, now)`
    // recompute produced: a step already finished in the past kept looking
    // like it was still "catching up" to its nominal end on every later
    // derive), and never shrinks back below it either.
    expect(at10).toBe(9)
    expect(at60).toBe(9)
    expect(at600).toBe(9)
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
  it('marks a never-started step skipped at now, with no extra_minutes', () => {
    const s = session()
    const updated = recordSkip(s, streamStep({ key: 'main:0' }), 6)
    expect(updated.steps['main:0']).toEqual({
      status: 'skipped',
      started_at_minutes: 6,
      extra_minutes: 0,
      ended_at_minutes: 6,
    })
  })

  it('issue #653 review round 1 (S1) — skipping a step already running preserves its real started_at_minutes, not the skip moment', () => {
    const s = session({
      steps: { 'main:0': { status: 'running', started_at_minutes: 2, extra_minutes: 3 } },
    })
    const updated = recordSkip(s, streamStep({ key: 'main:0' }), 6)
    expect(updated.steps['main:0']).toEqual({
      status: 'skipped',
      started_at_minutes: 2, // preserved from the running record, not 6
      extra_minutes: 0,
      ended_at_minutes: 6,
    })
  })

  it('falls back to now when skipping a pending step with no existing record', () => {
    const s = session()
    const updated = recordSkip(s, streamStep({ key: 'main:1' }), 6)
    expect(updated.steps['main:1'].started_at_minutes).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// waiting_on uses sanitized deps (issue #653 review round 1, nit)
// ---------------------------------------------------------------------------

describe('deriveStream — waiting_on for a degraded dish', () => {
  it('shows the real "after X" reason for a dish whose depends_on fell back to sequential', () => {
    // step 1's depends_on references a non-existent index — sanitizeDish
    // drops it and falls back to a strict sequential chain, same as the
    // "degraded (sequential-fallback) dish" test above. Without sanitizing
    // `waiting_on`'s own lookup the same way, an upcoming card here would
    // report no wait reason at all, even though the live plan is genuinely
    // holding step 1 behind step 0.
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Degraded',
      steps: [
        step({ text: 'Chop', label: 'Chop', duration_minutes: 10, hands_on: false }),
        step({ text: 'Cook', label: 'Cook', duration_minutes: 3, hands_on: true, depends_on: [99] }),
      ],
    }

    const result = deriveStream({
      dishes: [main],
      exclusive_tags: [],
      session: session({
        dish_ids: ['main'],
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
      }),
      now_minutes: 2,
    })

    expect(result.now.kind).toBe('upcoming')
    if (result.now.kind === 'upcoming') {
      expect(result.now.step.key).toBe('main:1')
      expect(result.now.waiting_on?.key).toBe('main:0')
    }
  })
})

// ---------------------------------------------------------------------------
// On-schedule simulation (issue #653 review round 1, B1/B2) — ported from
// the reviewer's scratchpad `sim.test.ts`, with a fixed seed so it's
// deterministic. `perfectCook` plays a cook straight through a randomly
// generated meal, tapping/starting every step at exactly the moment
// `deriveStream` surfaces it and marking it done the instant it's nominally
// over — the "perfect, always-on-time cook" case the B1 fix is meant to keep
// on schedule for.
// ---------------------------------------------------------------------------

function simStep(o: {
  text: string
  label: string
  duration_minutes: number
  hands_on: boolean
  depends_on?: number[]
}): Step {
  return { ongoing_label: null, duration_estimated: false, exclusive: [], depends_on: [], ...o }
}

function perfectCook(dishes: SchedulerDish[]): {
  finishedAt: number
  finishedWhileRunning: boolean
  hiddenDue: number
  realEnd: number
} {
  let s: MealCookSession = {
    meal_id: 'm',
    started_at_ms: 0,
    dish_ids: dishes.map((d) => d.dish_id),
    dish_step_signatures: dishes.map((d) => `${d.steps.length}`),
    steps: {},
    ingredient_amendments: {},
  }
  const dur = new Map<string, number>()
  dishes.forEach((d) => d.steps.forEach((x, i) => dur.set(`${d.dish_id}:${i}`, x.duration_minutes)))
  let finishedAt = -1
  let finishedWhileRunning = false
  let hiddenDue = 0
  for (let t = 0; t < 300; t++) {
    for (let guard = 0; guard < 20; guard++) {
      let changed = false
      const r = deriveStream({ dishes, exclusive_tags: [], session: s, now_minutes: t })
      const all = new Map(buildStreamSteps(dishes, r.timeline).map((x) => [x.key, x]))
      for (const [k, rec] of Object.entries(s.steps)) {
        const d = dur.get(k)
        if (d !== undefined && rec.status === 'running' && rec.started_at_minutes + d + rec.extra_minutes <= t) {
          s = recordDone(s, all.get(k)!, t)
          changed = true
        }
      }
      if (changed) continue
      if (r.now.kind === 'finished') {
        if (finishedAt < 0) {
          finishedAt = t
          finishedWhileRunning = Object.values(s.steps).some((x) => x.status === 'running')
        }
        break
      }
      if (r.now.kind === 'active') {
        const step = r.now.step
        if (step.hands_on && !s.steps[step.key]) {
          s = recordBecomingActive(s, step, t)
          changed = true
        } else if (!step.hands_on && !s.steps[step.key]) {
          s = recordStartTimer(s, step, t, `tm-${step.key}`)
          changed = true
        }
        // A due hands-off step hiding behind a running hands-on Now card —
        // the exact bug B1 fixes. Should never fire once fixed.
        if (s.steps[step.key]?.status === 'running' && step.hands_on) {
          for (const x of all.values()) {
            if (!x.hands_on && !s.steps[x.key] && x.start <= t) {
              hiddenDue++
              break
            }
          }
        }
      }
      if (!changed) break
    }
    if (finishedAt >= 0 && !Object.values(s.steps).some((x) => x.status === 'running')) {
      return { finishedAt, finishedWhileRunning, hiddenDue, realEnd: t }
    }
  }
  return { finishedAt, finishedWhileRunning, hiddenDue, realEnd: -1 }
}

describe('deriveStream — on-schedule simulation (issue #653 review round 1)', () => {
  it('a perfect, always-on-time cook finishes exactly at the baseline total, across many random meals', () => {
    let rng = 999 // fixed seed — same generator the reviewer's probe used
    const rand = () => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff
      return rng / 0x7fffffff
    }
    const columns = ['main', 'side_1', 'side_2'] as const

    for (let trial = 0; trial < 400; trial++) {
      const dishCount = 2 + Math.floor(rand() * 2)
      const dishes: SchedulerDish[] = columns.slice(0, dishCount).map((col, di) => {
        const k = 1 + Math.floor(rand() * 4)
        return {
          dish_id: `d${di}`,
          column: col,
          title: col,
          steps: Array.from({ length: k }, (_, i) =>
            simStep({
              text: `s${i}`,
              label: `s${i}`,
              duration_minutes: 1 + Math.floor(rand() * 12),
              hands_on: rand() < 0.6,
              depends_on: i > 0 && rand() < 0.7 ? [i - 1] : [],
            }),
          ),
        }
      })

      const base = scheduleMeal({ dishes })
      const r = perfectCook(dishes)

      expect(r.finishedWhileRunning).toBe(false) // B2
      expect(r.hiddenDue).toBe(0) // B1
      expect(r.realEnd).toBe(base.total_minutes) // the on-schedule invariant
    }
  })
})

describe('deriveStream — a Skip stays put as the clock runs (PR #661 review)', () => {
  // Main: Sear (10, hands-on) -> Rest (3, hands-on, after Sear). Side: Chill
  // (1, hands-off), which the baseline lands at the common finish. The cook
  // starts Sear late at 2 and skips it at 3. The skip's end must stay fixed
  // at 3, so lateness stays 0 and Chill keeps its baseline start. Before the
  // fix the end was re-derived as min(nominal end 12, now) on every tick, so
  // lateness grew with the clock and pushed Chill later while nothing happened.
  const dishes: SchedulerDish[] = [
    {
      dish_id: 'main',
      column: 'main',
      title: 'Steak',
      steps: [
        step({ text: 'Sear the steak', label: 'Sear', duration_minutes: 10, hands_on: true, depends_on: [] }),
        step({ text: 'Rest the steak', label: 'Rest', duration_minutes: 3, hands_on: true, depends_on: [0] }),
      ],
    },
    {
      dish_id: 'side',
      column: 'side_1',
      title: 'Salad',
      steps: [
        step({ text: 'Chill the salad', label: 'Chill', ongoing_label: 'the salad chills', duration_minutes: 1, hands_on: false, depends_on: [] }),
      ],
    },
  ]
  const baselineChill = scheduleMeal({ dishes }).placements.find((p) => p.dish_id === 'side')!.start

  it.each([4, 8, 11])('Chill keeps its baseline start at now=%i', (now) => {
    const skipped = recordSkip(
      session({ steps: { 'main:0': { status: 'running', started_at_minutes: 2, extra_minutes: 0 } } }),
      { key: 'main:0' } as Parameters<typeof recordSkip>[1],
      3,
    )
    const stream = deriveStream({ dishes, exclusive_tags: [], session: skipped, now_minutes: now })
    const chill = stream.timeline.placements.find((p) => p.dish_id === 'side')!
    expect(chill.start).toBe(Math.max(baselineChill, now))
  })
})
