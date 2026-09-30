/**
 * @jest-environment node
 *
 * `POST /api/ai/meals/cook/confirm` (issue #654 §4 S7) — the meal confirm
 * proxy. Every award is keyed on the LOCAL date (#550) of the claim's own
 * instant (`cooked_at`, fixed by the claim and identical on a replay) in the
 * account's stored zone, and awarded on every 2xx including
 * `already_confirmed`, since the ledger's unique key dedupes a replay for free. Mirrors
 * `cook-confirm-route.test.ts` and `bubbles-award-call-sites.test.ts`'s
 * style for the recipe confirm proxy.
 */

/** Stored ledger zone (#550) - server-owned `app_metadata`. UTC keeps these fixtures' dates as written. */
const mockUser = {
  id: 'user-1',
  app_metadata: { ledger_tz: 'UTC', ledger_tz_set_at: '2026-01-01T00:00:00.000Z' },
}

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

const aiProxyFetchMock = jest.fn()
jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyFetch: (...args: unknown[]) => aiProxyFetchMock(...args),
}))

import { requireAuth } from '@/lib/response-helpers'
import { POST } from '@/app/api/ai/meals/cook/confirm/route'

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
  return new Request('http://localhost/api/ai/meals/cook/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function upstream(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

const successBody = {
  success: true,
  already_confirmed: false,
  deductions_applied: 1,
  deductions_requested: 1,
  deductions_skipped: [] as string[],
  recipes_marked_cooked: ['r1'],
  meal_times_cooked: 1,
  cooked_on: '2026-09-28',
  cooked_at: '2026-09-28T12:00:00.000Z',
}

describe('POST /api/ai/meals/cook/confirm', () => {
  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it("awards exactly one cook_confirm and one meal_bonus, keyed meal:<id>:<local date of the claim> — not the request's date", async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])
    aiProxyFetchMock.mockResolvedValue(upstream(successBody))

    const res = await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref-1', deductions: [], date: '2026-09-29' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(successBody)
    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'cook_confirm', 'meal:meal-1:2026-09-28')
    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'meal_bonus', 'meal:meal-1:2026-09-28')
  })

  it('rescue awards are de-duplicated, capped at 3 across the whole meal, keyed <pantry_item_id>:<local date of the claim>, and exclude deductions_skipped ids', async () => {
    const pantryItems = [
      { id: 'item-1', expiry_date: '2026-09-29' },
      { id: 'item-2', expiry_date: '2026-09-29' },
      { id: 'item-3', expiry_date: '2026-09-29' },
      { id: 'item-4', expiry_date: '2026-09-29' },
      { id: 'item-5', expiry_date: '2026-09-29' }, // refused — excluded (N4)
    ]
    mockRequireAuth.mockResolvedValue([makeSupabase(pantryItems), mockUser])
    aiProxyFetchMock.mockResolvedValue(
      upstream({ ...successBody, deductions_skipped: ['item-5'] }),
    )
    // The rescue judgement needs `date` to validate against the server's own
    // clock (±1 day) — pin "now" so '2026-09-28' validates regardless of the
    // real wall clock.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T00:00:00.000Z'))

    const res = await POST(
      makeRequest({
        meal_id: 'meal-1',
        cook_ref: 'ref-1',
        deductions: [
          { pantry_item_id: 'item-1', deduct_qty: 1, base_unit: 'g' },
          { pantry_item_id: 'item-1', deduct_qty: 1, base_unit: 'g' }, // duplicate id — de-duped
          { pantry_item_id: 'item-2', deduct_qty: 1, base_unit: 'g' },
          { pantry_item_id: 'item-3', deduct_qty: 1, base_unit: 'g' },
          { pantry_item_id: 'item-4', deduct_qty: 1, base_unit: 'g' },
          { pantry_item_id: 'item-5', deduct_qty: 1, base_unit: 'g' },
        ],
        date: '2026-09-28',
      }),
    )

    expect(res.status).toBe(200)
    const rescueCalls = (awardBubblesMock.mock.calls as unknown as [string, string, string][]).filter(
      (c) => c[1] === 'rescue',
    )
    expect(rescueCalls).toHaveLength(3)
    expect(rescueCalls.map((c) => c[2])).toEqual([
      'item-1:2026-09-28',
      'item-2:2026-09-28',
      'item-3:2026-09-28',
    ])
  })

  it('an already_confirmed replay awards again with the same refs', async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])
    aiProxyFetchMock.mockResolvedValue(upstream({ ...successBody, already_confirmed: true }))

    await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref-1', deductions: [] }))

    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'cook_confirm', 'meal:meal-1:2026-09-28')
    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'meal_bonus', 'meal:meal-1:2026-09-28')
  })

  it('a 2xx with no valid cooked_on awards nothing', async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])
    aiProxyFetchMock.mockResolvedValue(
      upstream({ ...successBody, cooked_on: 'not-a-date', cooked_at: 'not-an-instant' }),
    )

    const res = await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref-1', deductions: [] }))

    expect(res.status).toBe(200)
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })

  it('passes through a non-2xx (409 confirm_incomplete) with its body and status, and awards nothing', async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])
    const errBody = { detail: { error_kind: 'confirm_incomplete', message: "This cook started saving but didn't finish." } }
    aiProxyFetchMock.mockResolvedValue(upstream(errBody, false, 409))

    const res = await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref-1', deductions: [] }))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual(errBody)
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })

  it('an account with no known time zone still returns the confirm, but awards nothing (#550)', async () => {
    mockRequireAuth.mockResolvedValue([
      makeSupabase([{ id: 'item-1', expiry_date: '2026-09-29' }]),
      { id: 'user-1', app_metadata: {} },
    ])
    aiProxyFetchMock.mockResolvedValue(upstream(successBody))

    const res = await POST(
      makeRequest({
        meal_id: 'meal-1',
        cook_ref: 'ref-1',
        deductions: [{ pantry_item_id: 'item-1', deduct_qty: 1, base_unit: 'g' }],
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(successBody)
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })

  it("judges rescue eligibility on the account's local day, not the server's or a client-sent one (#550)", async () => {
    // 01:00Z on the 29th is still 18:00 on the 28th in Los Angeles. The item
    // expires on the 28th: a rescue on the user's day, already expired on the server's.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T01:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([
      makeSupabase([{ id: 'item-1', expiry_date: '2026-09-28' }]),
      {
        id: 'user-1',
        app_metadata: { ledger_tz: 'America/Los_Angeles', ledger_tz_set_at: '2026-09-20T00:00:00.000Z' },
      },
    ])
    aiProxyFetchMock.mockResolvedValue(
      upstream({ ...successBody, cooked_on: '2026-09-29', cooked_at: '2026-09-29T01:00:00.000Z' }),
    )

    await POST(
      makeRequest({
        meal_id: 'meal-1',
        cook_ref: 'ref-1',
        deductions: [{ pantry_item_id: 'item-1', deduct_qty: 1, base_unit: 'g' }],
        date: '2026-09-29', // a client claiming the server's day must not turn the rescue off
      }),
    )

    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'rescue', 'item-1:2026-09-28')
  })

  /**
   * Issue #550 — a meal's `cook_confirm` / `meal_bonus` / `rescue` keys come
   * from the account's LOCAL date of the claim's instant (`cooked_at`), not
   * the claim's UTC `cooked_on`, so one meal cooked either side of UTC
   * midnight on one local day pays once.
   */
  describe('keys on the account\'s local date of the claim (#550)', () => {
    const LA = {
      id: 'user-1',
      app_metadata: { ledger_tz: 'America/Los_Angeles', ledger_tz_set_at: '2026-09-20T00:00:00.000Z' },
    }

    function claimBody(cookedAt: string, extra: Record<string, unknown> = {}) {
      return { ...successBody, cooked_on: cookedAt.slice(0, 10), cooked_at: cookedAt, ...extra }
    }

    async function confirm(cookedAt: string, user: unknown = LA, extra: Record<string, unknown> = {}) {
      mockRequireAuth.mockResolvedValue([makeSupabase(), user])
      aiProxyFetchMock.mockResolvedValue(upstream(claimBody(cookedAt, extra)))
      await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref', deductions: [] }))
    }

    function refs(eventType: string): string[] {
      return (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>)
        .filter((call) => call[1] === eventType)
        .map((call) => call[2])
    }

    it('one meal cooked at 23:50Z and 00:10Z on the same local day pays on one key', async () => {
      // Two separate cooks (two claims): 16:50 and 17:10 in Los Angeles.
      await confirm('2026-09-23T23:50:00.000Z')
      await confirm('2026-09-24T00:10:00.000Z')

      expect(refs('cook_confirm')).toEqual(['meal:meal-1:2026-09-23', 'meal:meal-1:2026-09-23'])
      expect(refs('meal_bonus')).toEqual(['meal:meal-1:2026-09-23', 'meal:meal-1:2026-09-23'])
    })

    it('the same meal on two different local days pays on two keys', async () => {
      await confirm('2026-09-24T06:30:00.000Z') // 23:30 on the 23rd
      await confirm('2026-09-24T07:30:00.000Z') // 00:30 on the 24th

      expect(refs('cook_confirm')).toEqual(['meal:meal-1:2026-09-23', 'meal:meal-1:2026-09-24'])
    })

    it("a replay after local midnight lands on the first call's key (the claim's instant, not now)", async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-24T08:00:00.000Z')) // 01:00 on the 24th, LA
      await confirm('2026-09-23T23:50:00.000Z', LA, { already_confirmed: true })

      expect(refs('cook_confirm')).toEqual(['meal:meal-1:2026-09-23'])
    })

    it('a UTC-ahead account is keyed on its own day, which can be the day AFTER cooked_on', async () => {
      const tokyo = {
        id: 'user-1',
        app_metadata: { ledger_tz: 'Asia/Tokyo', ledger_tz_set_at: '2026-09-20T00:00:00.000Z' },
      }
      await confirm('2026-09-23T20:00:00.000Z', tokyo) // 05:00 on the 24th in Tokyo

      expect(refs('cook_confirm')).toEqual(['meal:meal-1:2026-09-24'])
    })

    it('a spoofed tz in the body cannot move the key', async () => {
      await confirm('2026-09-24T01:00:00.000Z', LA)
      mockRequireAuth.mockResolvedValue([makeSupabase(), LA])
      aiProxyFetchMock.mockResolvedValue(upstream(claimBody('2026-09-24T01:00:00.000Z')))
      await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref', deductions: [], tz: 'Pacific/Kiritimati' }))

      expect(new Set(refs('cook_confirm'))).toEqual(new Set(['meal:meal-1:2026-09-23']))
    })

    it('an older AI service that returns no cooked_at falls back to cooked_on, never blocking the award', async () => {
      mockRequireAuth.mockResolvedValue([makeSupabase(), LA])
      const legacy: Record<string, unknown> = claimBody('2026-09-24T01:00:00.000Z')
      delete legacy.cooked_at
      aiProxyFetchMock.mockResolvedValue(upstream(legacy))

      await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref', deductions: [] }))

      expect(refs('cook_confirm')).toEqual(['meal:meal-1:2026-09-24'])
    })
  })

  it('a JSON null body (review N5) is rejected with 400, and the upstream is never called', async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    const res = await POST(
      new Request('http://localhost/api/ai/meals/cook/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      }),
    )

    expect(res.status).toBe(400)
    expect(aiProxyFetchMock).not.toHaveBeenCalled()
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })

  it('a non-object JSON body (a bare string) is also rejected with 400', async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    const res = await POST(
      new Request('http://localhost/api/ai/meals/cook/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '"just a string"',
      }),
    )

    expect(res.status).toBe(400)
    expect(aiProxyFetchMock).not.toHaveBeenCalled()
  })

  it('reads the upstream body exactly once', async () => {
    let calls = 0
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])
    aiProxyFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        calls += 1
        if (calls > 1) throw new Error('body already consumed')
        return successBody
      },
    } as Response)

    const res = await POST(makeRequest({ meal_id: 'meal-1', cook_ref: 'ref-1', deductions: [] }))
    expect(res.status).toBe(200)
    expect(calls).toBe(1)
  })
})
