/**
 * Issue #550 — the clients no longer send a local `date` for the server to
 * trust. They send the IANA zone they are in (`tz`); the server derives the
 * one accepted local date from its own clock and the account's stored zone.
 */

import { getBubbles } from '@/lib/api/bubbles'
import { resolvePantryItem } from '@/lib/api/pantry'
import { confirmCook } from '@/lib/api/recipes'
import { clientTimeZone } from '@/lib/date'

const fetchMock = jest.fn()

/** jsdom has no `Response`; the clients only read `ok`, `status` and `json()`. */
function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    okJson({ balance: 0, recent: [], streak_weeks: 0, wasted_this_week: false }),
  )
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('clientTimeZone', () => {
  it("is the browser's IANA zone", () => {
    expect(clientTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

describe('bubbles clients send a zone, not a date (#550)', () => {
  it('GET /api/bubbles carries tz and no date or offset', async () => {
    await getBubbles()

    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.searchParams.get('tz')).toBe(clientTimeZone())
    expect(url.searchParams.has('date')).toBe(false)
    expect(url.searchParams.has('tz_offset_minutes')).toBe(false)
  })

  it('resolvePantryItem body carries tz and no date', async () => {
    fetchMock.mockResolvedValue(okJson({ resolved: true }))

    await resolvePantryItem('item-1', 'used')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ outcome: 'used', tz: clientTimeZone() })
  })

  it('confirmCook body carries tz and no date', async () => {
    fetchMock.mockResolvedValue(okJson({ success: true }))

    await confirmCook('recipe-1', [])

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ recipe_id: 'recipe-1', deductions: [], tz: clientTimeZone() })
  })
})
