/**
 * @jest-environment node
 *
 * Tests for normalizeBaseUnit in lib/api/ai-proxy (#224).
 *
 * The function is server-side only (calls aiProxyFetch which reads Supabase
 * session from cookies), so we mock the underlying fetch and verify the
 * request shape and response parsing.
 */

// Mock the Supabase server client so aiProxyFetch can resolve a session.
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  }),
}))

import { normalizeBaseUnit } from '@/lib/api/ai-proxy'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

function mockFetch(body: unknown, ok = true): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })
  global.fetch = mock as unknown as typeof fetch
  return mock
}

describe('normalizeBaseUnit (#224)', () => {
  it('sends the correct payload to /v1/pantry/normalize-base-unit', async () => {
    const mock = mockFetch({ quantity_base: 480.0, unit_base: 'ml' })

    await normalizeBaseUnit({ name: 'milk', quantity: 2.0, unit: 'cup', category: 'dairy' })

    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/pantry/normalize-base-unit')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ name: 'milk', quantity: 2.0, unit: 'cup', category: 'dairy' })
  })

  it('returns quantity_base and unit_base from a successful response', async () => {
    mockFetch({ quantity_base: 480.0, unit_base: 'ml' })

    const result = await normalizeBaseUnit({ name: 'milk', quantity: 2.0, unit: 'cup' })

    expect(result.quantity_base).toBeCloseTo(480.0)
    expect(result.unit_base).toBe('ml')
  })

  it('returns {null, null} when the service responds with nulls (unconvertible unit)', async () => {
    mockFetch({ quantity_base: null, unit_base: null })

    const result = await normalizeBaseUnit({ name: 'baby spinach', quantity: 1.0, unit: 'bag' })

    expect(result.quantity_base).toBeNull()
    expect(result.unit_base).toBeNull()
  })

  it('returns {null, null} when the fetch fails (service unavailable)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch

    const result = await normalizeBaseUnit({ name: 'eggs', quantity: 1.0, unit: 'dozen' })

    expect(result.quantity_base).toBeNull()
    expect(result.unit_base).toBeNull()
  })

  it('returns {null, null} on a non-OK HTTP response (5xx)', async () => {
    mockFetch({ detail: 'Internal Server Error' }, false)

    const result = await normalizeBaseUnit({ name: 'eggs', quantity: 1.0, unit: 'dozen' })

    expect(result.quantity_base).toBeNull()
    expect(result.unit_base).toBeNull()
  })

  it('defaults category to "other" when not supplied', async () => {
    const mock = mockFetch({ quantity_base: 12.0, unit_base: 'count' })

    await normalizeBaseUnit({ name: 'eggs', quantity: 1.0, unit: 'dozen' })

    const [, init] = mock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.category).toBe('other')
  })
})
