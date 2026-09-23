/**
 * Unit tests for the timezone-aware date helpers added in the #524 review
 * fix — bucketing server-stored UTC timestamps into the CLIENT's local
 * calendar day instead of the server's UTC day — and tightened in #550
 * (`validateClientDate` moves from ±1 day tolerance to an exact match
 * against the offset-derived local date).
 */

import { utcTimestampToLocalDate, parseTzOffsetMinutes, validateClientDate } from '@/lib/date'

describe('utcTimestampToLocalDate', () => {
  it('keeps the same date when offset is 0 (UTC)', () => {
    expect(utcTimestampToLocalDate('2026-09-21T23:30:00Z', 0)).toBe('2026-09-21')
  })

  it('rolls a late-UTC timestamp back to the previous local day for a negative offset', () => {
    // 2026-09-21T23:30:00Z is Sunday night UTC, but 23:30 UTC-7 is only
    // 16:30 local on the same UTC day minus 7 hours -> still Sunday local.
    // Use a timestamp that actually crosses midnight UTC for a UTC-7 client:
    // 2026-09-22T02:00:00Z (Monday, early UTC) is 2026-09-21T19:00 local at UTC-7.
    expect(utcTimestampToLocalDate('2026-09-22T02:00:00Z', -420)).toBe('2026-09-21')
  })

  it('rolls a timestamp forward to the next local day for a positive offset', () => {
    // 2026-09-21T22:00:00Z + 2h (UTC+2) = 2026-09-22T00:00 local.
    expect(utcTimestampToLocalDate('2026-09-21T22:00:00Z', 120)).toBe('2026-09-22')
  })
})

describe('parseTzOffsetMinutes', () => {
  it('defaults to 0 (UTC) when missing', () => {
    expect(parseTzOffsetMinutes(null)).toBe(0)
  })

  it('defaults to 0 (UTC) when unparseable', () => {
    expect(parseTzOffsetMinutes('not-a-number')).toBe(0)
  })

  it('parses a valid negative offset', () => {
    expect(parseTzOffsetMinutes('-420')).toBe(-420)
  })

  it('clamps to real-world timezone bounds', () => {
    expect(parseTzOffsetMinutes('99999')).toBe(840)
    expect(parseTzOffsetMinutes('-99999')).toBe(-720)
  })

  it('accepts a JSON body number, not just a query-string value (issue #550)', () => {
    expect(parseTzOffsetMinutes(-420)).toBe(-420)
    expect(parseTzOffsetMinutes(undefined)).toBe(0)
  })
})

describe('validateClientDate (issue #550: exact match, no ±1 day tolerance)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('accepts the server UTC date at offset 0', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T12:00:00.000Z'))
    expect(validateClientDate('2026-09-23', 0)).toBeNull()
  })

  it('refuses a date one day in the future at offset 0', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T12:00:00.000Z'))
    expect(validateClientDate('2026-09-24', 0)).not.toBeNull()
  })

  it("refuses yesterday's date at offset 0", () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T12:00:00.000Z'))
    expect(validateClientDate('2026-09-22', 0)).not.toBeNull()
  })

  it('accepts the correct local date across UTC midnight for UTC-7 (a date the server has not rolled over to yet)', () => {
    // 2026-09-24T05:00:00Z is already Thursday server-side, but only
    // 2026-09-23T22:00 local at UTC-7 — Wednesday.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T05:00:00.000Z'))
    expect(validateClientDate('2026-09-23', -420)).toBeNull()
    // The server's own (not-yet-local) date is refused for this client.
    expect(validateClientDate('2026-09-24', -420)).not.toBeNull()
  })

  it('accepts the correct local date across UTC midnight for UTC+9 (a date the server has not rolled over to yet)', () => {
    // 2026-09-23T16:00:00Z is still Wednesday server-side, but already
    // 2026-09-24T01:00 local at UTC+9 — Thursday.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T16:00:00.000Z'))
    expect(validateClientDate('2026-09-24', 540)).toBeNull()
    // The server's own (already-past, for this client) date is refused.
    expect(validateClientDate('2026-09-23', 540)).not.toBeNull()
  })

  it('refuses a date one day ahead of the offset-derived local date even when it would be "today" server-side', () => {
    // UTC+9 client whose local date is already the day after the server's
    // UTC date must not be able to claim one day further ahead still.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T16:00:00.000Z'))
    expect(validateClientDate('2026-09-25', 540)).not.toBeNull()
  })

  it('rejects a missing date', () => {
    expect(validateClientDate(undefined, 0)).not.toBeNull()
    expect(validateClientDate(null, 0)).not.toBeNull()
  })

  it('rejects a malformed date string', () => {
    expect(validateClientDate('09/23/2026', 0)).not.toBeNull()
  })
})
