/**
 * @jest-environment node
 *
 * `POST /api/pantry/[id]/resolve` \u2014 regression tests for the #524 review
 * finding that rescue eligibility (and the `days_until_expiry` written to
 * `pantry_events`) used the *server's* UTC day (`daysUntilExpiry`, anchored
 * on `new Date()` \u2014 UTC on Vercel) instead of the client's own local day.
 * Forcing `process.env.TZ = 'UTC'` here makes this Jest process behave like
 * the Vercel server the bug was about, regardless of the host machine's own
 * timezone \u2014 the client's local date is passed explicitly as a YYYY-MM-DD
 * string either way and never depends on either clock.
 *
 * Issue #550 tightened `validateClientDate` to an exact match against the
 * offset-derived local date (no more \u00b11 day tolerance), so these requests
 * now also send the `tz_offset_minutes` that actually justifies the
 * UTC-7 client scenario the tests describe \u2014 without it, a date one day
 * behind the server's own UTC date is simply refused.
 */

process.env.TZ = 'UTC'

const mockUser = { id: 'user-1' }

const awardBubblesMock = jest.fn(async () => 8)
jest.mock('@/lib/bubbles', () => ({
  awardBubbles: awardBubblesMock,
}))

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

import { requireAuth } from '@/lib/response-helpers'
import { POST } from '@/app/api/pantry/[id]/resolve/route'

const mockRequireAuth = requireAuth as jest.Mock

function makeSupabase(item: Record<string, unknown>, insertMock: jest.Mock) {
  return {
    from: (table: string) => {
      if (table === 'pantry_items') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: item, error: null }),
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

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/pantry/item-1/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('resolve rescue eligibility uses the client-local day (#524 review)', () => {
  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('awards rescue and records days_until_expiry = 0 (not -1) when resolving at 18:00 local on the expiry day, even though the server UTC day has already rolled over', async () => {
    // Server's UTC clock reads 2026-08-26 01:00 \u2014 already the next calendar
    // day \u2014 which is what a UTC-7 client sees as 2026-08-25 18:00 local, the
    // expiry day itself. The old server-anchored calc would read this as
    // already-expired (-1); the client-local one must read it as due today (0).
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T01:00:00.000Z'))
    const insertMock = jest.fn(async () => ({ error: null }))
    const item = { id: 'item-1', name: 'Milk', quantity: 1, unit: 'carton', expiry_date: '2026-08-25' }
    mockRequireAuth.mockResolvedValue([makeSupabase(item, insertMock), mockUser])

    const res = await POST(makeRequest({ outcome: 'used', date: '2026-08-25', tz_offset_minutes: -420 }), {
      params: Promise.resolve({ id: 'item-1' }),
    })

    expect(res.status).toBe(200)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ days_until_expiry: 0 }),
    )
    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'rescue', 'item-1:2026-08-25')
  })

  it('does not award rescue for an item 4 days out by the client-local date, even though the server UTC day alone would call it 3', async () => {
    // Same server clock skew as above (server UTC day one ahead of the
    // client's local day), but the item is genuinely 4 days out by the
    // client's own calendar \u2014 outside the 0-3 day rescue window \u2014 so this
    // must never rescue, however the server-only calc would have read it.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T01:00:00.000Z'))
    const insertMock = jest.fn(async () => ({ error: null }))
    const item = { id: 'item-2', name: 'Yogurt', quantity: 1, unit: 'cup', expiry_date: '2026-08-29' }
    mockRequireAuth.mockResolvedValue([makeSupabase(item, insertMock), mockUser])

    const res = await POST(makeRequest({ outcome: 'used', date: '2026-08-25', tz_offset_minutes: -420 }), {
      params: Promise.resolve({ id: 'item-2' }),
    })

    expect(res.status).toBe(200)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ days_until_expiry: 4 }),
    )
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })
})
