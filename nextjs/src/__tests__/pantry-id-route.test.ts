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
import { PUT } from '@/app/api/pantry/[id]/route'

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
