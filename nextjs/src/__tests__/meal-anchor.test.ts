/**
 * Issue #649 — the anchor helper, which maps a Meal timeline's minute
 * offsets onto clock time. Pure: `now` is always supplied by the test, the
 * helper itself never reads a clock.
 */

import {
  resolveMealAnchor,
  formatRelativeOffset,
  formatClockTime,
  anchoredTimeLabel,
} from '@/lib/meal-anchor'

describe('resolveMealAnchor', () => {
  const now = new Date('2026-09-29T18:00:00')

  it('start-now, not yet started: relative offsets', () => {
    const result = resolveMealAnchor({ mode: 'start-now', total_minutes: 20, now })
    expect(result).toEqual({ status: 'relative' })
  })

  it('start-now, once cooking has begun: clock times from the real start', () => {
    const startedAt = new Date('2026-09-29T18:05:00')
    const result = resolveMealAnchor({
      mode: 'start-now',
      total_minutes: 20,
      now,
      started_at: startedAt,
    })
    expect(result).toEqual({ status: 'clock', start_at: startedAt })
  })

  it('serve-at: start = serve_at - total_minutes, when feasible', () => {
    const serveAt = new Date('2026-09-29T19:00:00')
    const result = resolveMealAnchor({ mode: 'serve-at', total_minutes: 40, now, serve_at: serveAt })
    expect(result.status).toBe('clock')
    if (result.status === 'clock') {
      expect(result.start_at.toISOString()).toBe(new Date('2026-09-29T18:20:00').toISOString())
    }
  })

  it('serve-at: too_late when the computed start is already in the past', () => {
    const serveAt = new Date('2026-09-29T18:10:00') // only 10 min away
    const result = resolveMealAnchor({ mode: 'serve-at', total_minutes: 40, now, serve_at: serveAt })
    expect(result.status).toBe('too_late')
    if (result.status === 'too_late') {
      expect(result.earliest_ready_at.toISOString()).toBe(
        new Date('2026-09-29T18:40:00').toISOString(),
      )
    }
  })

  it('serve-at once cooking has actually begun anchors to the real start, not the original target', () => {
    const serveAt = new Date('2026-09-29T19:00:00')
    const startedAt = new Date('2026-09-29T18:03:00')
    const result = resolveMealAnchor({
      mode: 'serve-at',
      total_minutes: 40,
      now,
      serve_at: serveAt,
      started_at: startedAt,
    })
    expect(result).toEqual({ status: 'clock', start_at: startedAt })
  })

  it('a serve-at start exactly at now is feasible (not too_late)', () => {
    const serveAt = new Date(now.getTime() + 40 * 60_000)
    const result = resolveMealAnchor({ mode: 'serve-at', total_minutes: 40, now, serve_at: serveAt })
    expect(result.status).toBe('clock')
  })
})

describe('formatRelativeOffset', () => {
  it('renders 0 as "+0"', () => {
    expect(formatRelativeOffset(0)).toBe('+0')
  })

  it('renders a positive offset as "+N min"', () => {
    expect(formatRelativeOffset(12)).toBe('+12 min')
  })
})

describe('formatClockTime', () => {
  it('formats a time as h:mm AM/PM', () => {
    expect(formatClockTime(new Date('2026-09-29T19:12:00'))).toBe('7:12 PM')
  })
})

describe('anchoredTimeLabel', () => {
  it('renders a relative label when the anchor is relative', () => {
    expect(anchoredTimeLabel({ status: 'relative' }, 12)).toBe('+12 min')
  })

  it('renders a clock time offset from the anchor start when the anchor is clock', () => {
    const startAt = new Date('2026-09-29T18:00:00')
    expect(anchoredTimeLabel({ status: 'clock', start_at: startAt }, 12)).toBe('6:12 PM')
  })
})
