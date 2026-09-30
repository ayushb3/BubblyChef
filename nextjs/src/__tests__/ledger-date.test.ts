/**
 * @jest-environment node
 *
 * Issue #550 — the one exact local date every bubbles ledger key hangs off.
 *
 * The accepted date is computed on the SERVER from the account's stored
 * IANA time zone (auth `app_metadata`, which only the service role can
 * write) and the server's own clock. The client's per-request `tz` can
 * propose a zone the first time, or a change once the cooldown has passed —
 * it can never pick the date of an individual request, so a spoofed or
 * absurd value can't move a key a day forward or back.
 */

const updateUserByIdMock = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { updateUserById: updateUserByIdMock } } }),
}))

import {
  TZ_CHANGE_COOLDOWN_MS,
  isValidTimeZone,
  localDateInZone,
  zoneOffsetMinutes,
  resolveLedgerDate,
} from '@/lib/ledger-date'

const DAY = 24 * 60 * 60 * 1000

function userWith(appMetadata?: Record<string, unknown>) {
  return { id: 'user-1', app_metadata: appMetadata } as never
}

beforeEach(() => {
  updateUserByIdMock.mockReset()
  updateUserByIdMock.mockResolvedValue({ error: null })
})

describe('isValidTimeZone', () => {
  it.each(['UTC', 'Europe/London', 'America/Los_Angeles', 'America/Argentina/Buenos_Aires', 'Etc/GMT+7'])(
    'accepts the IANA zone %s',
    (tz) => {
      expect(isValidTimeZone(tz)).toBe(true)
    },
  )

  it.each([
    ['an unknown zone', 'Mars/Olympus_Mons'],
    ['a raw offset', '+14:00'],
    ['an absurd raw offset', '+99:99'],
    ['an empty string', ''],
    ['an over-long string', 'A'.repeat(300)],
    ['a number', 540],
    ['null', null],
    ['an object', { tz: 'UTC' }],
  ])('rejects %s', (_label, value) => {
    expect(isValidTimeZone(value)).toBe(false)
  })
})

describe('localDateInZone / zoneOffsetMinutes', () => {
  // 01:00Z on the 24th: still the 23rd in Los Angeles, already the 24th in
  // UTC, already the 24th (15:00) in Kiritimati (UTC+14).
  const instant = new Date('2026-09-24T01:00:00.000Z')

  it('formats the date a zone is on at an instant, not the UTC date', () => {
    expect(localDateInZone(instant, 'America/Los_Angeles')).toBe('2026-09-23')
    expect(localDateInZone(instant, 'UTC')).toBe('2026-09-24')
    expect(localDateInZone(instant, 'Pacific/Kiritimati')).toBe('2026-09-24')
  })

  it('follows DST because it uses the zone, not a frozen offset', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'America/Los_Angeles')).toBe(-420)
    expect(zoneOffsetMinutes(new Date('2026-12-01T12:00:00Z'), 'America/Los_Angeles')).toBe(-480)
    expect(zoneOffsetMinutes(instant, 'Asia/Kolkata')).toBe(330)
  })
})

describe('resolveLedgerDate', () => {
  const now = new Date('2026-09-24T01:00:00.000Z')

  it('keys off the stored zone and the server clock, whatever the client claims', async () => {
    const user = userWith({
      ledger_tz: 'America/Los_Angeles',
      ledger_tz_set_at: new Date(now.getTime() - DAY).toISOString(),
    })

    const resolved = await resolveLedgerDate(user, 'Pacific/Kiritimati', now)

    expect(resolved?.timeZone).toBe('America/Los_Angeles')
    expect(resolved?.date).toBe('2026-09-23')
    expect(resolved?.offsetMinutes).toBe(-420)
    expect(updateUserByIdMock).not.toHaveBeenCalled()
  })

  it('adopts the first zone a client reports and stores it server-side', async () => {
    const resolved = await resolveLedgerDate(userWith(), 'America/Los_Angeles', now)

    expect(resolved?.date).toBe('2026-09-23')
    expect(updateUserByIdMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({
          ledger_tz: 'America/Los_Angeles',
          ledger_tz_set_at: now.toISOString(),
        }),
      }),
    )
  })

  it('awards nothing (null) when the first zone cannot be stored, rather than trusting it for one request', async () => {
    updateUserByIdMock.mockResolvedValue({ error: { message: 'boom' } })

    expect(await resolveLedgerDate(userWith(), 'America/Los_Angeles', now)).toBeNull()
  })

  it('is null when there is neither a stored zone nor a usable claim', async () => {
    expect(await resolveLedgerDate(userWith(), undefined, now)).toBeNull()
    expect(await resolveLedgerDate(userWith(), 'Mars/Olympus_Mons', now)).toBeNull()
    expect(await resolveLedgerDate(userWith(), '+99:99', now)).toBeNull()
    expect(updateUserByIdMock).not.toHaveBeenCalled()
  })

  it('ignores a garbage stored zone as if it were absent', async () => {
    const resolved = await resolveLedgerDate(userWith({ ledger_tz: 'nope/nope' }), 'UTC', now)

    expect(resolved?.timeZone).toBe('UTC')
    expect(updateUserByIdMock).toHaveBeenCalled()
  })

  it('refuses to move the stored zone inside the cooldown', async () => {
    const user = userWith({
      ledger_tz: 'America/Los_Angeles',
      ledger_tz_set_at: new Date(now.getTime() - (TZ_CHANGE_COOLDOWN_MS - 60_000)).toISOString(),
    })

    const resolved = await resolveLedgerDate(user, 'Asia/Tokyo', now)

    expect(resolved?.timeZone).toBe('America/Los_Angeles')
    expect(updateUserByIdMock).not.toHaveBeenCalled()
  })

  it('moves the stored zone once the cooldown has passed, and stores the new one', async () => {
    const user = userWith({
      ledger_tz: 'America/Los_Angeles',
      ledger_tz_set_at: new Date(now.getTime() - TZ_CHANGE_COOLDOWN_MS - 60_000).toISOString(),
    })

    const resolved = await resolveLedgerDate(user, 'Asia/Tokyo', now)

    expect(resolved?.timeZone).toBe('Asia/Tokyo')
    expect(resolved?.date).toBe('2026-09-24')
    expect(updateUserByIdMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({
          ledger_tz: 'Asia/Tokyo',
          ledger_tz_set_at: now.toISOString(),
        }),
      }),
    )
  })

  it('keeps the old zone when a due change cannot be stored', async () => {
    updateUserByIdMock.mockResolvedValue({ error: { message: 'boom' } })
    const user = userWith({
      ledger_tz: 'America/Los_Angeles',
      ledger_tz_set_at: new Date(now.getTime() - 30 * DAY).toISOString(),
    })

    const resolved = await resolveLedgerDate(user, 'Asia/Tokyo', now)

    expect(resolved?.timeZone).toBe('America/Los_Angeles')
  })

  it('treats a stored zone with no timestamp as past the cooldown', async () => {
    const resolved = await resolveLedgerDate(userWith({ ledger_tz: 'UTC' }), 'Asia/Tokyo', now)

    expect(resolved?.timeZone).toBe('Asia/Tokyo')
  })

  it('keeps the stored zone when the same zone is claimed again, without a write', async () => {
    const user = userWith({ ledger_tz: 'UTC', ledger_tz_set_at: '2026-01-01T00:00:00.000Z' })

    const resolved = await resolveLedgerDate(user, 'UTC', now)

    expect(resolved?.date).toBe('2026-09-24')
    expect(updateUserByIdMock).not.toHaveBeenCalled()
  })
})
