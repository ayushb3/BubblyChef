/**
 * @jest-environment node
 *
 * Tests for `GET /api/chat/starter-context` (issue #651, §7a/§11), mirroring
 * the mocking style in `kitchen-offer-route.test.ts`: `requireAuth` is
 * mocked directly, and a fake Supabase client's `.from(table)` returns a
 * chainable, thenable query builder so `await supabase.from(...)...limit(n)`
 * resolves without an explicit terminal call, the same shape the real
 * supabase-js client has.
 *
 * `fetchStarterContext`'s client-side normalisation (`lib/api/starter-
 * context.ts`) is tested in the same file, per §11.
 */

import { NextResponse } from 'next/server'

const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
}))

import { requireAuth } from '@/lib/response-helpers'

const mockRequireAuth = requireAuth as jest.Mock

interface QueryResult {
  data: unknown
  error: { message: string } | null
  count?: number | null
}

/** A chainable, thenable stand-in for a supabase-js query builder. */
function makeQuery(result: QueryResult, calls: string[]) {
  const record = (method: string) => (...args: unknown[]) => {
    calls.push(`${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
    return builder
  }
  const builder: Record<string, unknown> = {
    select: record('select'),
    eq: record('eq'),
    not: record('not'),
    gte: record('gte'),
    lte: record('lte'),
    gt: record('gt'),
    order: record('order'),
    limit: record('limit'),
    then: (resolve: (v: QueryResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

/**
 * `results[table]` is a queue: the Nth call to `.from(table)` in this test
 * gets `results[table][N]`. `calls[table]` collects the chained method calls
 * per call index, for asserting on filter args.
 */
function supabaseWith(results: Record<string, QueryResult[]>, calls: Record<string, string[][]> = {}) {
  const counters: Record<string, number> = {}
  return {
    from: (table: string) => {
      const idx = counters[table] ?? 0
      counters[table] = idx + 1
      const result = results[table]?.[idx] ?? { data: [], error: null }
      calls[table] ??= []
      calls[table][idx] = []
      return makeQuery(result, calls[table][idx])
    },
  }
}

/** Every query the route issues, defaulted to an empty/harmless success. */
function baseResults(overrides: Partial<Record<string, QueryResult[]>> = {}): Record<string, QueryResult[]> {
  return {
    pantry_items: [
      { data: [], error: null }, // expiring
      { data: null, error: null, count: 3 }, // pantry count
    ],
    recipes: [
      { data: [], error: null }, // recent cooks
      { data: [], error: null }, // cooked-cuisine
      { data: [], error: null }, // created-cuisine
    ],
    meals: [{ data: [], error: null }], // meal servings
    ...overrides,
  }
}

describe('GET /api/chat/starter-context', () => {
  const originalWarn = console.warn

  beforeEach(() => {
    jest.clearAllMocks()
    console.warn = jest.fn()
  })

  afterAll(() => {
    console.warn = originalWarn
  })

  it('401s without a session', async () => {
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    mockRequireAuth.mockResolvedValue(unauthorized)

    const { GET } = await import('@/app/api/chat/starter-context/route')
    const res = await GET()

    expect(res.status).toBe(401)
  })

  it('returns the full StarterContext shape on success', async () => {
    mockRequireAuth.mockResolvedValue([supabaseWith(baseResults()), mockUser])

    const { GET } = await import('@/app/api/chat/starter-context/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      expiring: [],
      pantry_count: 3,
      recent_cooks: [],
      recent_cuisines: [],
      default_servings: 2,
    })
  })

  it('the expiring query filters to [today-1, today+7], in-stock only, ordered expiry_date then name', async () => {
    const calls: Record<string, string[][]> = {}
    mockRequireAuth.mockResolvedValue([supabaseWith(baseResults(), calls), mockUser])

    const { GET } = await import('@/app/api/chat/starter-context/route')
    await GET()

    const expiringCalls = calls.pantry_items[0]
    expect(expiringCalls.some((c) => c.startsWith('gt("quantity", 0)'))).toBe(true)
    expect(expiringCalls.some((c) => c.startsWith('gte("expiry_date"'))).toBe(true)
    expect(expiringCalls.some((c) => c.startsWith('lte("expiry_date"'))).toBe(true)
    expect(expiringCalls.filter((c) => c.startsWith('order('))).toEqual(['order("expiry_date")', 'order("name")'])
  })

  it('zero-quantity rows are excluded from expiring (asserted via the gt(quantity, 0) filter)', async () => {
    const calls: Record<string, string[][]> = {}
    mockRequireAuth.mockResolvedValue([supabaseWith(baseResults(), calls), mockUser])

    const { GET } = await import('@/app/api/chat/starter-context/route')
    await GET()

    expect(calls.pantry_items[0]).toContain('gt("quantity", 0)')
  })

  it('drafts are excluded from recent cooks and both cuisine queries (is_draft filter present on every recipes call)', async () => {
    const calls: Record<string, string[][]> = {}
    mockRequireAuth.mockResolvedValue([supabaseWith(baseResults(), calls), mockUser])

    const { GET } = await import('@/app/api/chat/starter-context/route')
    await GET()

    calls.recipes.forEach((callArgs) => {
      expect(callArgs).toContain('eq("is_draft", false)')
    })
  })

  it('a failed pantry count query gives pantry_count: null with a 200 overall', async () => {
    mockRequireAuth.mockResolvedValue([
      supabaseWith(
        baseResults({
          pantry_items: [
            { data: [], error: null },
            { data: null, error: { message: 'boom' }, count: null },
          ],
        }),
      ),
      mockUser,
    ])

    const { GET } = await import('@/app/api/chat/starter-context/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.pantry_count).toBeNull()
    expect(console.warn).toHaveBeenCalled()
  })

  // ── §6 shared fixture ──────────────────────────────────────────────────────
  //
  // A: thai, created 09-01, cooked 09-28
  // B: Italian, created 09-27, never cooked
  // C: italian, created 09-20, cooked 09-26
  // D: thai, created 09-25, never cooked
  // E: mexican, created 09-24, never cooked
  // F: korean, created 09-29, a draft (excluded by the route's own is_draft filter)
  // G: french, created 08-01, never cooked (outside the top-5 sample)
  //
  // Expected: recent_cuisines === ['thai', 'italian'].
  it('the §6 shared fixture gives recent_cuisines = [thai, italian]', async () => {
    const cooked = [
      { id: 'A', cuisine: 'thai', last_cooked_at: '2026-09-28', created_at: '2026-09-01' },
      { id: 'C', cuisine: 'italian', last_cooked_at: '2026-09-26', created_at: '2026-09-20' },
    ]
    const created = [
      { id: 'B', cuisine: 'Italian', last_cooked_at: null, created_at: '2026-09-27' },
      { id: 'D', cuisine: 'thai', last_cooked_at: null, created_at: '2026-09-25' },
      { id: 'E', cuisine: 'mexican', last_cooked_at: null, created_at: '2026-09-24' },
      { id: 'C', cuisine: 'italian', last_cooked_at: '2026-09-26', created_at: '2026-09-20' },
      { id: 'A', cuisine: 'thai', last_cooked_at: '2026-09-28', created_at: '2026-09-01' },
    ]
    mockRequireAuth.mockResolvedValue([
      supabaseWith(
        baseResults({
          recipes: [
            { data: [], error: null }, // recent cooks (unrelated to this assertion)
            { data: cooked, error: null },
            { data: created, error: null },
          ],
        }),
      ),
      mockUser,
    ])

    const { GET } = await import('@/app/api/chat/starter-context/route')
    const res = await GET()
    const body = await res.json()

    expect(body.recent_cuisines).toEqual(['thai', 'italian'])
  })

  it('the §6 shared fixture default-servings cases', async () => {
    async function servingsFor(rows: Array<{ servings: number | null; last_cooked_at: string | null }>) {
      mockRequireAuth.mockResolvedValue([supabaseWith(baseResults({ meals: [{ data: rows, error: null }] })), mockUser])
      const { GET } = await import('@/app/api/chat/starter-context/route')
      const res = await GET()
      return (await res.json()).default_servings
    }

    expect(
      await servingsFor([
        { servings: 4, last_cooked_at: '2026-09-28' },
        { servings: 2, last_cooked_at: '2026-09-27' },
        { servings: 4, last_cooked_at: '2026-09-20' },
      ]),
    ).toBe(4)

    expect(
      await servingsFor([
        { servings: 2, last_cooked_at: '2026-09-28' },
        { servings: 4, last_cooked_at: '2026-09-27' },
      ]),
    ).toBe(2)

    expect(await servingsFor([])).toBe(2)
  })
})

// ─── fetchStarterContext (§11) ──────────────────────────────────────────────

describe('fetchStarterContext', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  function mockFetch(body: unknown, ok = true) {
    global.fetch = jest.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    })) as unknown as typeof fetch
  }

  it('throws on a non-ok response', async () => {
    mockFetch({}, false)
    const { fetchStarterContext } = await import('@/lib/api/starter-context')
    await expect(fetchStarterContext()).rejects.toThrow()
  })

  it.each([-1, 1.5, '3'])('pantry_count %p becomes null', async (bad) => {
    mockFetch({ pantry_count: bad })
    const { fetchStarterContext } = await import('@/lib/api/starter-context')
    expect((await fetchStarterContext()).pantry_count).toBeNull()
  })

  it.each([0, 21, '4'])('default_servings %p becomes 2', async (bad) => {
    mockFetch({ default_servings: bad })
    const { fetchStarterContext } = await import('@/lib/api/starter-context')
    expect((await fetchStarterContext()).default_servings).toBe(2)
  })

  it('a non-array expiring becomes []', async () => {
    mockFetch({ expiring: {} })
    const { fetchStarterContext } = await import('@/lib/api/starter-context')
    expect((await fetchStarterContext()).expiring).toEqual([])
  })

  it('an expiring entry missing name is dropped', async () => {
    mockFetch({ expiring: [{ expiry_date: '2026-10-01' }, { name: 'milk', expiry_date: '2026-10-02' }] })
    const { fetchStarterContext } = await import('@/lib/api/starter-context')
    expect((await fetchStarterContext()).expiring).toEqual([{ name: 'milk', expiry_date: '2026-10-02' }])
  })
})
