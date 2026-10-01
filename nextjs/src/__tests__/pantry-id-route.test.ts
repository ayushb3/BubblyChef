/**
 * @jest-environment node
 *
 * Test for `PUT /api/pantry/[id]` (issue #380: manually correcting an item's
 * expiry date never clears `estimated_expiry`).
 *
 * A caller-supplied `expiry_date` is a real date, not a heuristic guess, so
 * the route always clears `estimated_expiry` when one is sent — no override,
 * per the issue's own wording ("regardless of what the row had before").
 */
import { PUT, DELETE } from '@/app/api/pantry/[id]/route'

const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

jest.mock('@/lib/api/ai-proxy', () => ({
  normalizeBaseUnit: jest.fn(),
  estimateExpiry: jest.fn(),
}))

import { requireAuth } from '@/lib/response-helpers'
import { normalizeBaseUnit, estimateExpiry } from '@/lib/api/ai-proxy'

const mockNormalize = normalizeBaseUnit as jest.Mock

// The stored row the read-first branch of PUT sees (#669).
const STORED_ROW: Record<string, unknown> | null = {
  name: 'Flour',
  quantity: 500,
  unit: 'g',
  category: 'pantry',
}

function makeSupabaseMock(
  storedUpdates: { current: Record<string, unknown> },
  opts: {
    row?: Record<string, unknown> | null
    selects?: string[]
    // Every eq(column, value) on the read-first query, in call order.
    eqs?: Array<[string, unknown]>
    // Overrides the read's error; the default for a missing row is PGRST116,
    // which is how PostgREST reports zero rows from `.single()`.
    readError?: { code?: string; message: string }
  } = {},
) {
  const row = opts.row === undefined ? STORED_ROW : opts.row
  return {
    from: () => ({
      // Plumbing for the read-first branch: select().eq().eq().single().
      select: (columns: string) => {
        opts.selects?.push(columns)
        return {
          eq: (column: string, value: unknown) => {
            opts.eqs?.push([column, value])
            return {
              eq: (column2: string, value2: unknown) => {
                opts.eqs?.push([column2, value2])
                return {
                  single: async () => {
                    if (opts.readError) return { data: null, error: opts.readError }
                    return row
                      ? { data: row, error: null }
                      : {
                          data: null,
                          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
                        }
                  },
                }
              },
            }
          },
        }
      },
      update: (updates: Record<string, unknown>) => {
        storedUpdates.current = updates
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'item-1',
                    name: 'Milk',
                    category: 'dairy',
                    location: 'fridge',
                    quantity: 1,
                    unit: 'carton',
                    expiry_date: (updates.expiry_date as string) ?? '2026-09-01',
                    estimated_expiry: updates.estimated_expiry ?? true,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }
      },
    }),
  }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/pantry/item-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockNormalize.mockResolvedValue({ quantity_base: null, unit_base: null })
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('PUT /api/pantry/[id] estimated_expiry clearing (#380)', () => {
  it('clears estimated_expiry when the caller sends a new expiry_date without specifying estimated_expiry', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedUpdates), mockUser])

    const request = makeRequest({ expiry_date: '2026-10-01' })
    const res = await PUT(request, { params: Promise.resolve({ id: 'item-1' }) })
    const body = await res.json()

    expect(storedUpdates.current.estimated_expiry).toBe(false)
    expect(body.estimated_expiry).toBe(false)
  })

  it('clears estimated_expiry even if the request body also sends estimated_expiry: true — no client override exists for this route', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedUpdates), mockUser])

    const request = makeRequest({ expiry_date: '2026-10-01', estimated_expiry: true })
    const res = await PUT(request, { params: Promise.resolve({ id: 'item-1' }) })
    const body = await res.json()

    expect(storedUpdates.current.estimated_expiry).toBe(false)
    expect(body.estimated_expiry).toBe(false)
  })

  it('leaves estimated_expiry untouched when expiry_date is not part of the update', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedUpdates), mockUser])

    const request = makeRequest({ quantity: 2 })
    await PUT(request, { params: Promise.resolve({ id: 'item-1' }) })

    expect(storedUpdates.current.estimated_expiry).toBeUndefined()
  })

  it('#705 guard: an edit that clears the expiry stays cleared — PUT never re-estimates', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedUpdates), mockUser])

    await PUT(makeRequest({ expiry_date: null }), { params: Promise.resolve({ id: 'item-1' }) })

    expect(storedUpdates.current.expiry_date).toBeNull()
    expect(estimateExpiry).not.toHaveBeenCalled()
  })
})

/**
 * An amount edit re-derives quantity_base / unit_base (#669). A stale base is
 * the one wrong state — the next cook deducts from it; null is safe because
 * cook time derives a missing base from (quantity, unit).
 */
describe('PUT /api/pantry/[id] re-derives the base on an amount edit (#669)', () => {
  const ctx = { params: Promise.resolve({ id: 'item-1' }) }

  it('stores the normalised base when a full body edits 500 g to 1 kg, with no read', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    const selects: string[] = []
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabaseMock(storedUpdates, { selects }),
      mockUser,
    ])
    mockNormalize.mockResolvedValue({ quantity_base: 1000, unit_base: 'g' })

    await PUT(
      makeRequest({ name: 'Flour', quantity: 1, unit: 'kg', category: 'pantry' }),
      ctx,
    )

    expect(mockNormalize).toHaveBeenCalledWith({
      name: 'Flour',
      quantity: 1,
      unit: 'kg',
      category: 'pantry',
    })
    expect(storedUpdates.current.quantity_base).toBe(1000)
    expect(storedUpdates.current.unit_base).toBe('g')
    expect(selects).toEqual([])
  })

  it('a partial body reads the row and passes its name, unit and category to the normaliser', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    const selects: string[] = []
    const eqs: Array<[string, unknown]> = []
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabaseMock(storedUpdates, { selects, eqs }),
      mockUser,
    ])
    mockNormalize.mockResolvedValue({ quantity_base: 1000, unit_base: 'g' })

    await PUT(makeRequest({ quantity: 2 }), ctx)

    expect(selects).toEqual(['name, quantity, unit, category'])
    // The read must be scoped to the caller's own row.
    expect(eqs).toContainEqual(['id', 'item-1'])
    expect(eqs).toContainEqual(['user_id', mockUser.id])
    expect(mockNormalize).toHaveBeenCalledWith({
      name: 'Flour',
      quantity: 2,
      unit: 'g',
      category: 'pantry',
    })
    expect(storedUpdates.current.quantity_base).toBe(1000)
    expect(storedUpdates.current.unit_base).toBe('g')
  })

  it('body values win over the stored row', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedUpdates), mockUser])

    await PUT(makeRequest({ unit: 'kg' }), ctx)

    expect(mockNormalize).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Flour', quantity: 500, unit: 'kg' }),
    )
  })

  it('stores nulls when the normaliser cannot derive a base', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedUpdates), mockUser])
    mockNormalize.mockResolvedValue({ quantity_base: null, unit_base: null })

    await PUT(makeRequest({ quantity: 3, unit: 'bag' }), ctx)

    expect(storedUpdates.current.quantity_base).toBeNull()
    expect(storedUpdates.current.unit_base).toBeNull()
  })

  it('an explicit category: null in the body is kept, not replaced by the stored category', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabaseMock(storedUpdates), mockUser])

    await PUT(makeRequest({ quantity: 2, category: null }), ctx)

    expect(mockNormalize).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Flour', quantity: 2, unit: 'g', category: null }),
    )
  })

  it('a read error that is not "no rows" returns 500, not 404, and never normalises', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabaseMock(storedUpdates, { readError: { code: '08006', message: 'connection failure' } }),
      mockUser,
    ])

    const res = await PUT(makeRequest({ quantity: 2 }), ctx)

    expect(res.status).toBe(500)
    expect(mockNormalize).not.toHaveBeenCalled()
    expect(storedUpdates.current).toEqual({})
  })

  it('returns not found when the partial body names a row that is not there', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabaseMock(storedUpdates, { row: null }),
      mockUser,
    ])

    const res = await PUT(makeRequest({ quantity: 2 }), ctx)

    expect(res.status).toBe(404)
    expect(mockNormalize).not.toHaveBeenCalled()
  })

  it('an expiry_date-only body never calls the normaliser or touches the bases (guard)', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    const selects: string[] = []
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabaseMock(storedUpdates, { selects }),
      mockUser,
    ])

    await PUT(makeRequest({ expiry_date: '2026-10-01' }), ctx)

    expect(mockNormalize).not.toHaveBeenCalled()
    expect(selects).toEqual([])
    expect(storedUpdates.current).not.toHaveProperty('quantity_base')
    expect(storedUpdates.current).not.toHaveProperty('unit_base')
  })
})

/**
 * `DELETE /api/pantry/[id]` never records waste (@ayushb3's call on the
 * #524/#570 review, superseding two earlier rounds of this same route):
 * deleting an item — expired or not — is an interaction, not an outcome the
 * weekly streak judges. An earlier round had this route write a `tossed`
 * pantry_event when the deleted item was already expired, specifically so a
 * user couldn't clear a wasted item by tidying up before their next visit;
 * that rule is reversed here. Waste is only ever an explicit `tossed`
 * resolve, or an item left sitting in the pantry past its expiry — see
 * `lib/waste.ts`.
 */
describe('DELETE /api/pantry/[id] does not record waste (#524/#570)', () => {
  function makeDeleteSupabase(deleteError: { message: string } | null, calls: string[]) {
    return {
      from: (table: string) => {
        if (table === 'pantry_items') {
          return {
            delete: () => ({
              eq: () => ({
                eq: async () => {
                  calls.push('delete')
                  return { error: deleteError }
                },
              }),
            }),
          }
        }
        if (table === 'pantry_events') {
          throw new Error('DELETE must never touch pantry_events')
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('deletes an already-expired item and writes no pantry_event — the streak stays clean', async () => {
    const calls: string[] = []
    ;(requireAuth as jest.Mock).mockResolvedValue([makeDeleteSupabase(null, calls), mockUser])

    const res = await DELETE(new Request('http://localhost/api/pantry/item-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'item-1' }),
    })

    expect(res.status).toBe(200)
    expect(calls).toEqual(['delete'])
  })

  it('deletes a fresh (not-yet-expired) item and writes no pantry_event', async () => {
    const calls: string[] = []
    ;(requireAuth as jest.Mock).mockResolvedValue([makeDeleteSupabase(null, calls), mockUser])

    const res = await DELETE(new Request('http://localhost/api/pantry/item-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'item-1' }),
    })

    expect(res.status).toBe(200)
    expect(calls).toEqual(['delete'])
  })

  it('fails the response when the delete itself fails, still writing nothing', async () => {
    const calls: string[] = []
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeDeleteSupabase({ message: 'db down' }, calls),
      mockUser,
    ])

    const res = await DELETE(new Request('http://localhost/api/pantry/item-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'item-1' }),
    })

    expect(res.status).toBe(500)
    expect(calls).toEqual(['delete'])
  })
})
