/**
 * @jest-environment node
 *
 * Tests for `GET /api/kitchen/offer` (issue #522), mirroring the mocking
 * style in `bubbles-route.test.ts`.
 */

const mockUser = { id: 'user-1' }

// A small fixed catalog so "every slot occupied" and "has an offer" are easy
// to construct without needing the whole real catalog's 12 slots filled.
jest.mock('@/lib/kitchen/catalog', () => ({
  CATALOG: [
    { id: 'a1', name: 'A1', slot: 'slot_a', emoji: '🅰️' },
    { id: 'b1', name: 'B1', slot: 'slot_b', emoji: '🅱️' },
  ],
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

describe('GET /api/kitchen/offer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when the balance has reached no milestone', async () => {
    mockRequireAuth.mockResolvedValue([supabaseWith(0, []), mockUser])

    const { GET } = await import('@/app/api/kitchen/offer/route')
    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toBeNull()
  })

  it('returns null when every slot is occupied (nothing left to offer)', async () => {
    mockRequireAuth.mockResolvedValue([
      supabaseWith(300, [
        { name: 'a1', decoration_type: 'slot_a', milestone: 'm25' },
        { name: 'b1', decoration_type: 'slot_b', milestone: 'm60' },
      ]),
      mockUser,
    ])

    const { GET } = await import('@/app/api/kitchen/offer/route')
    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toBeNull()
  })

  it('returns the oldest pending milestone\'s options when available', async () => {
    // Balance 65 reaches m25 and m60, neither claimed — m25 is oldest pending
    // and both catalog entries are still eligible.
    mockRequireAuth.mockResolvedValue([supabaseWith(65, []), mockUser])

    const { GET } = await import('@/app/api/kitchen/offer/route')
    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.milestone_key).toBe('m25')
    expect(data.threshold).toBe(25)
    expect(data.options.map((o: { id: string }) => o.id).sort()).toEqual(['a1', 'b1'])
  })

  it('propagates a decorations read error', async () => {
    mockRequireAuth.mockResolvedValue([
      {
        from: (table: string) => {
          if (table === 'bubble_balances') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { balance: 100 } }) }) }) }
          }
          return { select: () => ({ eq: async () => ({ data: null, error: { message: 'boom' } }) }) }
        },
      },
      mockUser,
    ])

    const { GET } = await import('@/app/api/kitchen/offer/route')
    const res = await GET()

    expect(res.status).toBe(500)
  })
})
