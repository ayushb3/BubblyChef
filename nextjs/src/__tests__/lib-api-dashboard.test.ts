/**
 * Tests for `nextjs/src/lib/api/dashboard.ts` (#225, #168).
 *
 * The timezone sign is the single easiest thing to get wrong here, and it
 * fails silently — the request still succeeds, it just buckets the wrong
 * meal-time and rolls the cache over at the wrong moment. See
 * `ai-service/bubbly_chef/api/routes/dashboard.py`'s `Query(...)` description.
 */
import { tzOffsetMinutes, fetchDashboardDaily } from '@/lib/api/dashboard'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('tzOffsetMinutes (#225, #168)', () => {
  it('sends the NEGATION of Date.prototype.getTimezoneOffset(), not the raw value', () => {
    // getTimezoneOffset() uses the opposite sign convention to the endpoint:
    // for a UTC+2 client, getTimezoneOffset() returns -120, but the API wants
    // +120 (minutes to ADD to UTC to reach local time).
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120)
    expect(tzOffsetMinutes()).toBe(120)
  })

  it('negates a positive getTimezoneOffset() (west of UTC) the same way', () => {
    // UTC-5 (e.g. US Eastern standard time): getTimezoneOffset() returns 300,
    // the endpoint wants -300.
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300)
    expect(tzOffsetMinutes()).toBe(-300)
  })

  it('would silently send the wrong bucket if the sign were not negated', () => {
    // Pinning the bug directly: a naive (unnegated) implementation would
    // return getTimezoneOffset() as-is. Assert our export does NOT do that.
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120)
    expect(tzOffsetMinutes()).not.toBe(-120)
  })
})

describe('fetchDashboardDaily query param (#225, #168)', () => {
  it('forwards the negated tz offset as tz_offset_minutes on the proxy request', async () => {
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120)
    const calls: (RequestInfo | URL)[] = []
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      calls.push(input)
      return jsonResponse({
        tip: { text: 'hi', category: 'technique' },
        suggestion: null,
        generated_at: '2026-09-05T00:00:00Z',
        source: 'ai',
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await fetchDashboardDaily()

    expect(calls).toHaveLength(1)
    const calledUrl = String(calls[0])
    expect(calledUrl).toContain('/api/ai/dashboard/daily')
    expect(calledUrl).toContain('tz_offset_minutes=120')
  })

  it('throws on a non-OK response', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ error: 'boom' }, false),
    ) as unknown as typeof fetch

    await expect(fetchDashboardDaily()).rejects.toThrow('boom')
  })
})
