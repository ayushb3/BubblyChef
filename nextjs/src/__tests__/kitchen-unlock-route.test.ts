/**
 * @jest-environment node
 *
 * Tests for `POST /api/kitchen/unlock` (issue #522), mirroring the mocking
 * style in `bubbles-route.test.ts`.
 */

const mockUser = { id: 'user-1' }

jest.mock('@/lib/kitchen/catalog', () => ({
  CATALOG: [
    { id: 'a1', name: 'A1', slot: 'slot_a', emoji: '🅰️' },
    { id: 'b1', name: 'B1', slot: 'slot_b', emoji: '🅱️' },
  ],
}))

const insertMock = jest.fn()
const singleMock = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (...args: unknown[]) => {
        insertMock(...args)
        return { select: () => ({ single: singleMock }) }
      },
    }),
  }),
}))

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))

import { requireAuth } from '@/lib/response-helpers'

const mockRequireAuth = requireAuth as jest.Mock

function supabaseWith(balance: number | null, decorations: Array<{ name: string; decoration_type: string; milestone: string | null }>) {
  return {
    from: (table: string) => {
      if (table === 'bubble_balances') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: balance === null ? null : { balance } }) }),
          }),
        }
      }
      return {
        select: () => ({ eq: async () => ({ data: decorations, error: null }) }),
      }
    },
  }
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/kitchen/unlock', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/kitchen/unlock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    singleMock.mockResolvedValue({
      data: { id: 'dec-1', name: 'a1', decoration_type: 'slot_a', milestone: 'm25' },
      error: null,
    })
  })

  it('rejects an unknown milestone_key', async () => {
    mockRequireAuth.mockResolvedValue([supabaseWith(100, []), mockUser])

    const { POST } = await import('@/app/api/kitchen/unlock/route')
    const res = await POST(postRequest({ milestone_key: 'not-a-real-key', decoration_id: 'a1' }))

    expect(res.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects a milestone the balance has not reached', async () => {
    mockRequireAuth.mockResolvedValue([supabaseWith(10, []), mockUser])

    const { POST } = await import('@/app/api/kitchen/unlock/route')
    const res = await POST(postRequest({ milestone_key: 'm25', decoration_id: 'a1' }))

    expect(res.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects a milestone already claimed by this user', async () => {
    mockRequireAuth.mockResolvedValue([
      supabaseWith(100, [{ name: 'a1', decoration_type: 'slot_a', milestone: 'm25' }]),
      mockUser,
    ])

    const { POST } = await import('@/app/api/kitchen/unlock/route')
    const res = await POST(postRequest({ milestone_key: 'm25', decoration_id: 'b1' }))

    expect(res.status).toBe(409)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects a decoration_id that was not offered for the milestone', async () => {
    // a1 already unlocked (by some other milestone) -> only b1 is eligible.
    mockRequireAuth.mockResolvedValue([
      supabaseWith(100, [{ name: 'a1', decoration_type: 'slot_a', milestone: 'm60' }]),
      mockUser,
    ])

    const { POST } = await import('@/app/api/kitchen/unlock/route')
    const res = await POST(postRequest({ milestone_key: 'm25', decoration_id: 'a1' }))

    expect(res.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('inserts and returns 201 for a reached, unclaimed, offered pick', async () => {
    mockRequireAuth.mockResolvedValue([supabaseWith(100, []), mockUser])

    const { POST } = await import('@/app/api/kitchen/unlock/route')
    const res = await POST(postRequest({ milestone_key: 'm25', decoration_id: 'a1' }))
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: mockUser.id,
        name: 'a1',
        decoration_type: 'slot_a',
        milestone: 'm25',
      }),
    )
    expect(data).toEqual({ id: 'dec-1', name: 'a1', decoration_type: 'slot_a', milestone: 'm25' })
  })

  it('maps a raced double-tap (23505 unique violation) to 409', async () => {
    singleMock.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })
    mockRequireAuth.mockResolvedValue([supabaseWith(100, []), mockUser])

    const { POST } = await import('@/app/api/kitchen/unlock/route')
    const res = await POST(postRequest({ milestone_key: 'm25', decoration_id: 'a1' }))

    expect(res.status).toBe(409)
  })
})
