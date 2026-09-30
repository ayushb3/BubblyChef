/**
 * @jest-environment node
 *
 * Issue #705: `POST /api/pantry` and `POST /api/pantry/bulk` used to save a row
 * with no expiry when the AI service's estimate call failed (an outage or cold
 * start), so the row never reached the expiring / use-soon surfaces. They now
 * fall back to a deterministic local estimate and flag it `estimated_expiry`.
 *
 * `ai-proxy` is deliberately NOT mocked here: the point is the real
 * `estimateExpiry` behaving under a failing `fetch`.
 */
import { POST as postSingle } from '@/app/api/pantry/route'
import { POST as postBulk } from '@/app/api/pantry/bulk/route'

const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))

jest.mock('@/lib/pantry-helpers', () => ({
  enrichPantryItem: (row: Record<string, unknown>) => row,
  buildPantryListResponse: (items: unknown) => ({ items }),
}))

jest.mock('@/lib/bubbles', () => ({ awardBubbles: jest.fn() }))

// aiProxyFetch reads the Supabase session for the bearer token.
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  }),
}))

import { requireAuth } from '@/lib/response-helpers'

const realFetch = global.fetch
let warnSpy: jest.SpyInstance

function makeSupabaseMock(stored: { current: Record<string, unknown>[] }) {
  return {
    from: () => ({
      insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        stored.current = Array.isArray(payload) ? payload : [payload]
        return {
          // single-row path: .select().single(); bulk path: await .select()
          select: () => {
            const rows = stored.current.map((r, i) => ({ id: `item-${i}`, ...r }))
            const result = { data: rows, error: null }
            return Object.assign(Promise.resolve(result), {
              single: async () => ({ data: rows[0], error: null }),
            })
          },
        }
      },
    }),
  }
}

function req(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  global.fetch = realFetch
  warnSpy.mockRestore()
  jest.clearAllMocks()
})

describe.each([
  ['rejects (service down)', () => jest.fn().mockRejectedValue(new TypeError('fetch failed'))],
  [
    'returns 503',
    () => jest.fn().mockResolvedValue(new Response('{"detail":"unavailable"}', { status: 503 })),
  ],
  [
    'returns a body with no expiry_date',
    () => jest.fn().mockResolvedValue(new Response('{}', { status: 200 })),
  ],
])('AI service %s (#705)', (_label, makeFetch) => {
  beforeEach(() => {
    global.fetch = makeFetch() as unknown as typeof fetch
  })

  it('POST /api/pantry still saves an expiry and flags it estimated', async () => {
    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])

    const res = await postSingle(
      req('http://localhost/api/pantry', { name: 'Milk', category: 'dairy', storage_location: 'fridge' }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(stored.current[0].expiry_date).toMatch(ISO_DATE)
    expect(stored.current[0].estimated_expiry).toBe(true)
    expect(body.expiry_date).toMatch(ISO_DATE)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('POST /api/pantry/bulk does the same for every item that lacks a date', async () => {
    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])

    const res = await postBulk(
      req('http://localhost/api/pantry/bulk', {
        items: [
          { name: 'Milk', category: 'dairy', storage_location: 'fridge' },
          { name: 'Rice', category: 'dry_goods', storage_location: 'pantry' },
        ],
      }),
    )

    expect(res.status).toBe(201)
    expect(stored.current).toHaveLength(2)
    for (const row of stored.current) {
      expect(row.expiry_date).toMatch(ISO_DATE)
      expect(row.estimated_expiry).toBe(true)
    }
  })
})

describe('outage fallback edge cases (#705)', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch
  })

  it('a caller-supplied date still wins and is not flagged', async () => {
    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])

    await postSingle(
      req('http://localhost/api/pantry', { name: 'Milk', category: 'dairy', expiry_date: '2026-12-25' }),
    )

    expect(stored.current[0].expiry_date).toBe('2026-12-25')
    expect(stored.current[0].estimated_expiry).toBe(false)
  })

  it('an unknown category falls back to the "other" default rather than null', async () => {
    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])

    await postSingle(
      req('http://localhost/api/pantry', { name: 'Mystery', category: 'not-a-category' }),
    )

    expect(stored.current[0].expiry_date).toMatch(ISO_DATE)
    expect(stored.current[0].estimated_expiry).toBe(true)
  })

  it('a hung AI service is abandoned after a timeout instead of blocking the add', async () => {
    // The estimate call carries an abort signal and then hangs, like a black-holed
    // connection; it only ends when the signal fires. The other best-effort calls
    // (base unit) carry no signal here, so fail them fast to isolate the expiry call.
    let sawSignal = false
    global.fetch = jest.fn((_url: unknown, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) return Promise.reject(new TypeError('fetch failed'))
      sawSignal = true
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')))
      })
    }) as unknown as typeof fetch
    // Make the real timeout elapse immediately for the test.
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const c = new AbortController()
      setTimeout(() => c.abort(), 0)
      return c.signal
    })

    const stored = { current: [] as Record<string, unknown>[] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(stored), mockUser])
    const res = await postSingle(
      req('http://localhost/api/pantry', { name: 'Milk', category: 'dairy' }),
    )
    timeoutSpy.mockRestore()

    expect(res.status).toBe(201)
    expect(sawSignal).toBe(true)
    expect(stored.current[0].expiry_date).toMatch(ISO_DATE)
    expect(stored.current[0].estimated_expiry).toBe(true)
  })
})
