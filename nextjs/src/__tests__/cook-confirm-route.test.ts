/**
 * @jest-environment node
 *
 * `POST /api/ai/recipes/cook/confirm` \u2014 regression tests for two review
 * findings on the #524 rescue-bonus PR:
 *
 * 1. The `cook_confirm` award predates #524 and must stay unconditional on
 *    `recipe_id` \u2014 a client running stale JS that never sends `date` at all
 *    must still get it (only the new `rescue` bonus is allowed to depend on
 *    a usable client-local date).
 * 2. `cook_confirm`'s ref_key must stay keyed on the *server's* UTC date
 *    (its pre-#524 form), not the client-supplied one \u2014 otherwise a client
 *    could mint two awards for one cook by sending yesterday's date on one
 *    confirm and today's on the next.
 */

const mockUser = { id: 'user-1' }

const awardBubblesMock = jest.fn(async () => 10)
jest.mock('@/lib/bubbles', () => ({
  awardBubbles: awardBubblesMock,
  RESCUE_CAP_PER_COOK: 3,
}))

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

const aiProxyJsonMock = jest.fn(
  async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
)
jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyJson: aiProxyJsonMock,
}))

import { requireAuth } from '@/lib/response-helpers'
import { POST } from '@/app/api/ai/recipes/cook/confirm/route'

const mockRequireAuth = requireAuth as jest.Mock

function makeSupabase(rows: Array<{ id: string; expiry_date: string | null }> = []) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/ai/recipes/cook/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('cook/confirm cook_confirm award (#524 review)', () => {
  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('still awards cook_confirm, keyed on the server date, when the client sends no date at all', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    const res = await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [] }))

    expect(res.status).toBe(200)
    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'cook_confirm', 'recipe-1:2026-08-26')
  })

  it('keys two confirms of the same recipe (client dates yesterday, then today) to the same server-dated ref_key', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-08-25' }))
    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-08-26' }))

    const cookConfirmCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'cook_confirm',
    )
    expect(cookConfirmCalls).toHaveLength(2)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-08-26')
    expect(cookConfirmCalls[1][2]).toBe('recipe-1:2026-08-26')
  })

  it("judges rescue eligibility on the client's local day, not the server's UTC day", async () => {
    // 18:00 at UTC-7 on 2026-09-23 is already 2026-09-24 01:00 UTC. The item
    // expires 2026-09-23: on the user's day it's the last day (0 left, a
    // rescue); on the server's day it would already be expired (no rescue).
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T01:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([
      makeSupabase([{ id: 'item-1', expiry_date: '2026-09-23' }]),
      mockUser,
    ])

    await POST(
      makeRequest({
        recipe_id: 'recipe-1',
        deductions: [{ pantry_item_id: 'item-1', deduct_qty: 1 }],
        date: '2026-09-23',
      }),
    )

    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'rescue', 'item-1:2026-09-23')
  })
})
