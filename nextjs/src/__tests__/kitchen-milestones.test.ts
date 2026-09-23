/**
 * Tests for the milestone helpers (issue #522).
 */
import { DECORATION_MILESTONES, reachedMilestones, pendingMilestones } from '@/lib/kitchen/milestones'

describe('DECORATION_MILESTONES', () => {
  it('is ascending by threshold', () => {
    const thresholds = DECORATION_MILESTONES.map((m) => m.threshold)
    const sorted = [...thresholds].sort((a, b) => a - b)
    expect(thresholds).toEqual(sorted)
  })

  it('has unique keys', () => {
    const keys = DECORATION_MILESTONES.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('reachedMilestones', () => {
  it('returns nothing below the first threshold', () => {
    expect(reachedMilestones(0)).toEqual([])
    expect(reachedMilestones(24)).toEqual([])
  })

  it('returns every threshold at or below the balance, ascending', () => {
    const reached = reachedMilestones(120)
    expect(reached.map((m) => m.key)).toEqual(['m25', 'm60', 'm120'])
  })

  it('includes a milestone exactly at its threshold', () => {
    expect(reachedMilestones(25).map((m) => m.key)).toEqual(['m25'])
  })
})

describe('pendingMilestones', () => {
  it('excludes claimed milestones', () => {
    expect(pendingMilestones(120, ['m25'])).toEqual([
      { key: 'm60', threshold: 60 },
      { key: 'm120', threshold: 120 },
    ])
  })

  it('returns everything reached when nothing is claimed', () => {
    expect(pendingMilestones(120, []).map((m) => m.key)).toEqual(['m25', 'm60', 'm120'])
  })

  it('returns nothing once every reached milestone is claimed', () => {
    expect(pendingMilestones(60, ['m25', 'm60'])).toEqual([])
  })

  // Decision recorded in the issue: one balance jump can cross two
  // thresholds at once (e.g. one big bubble award landing while the user
  // was below m25), and pendingMilestones must surface both, oldest first.
  it('crossing two thresholds in one jump yields both, oldest first', () => {
    expect(pendingMilestones(65, []).map((m) => m.key)).toEqual(['m25', 'm60'])
  })
})
