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

import { requireAuth } from '@/lib/response-helpers'

function makeSupabaseMock(storedUpdates: { current: Record<string, unknown> }) {
  return {
    from: () => ({
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
})

/**
 * `DELETE /api/pantry/[id]` waste recording (#524 review finding): deleting
 * an already-expired item straight from the pantry used to leave no trace at
 * all, letting a user clear a wasted item (and keep the streak) just by
 * tidying up before their next visit. Deleting a fresh item must not write
 * anything — that's an ordinary removal, not waste.
 */
describe('DELETE /api/pantry/[id] waste recording (#524)', () => {
  function makeDeleteSupabase(item: Record<string, unknown> | null, insertMock: jest.Mock) {
    return {
      from: (table: string) => {
        if (table === 'pantry_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({ data: item, error: item ? null : { message: 'not found' } }),
                }),
              }),
            }),
            delete: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          }
        }
        if (table === 'pantry_events') {
          return { insert: insertMock }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('records a tossed pantry_event when the deleted item was already expired', async () => {
    const insertMock = jest.fn(async () => ({ error: null }))
    const item = {
      name: 'Spinach',
      quantity: 1,
      unit: 'bag',
      expiry_date: '2020-01-01',
    }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeDeleteSupabase(item, insertMock), mockUser])

    const res = await DELETE(new Request('http://localhost/api/pantry/item-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'item-1' }),
    })

    expect(res.status).toBe(200)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        pantry_item_id: 'item-1',
        item_name: 'Spinach',
        outcome: 'tossed',
      }),
    )
  })

  it('does not record a pantry_event when the deleted item is not expired', async () => {
    const insertMock = jest.fn(async () => ({ error: null }))
    const item = {
      name: 'Spinach',
      quantity: 1,
      unit: 'bag',
      expiry_date: '2099-01-01',
    }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeDeleteSupabase(item, insertMock), mockUser])

    const res = await DELETE(new Request('http://localhost/api/pantry/item-1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'item-1' }),
    })

    expect(res.status).toBe(200)
    expect(insertMock).not.toHaveBeenCalled()
  })
})
