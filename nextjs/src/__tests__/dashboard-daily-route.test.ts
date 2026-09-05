/**
 * @jest-environment node
 *
 * Test for `app/api/ai/dashboard/daily/route.ts` (#225, #168).
 *
 * The tz-offset sign is pinned at both ends of the chain — the client
 * negates it (`lib-api-dashboard.test.ts`) and the backend interprets the
 * negated value (`ai-service/tests/test_dashboard_daily_route.py`) — but the
 * proxy route in the middle had no test of its own. It does no arithmetic
 * (it's a verbatim passthrough), so this isn't pinning a bug, just closing
 * the one untested link the other two test files exist to protect: that the
 * route forwards `tz_offset_minutes` unchanged, not that it computes it.
 */
import { GET } from '@/app/api/ai/dashboard/daily/route'

const mockAiProxyFetch = jest.fn()
jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyFetch: (...args: unknown[]) => mockAiProxyFetch(...args),
}))

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/ai/dashboard/daily proxy (#225, #168)', () => {
  it('forwards tz_offset_minutes to the AI service unchanged, without touching its sign', async () => {
    mockAiProxyFetch.mockResolvedValue(
      jsonResponse({
        tip: { text: 'hi', category: 'technique' },
        suggestion: null,
        generated_at: '2026-09-05T00:00:00Z',
        source: 'ai',
      })
    )

    const request = new Request('http://localhost/api/ai/dashboard/daily?tz_offset_minutes=-300')
    await GET(request)

    expect(mockAiProxyFetch).toHaveBeenCalledTimes(1)
    const [path] = mockAiProxyFetch.mock.calls[0]
    expect(path).toBe('/v1/dashboard/daily?tz_offset_minutes=-300')
  })

  it('forwards a positive offset unchanged as well', async () => {
    mockAiProxyFetch.mockResolvedValue(
      jsonResponse({
        tip: { text: 'hi', category: 'technique' },
        suggestion: null,
        generated_at: '2026-09-05T00:00:00Z',
        source: 'ai',
      })
    )

    const request = new Request('http://localhost/api/ai/dashboard/daily?tz_offset_minutes=120')
    await GET(request)

    const [path] = mockAiProxyFetch.mock.calls[0]
    expect(path).toBe('/v1/dashboard/daily?tz_offset_minutes=120')
  })

  it('omits the query param entirely when the client sends none', async () => {
    mockAiProxyFetch.mockResolvedValue(
      jsonResponse({
        tip: { text: 'hi', category: 'technique' },
        suggestion: null,
        generated_at: '2026-09-05T00:00:00Z',
        source: 'ai',
      })
    )

    const request = new Request('http://localhost/api/ai/dashboard/daily')
    await GET(request)

    const [path] = mockAiProxyFetch.mock.calls[0]
    expect(path).toBe('/v1/dashboard/daily?')
  })

  it('surfaces a non-OK upstream response as a JSON error with the same status', async () => {
    mockAiProxyFetch.mockResolvedValue(jsonResponse({ detail: 'boom' }, false, 502))

    const request = new Request('http://localhost/api/ai/dashboard/daily?tz_offset_minutes=0')
    const res = await GET(request)

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('boom')
  })
})
