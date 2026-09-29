/**
 * Issue #649 — named re-planning scenarios (guarantee 7), the exact cases
 * the acceptance criteria calls out: +2 min on a hands-on step, +2 min on a
 * running hands-off step, Skip, and resuming mid-meal with a running
 * hands-on step. Complements the property test's random sweep with
 * concrete, easy-to-read examples.
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

describe('scheduleMeal — re-planning', () => {
  it('+2 min on a running hands-on step delays the next hands-on step that needs the cook', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Two hands-on steps',
      steps: [
        step({ text: 'Chop', label: 'Chop', duration_minutes: 5, hands_on: true }),
        step({ text: 'Sear', label: 'Sear', duration_minutes: 4, hands_on: true, depends_on: [0] }),
      ],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Chop side', label: 'Chop side', duration_minutes: 3, hands_on: true })],
    }

    const withoutExtension = scheduleMeal({
      dishes: [main, side],
      progress: {
        now_minutes: 2,
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    const withExtension = scheduleMeal({
      dishes: [main, side],
      progress: {
        now_minutes: 2,
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 2 } },
      },
    })

    const sear = (tl: typeof withExtension) =>
      tl.placements.find((p) => p.dish_id === 'main' && p.step_index === 1)!

    // Chop normally ends at 5 (0+5+0); with +2 it ends at 7 (0+5+2).
    expect(sear(withoutExtension).start).toBeGreaterThanOrEqual(5)
    expect(sear(withExtension).start).toBeGreaterThanOrEqual(7)
    expect(sear(withExtension).start).toBeGreaterThan(sear(withoutExtension).start)
  })

  it('+2 min on a running hands-off step pushes back the step that depends on it', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Simmer then serve',
      steps: [
        step({ text: 'Start pot', label: 'Start pot', duration_minutes: 2, hands_on: true }),
        step({
          text: 'Simmer',
          label: 'Simmer',
          ongoing_label: 'it simmers',
          duration_minutes: 10,
          hands_on: false,
          depends_on: [0],
        }),
        step({ text: 'Serve', label: 'Serve', duration_minutes: 2, hands_on: true, depends_on: [1] }),
      ],
    }

    const timeline = scheduleMeal({
      dishes: [main],
      progress: {
        now_minutes: 8,
        steps: {
          'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
          'main:1': { status: 'running', started_at_minutes: 2, extra_minutes: 2 },
        },
      },
    })

    const simmer = timeline.placements.find((p) => p.step_index === 1)!
    const serve = timeline.placements.find((p) => p.step_index === 2)!
    // Fixed at its recorded start; end reflects the +2.
    expect(simmer.start).toBe(2)
    expect(simmer.end).toBe(2 + 10 + 2)
    // Serve can't start before the (extended) simmer ends.
    expect(serve.start).toBeGreaterThanOrEqual(simmer.end)
  })

  it('Skip: a skipped step ends at now, so its dependent can start straight away (PR #658 review)', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Optional step',
      steps: [
        step({ text: 'Marinate', label: 'Marinate', duration_minutes: 20, hands_on: false }),
        step({ text: 'Cook', label: 'Cook', duration_minutes: 5, hands_on: true, depends_on: [0] }),
      ],
    }

    const timeline = scheduleMeal({
      dishes: [main],
      progress: {
        now_minutes: 1,
        steps: { 'main:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })

    const marinate = timeline.placements.find((p) => p.step_index === 0)!
    const cook = timeline.placements.find((p) => p.step_index === 1)!
    expect(marinate.start).toBe(0)
    expect(marinate.end).toBe(1)
    expect(cook.start).toBe(1)
  })

  it('Skip on a hands-on step frees the cook at now, not at its nominal end', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Knead', label: 'Knead', duration_minutes: 20, hands_on: true })],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Chop', label: 'Chop', duration_minutes: 4, hands_on: true })],
    }
    const timeline = scheduleMeal({
      dishes: [main, side],
      progress: {
        now_minutes: 1,
        steps: { 'main:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    const chop = timeline.placements.find((p) => p.dish_id === 'side')!
    expect(chop.start).toBe(1)
  })

  it('Done tapped early ends the step at now and frees the cook', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [
        step({ text: 'Sear', label: 'Sear', duration_minutes: 10, hands_on: true }),
        step({ text: 'Plate', label: 'Plate', duration_minutes: 2, hands_on: true, depends_on: [0] }),
      ],
    }
    const timeline = scheduleMeal({
      dishes: [main],
      progress: {
        now_minutes: 6,
        steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })
    const [sear, plate] = [0, 1].map((i) => timeline.placements.find((p) => p.step_index === i)!)
    expect(sear.end).toBe(6)
    expect(plate.start).toBe(6)
  })

  it('a running hands-on step still holds the cook until start + duration + extra', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [step({ text: 'Knead', label: 'Knead', duration_minutes: 10, hands_on: true })],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Chop', label: 'Chop', duration_minutes: 4, hands_on: true })],
    }
    const timeline = scheduleMeal({
      dishes: [main, side],
      progress: {
        now_minutes: 1,
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 2 } },
      },
    })
    const chop = timeline.placements.find((p) => p.dish_id === 'side')!
    expect(chop.start).toBe(12)
  })

  it('resuming mid-meal with a running hands-on step keeps the cook busy until it ends', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Chop then cook',
      steps: [
        step({ text: 'Chop', label: 'Chop', duration_minutes: 5, hands_on: true }),
        step({ text: 'Cook', label: 'Cook', duration_minutes: 4, hands_on: true, depends_on: [0] }),
      ],
    }
    const side: SchedulerDish = {
      dish_id: 'side',
      column: 'side_1',
      title: 'Side',
      steps: [step({ text: 'Chop side', label: 'Chop side', duration_minutes: 3, hands_on: true })],
    }

    const timeline = scheduleMeal({
      dishes: [main, side],
      progress: {
        now_minutes: 3,
        steps: { 'main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })

    const chop = timeline.placements.find((p) => p.dish_id === 'main' && p.step_index === 0)!
    expect(chop.start).toBe(0)
    expect(chop.end).toBe(5)

    // Nothing else hands-on may start before the running chop ends at 5.
    const otherHandsOn = timeline.placements.filter(
      (p) => p.hands_on && !(p.dish_id === 'main' && p.step_index === 0),
    )
    for (const p of otherHandsOn) {
      expect(p.start).toBeGreaterThanOrEqual(5)
    }
  })

  it('resuming after a pause places nothing before now_minutes even when a dependency freed up earlier', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Paused meal',
      steps: [
        step({ text: 'Start', label: 'Start', duration_minutes: 2, hands_on: true }),
        step({ text: 'Continue', label: 'Continue', duration_minutes: 2, hands_on: true, depends_on: [0] }),
      ],
    }

    // "Start" finished at minute 2, but the cook paused and now_minutes is 10.
    const timeline = scheduleMeal({
      dishes: [main],
      progress: {
        now_minutes: 10,
        steps: { 'main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      },
    })

    const cont = timeline.placements.find((p) => p.step_index === 1)!
    expect(cont.start).toBe(10)
  })
})
