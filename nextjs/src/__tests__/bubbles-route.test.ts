/**
 * @jest-environment node
 *
 * Tests for `GET /api/bubbles` (issue #520): awards the daily visit, then
 * returns the balance (0 when the user has no row) and recent events.
 */

const mockUser = { id: 'user-1' }

const upsertMock = jest.fn(() => ({
  select: async () => ({ data: [{ id: 'evt-1' }], error: null }),
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}))

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
}))

import { requireAuth } from '@/lib/response-helpers'

const mockRequireAuth = requireAuth as jest.Mock

describe('GET /api/bubbles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsertMock.mockImplementation(() => ({
      select: async () => ({ data: [{ id: 'evt-1' }], error: null }),
    }))
  })

  it('requires a date query param', async () => {
    mockRequireAuth.mockResolvedValue([{}, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request('http://localhost/api/bubbles'))

    expect(res.status).toBe(400)
  })

  it('returns balance 0 when the user has no bubble_balances row', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'bubble_balances') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
        }
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
          }),
        }
      },
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request('http://localhost/api/bubbles?date=2026-09-22'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ balance: 0, recent: [] })
    expect(upsertMock).toHaveBeenCalled()
  })

  it('returns the balance and recent events when present', async () => {
    const recentEvents = [{ id: 'evt-1', event_type: 'pantry_add', amount: 2 }]
    const supabase = {
      from: (table: string) => {
        if (table === 'bubble_balances') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance: 42 } }) }) }),
          }
        }
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: async () => ({ data: recentEvents }) }) }),
          }),
        }
      },
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const { GET } = await import('@/app/api/bubbles/route')
    const res = await GET(new Request('http://localhost/api/bubbles?date=2026-09-22'))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ balance: 42, recent: recentEvents })
  })
})
