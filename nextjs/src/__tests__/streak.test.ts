/**
 * Unit tests for the pure weekly-streak helpers (issue #524).
 * `computeStreak` has no I/O — see `lib/streak-settlement.ts` for the
 * Supabase-backed caller these get plugged into.
 */

import { isoWeekKey, weekRange, computeStreak } from '@/lib/streak'
import { addDaysToDateString } from '@/lib/date'

describe('isoWeekKey', () => {
  it('keys a mid-week Wednesday into its own ISO week', () => {
    // 2026-09-23 is a Wednesday in ISO week 39 of 2026.
    expect(isoWeekKey('2026-09-23')).toBe('2026-W39')
  })

  it('keys the Monday and Sunday of the same week identically', () => {
    expect(isoWeekKey('2026-09-21')).toBe('2026-W39') // Monday
    expect(isoWeekKey('2026-09-27')).toBe('2026-W39') // Sunday
  })

  it('handles the year-boundary case where late December belongs to next year\'s week 1', () => {
    // 2025-12-29 is a Monday and starts ISO week 1 of 2026.
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01')
  })
})

describe('weekRange', () => {
  it('returns the Monday..Sunday range for a week key', () => {
    expect(weekRange('2026-W39')).toEqual({ start: '2026-09-21', end: '2026-09-27' })
  })

  it('round-trips with isoWeekKey for every day in the range', () => {
    const { start, end } = weekRange('2026-W39')
    expect(isoWeekKey(start)).toBe('2026-W39')
    expect(isoWeekKey(end)).toBe('2026-W39')
  })
})

describe('computeStreak', () => {
  // A fixed Wednesday so "the current week" and "last completed week" are
  // unambiguous across every test below.
  const referenceDate = '2026-09-23' // 2026-W39; last completed week is 2026-W38

  it('awards and counts a single clean, active, unsettled completed week', () => {
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: [],
      activeWeekKeys: ['2026-W38'],
      wastedWeekKeys: [],
    })

    expect(result.weeksToAward).toEqual(['2026-W38'])
    expect(result.currentStreak).toBe(1)
  })

  it('never judges or awards the current, still-in-progress week', () => {
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: [],
      activeWeekKeys: ['2026-W39'], // this week, not a completed one
      wastedWeekKeys: [],
    })

    expect(result.weeksToAward).toEqual([])
    expect(result.currentStreak).toBe(0)
  })

  it('does not award an already-settled week again (idempotent)', () => {
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: ['2026-W38'],
      activeWeekKeys: ['2026-W38'],
      wastedWeekKeys: [],
    })

    expect(result.weeksToAward).toEqual([])
    expect(result.currentStreak).toBe(1) // already-settled clean week still counts
  })

  it('continues a streak across multiple consecutive clean weeks', () => {
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: ['2026-W36', '2026-W37'],
      activeWeekKeys: ['2026-W36', '2026-W37', '2026-W38'],
      wastedWeekKeys: [],
    })

    expect(result.weeksToAward).toEqual(['2026-W38'])
    expect(result.currentStreak).toBe(3)
  })

  it('breaks the streak at a wasted week', () => {
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: ['2026-W36', '2026-W37'],
      activeWeekKeys: ['2026-W36', '2026-W37', '2026-W38'],
      wastedWeekKeys: ['2026-W38'],
    })

    expect(result.weeksToAward).toEqual([]) // W38 is wasted, not clean
    expect(result.currentStreak).toBe(0) // most recent completed week breaks it
  })

  it('breaks the streak at an idle (inactive) week even with no waste', () => {
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: ['2026-W36', '2026-W37'],
      activeWeekKeys: ['2026-W36', '2026-W37'], // W38 has no activity at all
      wastedWeekKeys: [],
    })

    expect(result.weeksToAward).toEqual([]) // idle weeks are never clean
    expect(result.currentStreak).toBe(0)
  })

  it('catches up across a gap: a clean week is still awarded even after several idle weeks', () => {
    // Active + clean in W35, then idle W36-W38, checking in during W39 (referenceDate).
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: [],
      activeWeekKeys: ['2026-W35'],
      wastedWeekKeys: [],
    })

    expect(result.weeksToAward).toEqual(['2026-W35'])
    // Streak is 0 — W38 (the most recent completed week) was idle, so the
    // walk-back breaks immediately even though W35 got its award.
    expect(result.currentStreak).toBe(0)
  })

  it('counts a streak past maxWeeksToCheck when the caller passes full settled history (issue #524 review)', () => {
    // 20 consecutive settled weeks ending last week (2026-W38), older than
    // the default 12-week catch-up window — the caller is expected to pass
    // the FULL settled history, not just what's inside the catch-up window.
    const settledWeekKeys: string[] = []
    let cursor = referenceDate
    for (let i = 0; i < 20; i++) {
      cursor = addDaysToDateString(cursor, -7)
      settledWeekKeys.push(isoWeekKey(cursor))
    }

    const result = computeStreak({
      referenceDate,
      settledWeekKeys,
      activeWeekKeys: [],
      wastedWeekKeys: [],
    })

    expect(result.currentStreak).toBe(20)
  })

  it('is bounded by maxWeeksToCheck for catch-up', () => {
    const result = computeStreak({
      referenceDate,
      settledWeekKeys: [],
      // A week far outside the default 12-week catch-up window.
      activeWeekKeys: ['2025-W01'],
      wastedWeekKeys: [],
      maxWeeksToCheck: 2,
    })

    expect(result.weeksToAward).toEqual([])
    expect(result.currentStreak).toBe(0)
  })

  describe('previousVisitDate (judge-once, issue #524/#570)', () => {
    // W38 = 2026-09-14..2026-09-20 (see the `weekRange` tests above).

    it('never re-awards a completed week that already ended by the previous visit, even if it now reads clean', () => {
      // W38 had already ended (2026-09-20) by the time of the previous visit
      // (2026-09-22) — it was judged then, and whatever that judgment was,
      // it must stand. Simulates the regression: the week was wasted at
      // that settlement, the offending item has since been deleted so
      // `wastedWeekKeys` is empty now, but the week must stay unpaid.
      const result = computeStreak({
        referenceDate,
        settledWeekKeys: [],
        activeWeekKeys: ['2026-W38'],
        wastedWeekKeys: [], // clean NOW — but that's not this test's point
        previousVisitDate: '2026-09-22',
      })

      expect(result.weeksToAward).toEqual([])
      expect(result.currentStreak).toBe(0)
    })

    it('still pays a clean week exactly once, on its first-ever settlement (previousVisitDate null)', () => {
      const result = computeStreak({
        referenceDate,
        settledWeekKeys: [],
        activeWeekKeys: ['2026-W38'],
        wastedWeekKeys: [],
        previousVisitDate: null,
      })

      expect(result.weeksToAward).toEqual(['2026-W38'])
      expect(result.currentStreak).toBe(1)
    })

    it('still judges a completed week that ended AFTER the previous visit — it was never judged before', () => {
      // Previous visit was during W37 (before W38 even started), so W38 —
      // which ends 2026-09-20, after the previous visit — has never been
      // judged and is still eligible.
      const result = computeStreak({
        referenceDate,
        settledWeekKeys: [],
        activeWeekKeys: ['2026-W38'],
        wastedWeekKeys: [],
        previousVisitDate: '2026-09-13', // last day of W37
      })

      expect(result.weeksToAward).toEqual(['2026-W38'])
      expect(result.currentStreak).toBe(1)
    })

    it('catches up every never-judged week after returning from several idle weeks', () => {
      // Previous visit predates all three of these completed weeks, so all
      // three are first judgments and all three are clean.
      const result = computeStreak({
        referenceDate,
        settledWeekKeys: [],
        activeWeekKeys: ['2026-W36', '2026-W37', '2026-W38'],
        wastedWeekKeys: [],
        previousVisitDate: '2026-08-23', // well before W36 starts
      })

      expect(result.weeksToAward).toEqual(['2026-W36', '2026-W37', '2026-W38'])
      expect(result.currentStreak).toBe(3)
    })
  })
})
