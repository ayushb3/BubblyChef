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

  it("judges rescue eligibility on the client's local day, not the server's UTC day — but keys the award on the server day", async () => {
    // 18:00 at UTC-7 on 2026-09-23 is already 2026-09-24 01:00 UTC. The item
    // expires 2026-09-23: on the user's day it's the last day (0 left, a
    // rescue); on the server's day it would already be expired (no rescue).
    // The eligibility judgement uses the client's date (2026-09-23), so the
    // rescue still fires — but the ref_key uses the server's date
    // (2026-09-24), same as cook_confirm, not the client's.
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

    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'rescue', 'item-1:2026-09-24')
  })

  it('cannot mint two rescue awards for one deduction by replaying the confirm with a different client date (#570 review)', async () => {
    // validateClientDate tolerates ±1 day of skew, so a naive client-keyed
    // ref_key would let a retried/duplicated confirm of the *same* cook —
    // same recipe, same deducted item — mint a second rescue by sending
    // yesterday's date on one call and today's on the next.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([
      makeSupabase([{ id: 'item-1', expiry_date: '2026-08-27' }]),
      mockUser,
    ])

    await POST(
      makeRequest({
        recipe_id: 'recipe-1',
        deductions: [{ pantry_item_id: 'item-1', deduct_qty: 1 }],
        date: '2026-08-25',
      }),
    )
    await POST(
      makeRequest({
        recipe_id: 'recipe-1',
        deductions: [{ pantry_item_id: 'item-1', deduct_qty: 1 }],
        date: '2026-08-26',
      }),
    )

    const rescueCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'rescue',
    )
    expect(rescueCalls).toHaveLength(2)
    expect(rescueCalls[0][2]).toBe('item-1:2026-08-26')
    expect(rescueCalls[1][2]).toBe('item-1:2026-08-26')
  })
})

/**
 * Refused rows earn no rescue (#671). The microservice lists rows it refused to
 * deduct in `deductions_skipped`; they never left the pantry, so they haven't
 * been rescued from anything. The meal proxy already excludes them.
 */
describe('cook/confirm excludes refused rows from the rescue bonus (#671)', () => {
  const twoExpiring = [
    { id: 'item-1', expiry_date: '2026-08-27' },
    { id: 'item-2', expiry_date: '2026-08-27' },
  ]
  const twoDeductions = [
    { pantry_item_id: 'item-1', deduct_qty: 1 },
    { pantry_item_id: 'item-2', deduct_qty: 1 },
  ]

  function rescueRefs(): string[] {
    return (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>)
      .filter((call) => call[1] === 'rescue')
      .map((call) => call[2])
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(twoExpiring), mockUser])
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('awards a rescue only for the row the server did not refuse', async () => {
    aiProxyJsonMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, deductions_skipped: ['item-1'] }), {
        status: 200,
      }),
    )

    await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: twoDeductions, date: '2026-08-26' }),
    )

    expect(rescueRefs()).toEqual(['item-2:2026-08-26'])
  })

  it('a body with no deductions_skipped awards a rescue for every expiring row (guard)', async () => {
    await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: twoDeductions, date: '2026-08-26' }),
    )

    expect(rescueRefs().sort()).toEqual(['item-1:2026-08-26', 'item-2:2026-08-26'])
  })

  it('a non-JSON upstream body does not break the award or the response', async () => {
    aiProxyJsonMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))

    const res = await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: twoDeductions, date: '2026-08-26' }),
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('not json')
    expect(rescueRefs()).toHaveLength(2)
  })

  it('forwards the upstream body byte-identical, still readable by the caller', async () => {
    const upstream = JSON.stringify({ success: true, deductions_skipped: ['item-1'], extra: [1, 2] })
    aiProxyJsonMock.mockResolvedValueOnce(new Response(upstream, { status: 200 }))

    const res = await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: twoDeductions, date: '2026-08-26' }),
    )

    expect(await res.text()).toBe(upstream)
  })
})
