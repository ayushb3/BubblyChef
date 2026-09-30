/**
 * Unit tests for the timezone-aware date helpers added in the #524 review
 * fix — bucketing server-stored UTC timestamps into the CLIENT's local
 * calendar day instead of the server's UTC day.
 */

import { utcTimestampToLocalDate } from '@/lib/date'

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
