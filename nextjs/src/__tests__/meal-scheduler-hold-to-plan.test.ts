/**
 * Issue #653 — `progress.hold_to_plan`: a re-plan's still-pending steps must
 * land no earlier than the baseline (ALAP-from-a-common-finish) plan had
 * them, so a cook-along tap doesn't pull an untouched side forward to finish
 * early and go cold. See `lib/meal-scheduler.ts`'s `scheduleWithProgress` doc
 * comment for the `baseline_start + lateness` mechanics this exercises.
 *
 * Fixture used throughout: a main with two sequential hands-on steps (Chop 6
 * min, then Cook 4 min — 10 min total, using the shared cook resource) and an
 * unconstrained hands-off side step (Marinate, 3 min, no deps). Baseline ALAP
 * has nothing forcing the side to run early, so it's pushed as late as
 * possible while still finishing by the meal's total (10 min) — it lands at
 * [7, 10]. An ASAP ignore-the-baseline re-plan, by contrast, would let it
 * start the instant the cook resource is free to it (immediately, since it
 * never touches the cook resource at all) — exactly the "pulled forward,
 * finishes early, goes cold" bug this flag exists to prevent.
 */

import { scheduleMeal, SchedulerDish } from '@/lib/meal-scheduler'
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

const MAIN: SchedulerDish = {
  dish_id: 'main',
  column: 'main',
  title: 'Chop then cook',
  steps: [
    step({ text: 'Chop', label: 'Chop', duration_minutes: 6, hands_on: true }),
    step({ text: 'Cook', label: 'Cook', duration_minutes: 4, hands_on: true, depends_on: [0] }),
  ],
}
const SIDE: SchedulerDish = {
  dish_id: 'side',
  column: 'side_1',
  title: 'Marinate',
  steps: [step({ text: 'Marinate', label: 'Marinate', duration_minutes: 3, hands_on: false })],
}

function sideStartDoneEarly(nowMinutes: number): number {
  const timeline = scheduleMeal({
    dishes: [MAIN, SIDE],
    progress: {
      now_minutes: nowMinutes,
      hold_to_plan: true,
      steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
    },
  })
  return timeline.placements.find((p) => p.dish_id === 'side')!.start
}

/**
 * `running`, not `done` — a running step's fixed end is its unconditional
 * `start + duration + extra` (not capped at `now`), so this is the shape
 * that actually lets `extra_minutes` drive `lateness` independently of how
 * early `now_minutes` is. A `done` tap this early would instead have its
 * end capped at `now` regardless of `extra_minutes` (see the "done early"
 * helper above) — which is correct scheduler behaviour, but not useful for
 * isolating the "+2 shifts everything by 2" property on its own.
 */
function sideStartRunning(extraMinutes: number, nowMinutes: number): number {
  const timeline = scheduleMeal({
    dishes: [MAIN, SIDE],
    progress: {
      now_minutes: nowMinutes,
      hold_to_plan: true,
      steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: extraMinutes } },
    },
  })
  return timeline.placements.find((p) => p.dish_id === 'side')!.start
}

describe('scheduleMeal — hold_to_plan (issue #653)', () => {
  it('the baseline plan pushes the unconstrained side late, to finish alongside main', () => {
    // Sanity check on the fixture's own baseline math (no progress at all).
    const baseline = scheduleMeal({ dishes: [MAIN, SIDE] })
    const side = baseline.placements.find((p) => p.dish_id === 'side')!
    expect(side.start).toBe(7)
    expect(side.end).toBe(10)
    expect(baseline.total_minutes).toBe(10)
  })

  it('(a) the first Done on the main does not pull the side earlier than the baseline', () => {
    // main:0 (baseline end 6) done early, at minute 1.
    const start = sideStartDoneEarly(1)
    expect(start).toBe(7) // baseline_start(side) + lateness(0)

    // Without the flag, the same progress lets the side start at `now`
    // instead — demonstrably earlier than the baseline had it.
    const asap = scheduleMeal({
      dishes: [MAIN, SIDE],
      progress: {
        now_minutes: 1,
        steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    const asapSide = asap.placements.find((p) => p.dish_id === 'side')!
    expect(asapSide.start).toBeLessThan(7)
  })

  it('(b) +2 min on a step shifts every pending step by exactly 2', () => {
    const onTime = sideStartRunning(0, 1) // main:0 still running, on its original 6-min duration
    const plusTwo = sideStartRunning(2, 1) // +2 min tapped on it
    expect(plusTwo - onTime).toBe(2)
  })

  it('(c) a skip does not pull the rest earlier than the baseline', () => {
    const timeline = scheduleMeal({
      dishes: [MAIN, SIDE],
      progress: {
        now_minutes: 1,
        hold_to_plan: true,
        steps: { 'main:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    const side = timeline.placements.find((p) => p.dish_id === 'side')!
    expect(side.start).toBe(7) // same floor as the early-Done case — skip can't pull it earlier either
  })

  it('(d) guarantee 7 still holds: nothing is placed before now_minutes, and fixed steps are unchanged', () => {
    const timeline = scheduleMeal({
      dishes: [MAIN, SIDE],
      progress: {
        now_minutes: 4,
        hold_to_plan: true,
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    // Guarantee 7 is about newly-scheduled (pending) steps — the running
    // step itself keeps its real, already-in-the-past recorded start.
    const chop = timeline.placements.find((p) => p.dish_id === 'main' && p.step_index === 0)!
    expect(chop.start).toBe(0)
    expect(chop.end).toBe(6) // running: fixed at start + duration + extra, unchanged by hold_to_plan

    for (const p of timeline.placements) {
      if (p.dish_id === 'main' && p.step_index === 0) continue // the fixed/running step, checked above
      expect(p.start).toBeGreaterThanOrEqual(4)
    }
  })

  it('(e) without the flag, output is unchanged — hold_to_plan is opt-in', () => {
    const withoutFlag = scheduleMeal({
      dishes: [MAIN, SIDE],
      progress: {
        now_minutes: 1,
        steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    const explicitlyFalse = scheduleMeal({
      dishes: [MAIN, SIDE],
      progress: {
        now_minutes: 1,
        hold_to_plan: false,
        steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    expect(explicitlyFalse).toEqual(withoutFlag)
    const side = withoutFlag.placements.find((p) => p.dish_id === 'side')!
    expect(side.start).toBe(1) // ASAP — ordinary behaviour, not held to the baseline
  })

  it('adds step_index to start and ongoing row cells', () => {
    const timeline = scheduleMeal({ dishes: [MAIN, SIDE] })
    const startCells = timeline.rows.flatMap((r) => Object.values(r.cells)).filter((c) => c!.kind === 'start')
    for (const c of startCells) {
      expect(typeof (c as { step_index: number }).step_index).toBe('number')
    }
    const ongoingCells = timeline.rows
      .flatMap((r) => Object.values(r.cells))
      .filter((c) => c!.kind === 'ongoing')
    for (const c of ongoingCells) {
      expect(typeof (c as { step_index: number }).step_index).toBe('number')
    }
    expect(ongoingCells.length).toBeGreaterThan(0) // main's 10-min span across two rows has at least one ongoing cell somewhere, or side's own
  })
})
