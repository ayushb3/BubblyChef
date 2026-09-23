/**
 * @jest-environment node
 *
 * `POST /api/ai/recipes/cook/confirm` \u2014 regression tests for review findings
 * on the #524 rescue-bonus PR, amended by issue #550:
 *
 * 1. Issue #550 tightened `validateClientDate` from tolerating \u00b11 day of
 *    clock skew (its #520/#524/#570 form) to requiring an EXACT match
 *    against the offset-derived local date. Both `cook_confirm` and
 *    `rescue` key on that single accepted local date (`validDate`) \u2014 this is
 *    what actually fixes the UTC-midnight double pay this issue was filed
 *    for (two confirms of one recipe at 23:50 and 00:10 UTC, same local day,
 *    now share one `validDate` and pay once).
 * 2. Issue #550 review: `cook_confirm` was going to fall back to the
 *    server's UTC date when the client sent no usable date, same as its
 *    pre-#524 form \u2014 but that fallback reopens a double pay of its own: one
 *    confirm with a valid local date pays `<recipe>:<localDate>`, and a
 *    SECOND confirm of the same cook with a missing/invalid date pays the
 *    fallback `<recipe>:<utcDate>` \u2014 two awards for one cook whenever the
 *    client's local day and the server's UTC day disagree (every evening in
 *    the Americas). The app always sends a date, so `cook_confirm` now SKIPS
 *    the award entirely without a usable `validDate`, exactly like `rescue`
 *    already did \u2014 no server-UTC fallback for either award. The cook
 *    DEDUCTION itself is never gated on the date either way.
 * 3. The old "send yesterday's date on one confirm, today's on the next"
 *    double-pay this suite originally guarded against is now closed by
 *    `validateClientDate` itself: an invalid date is flatly refused
 *    (`validDate` is `null`, so the award is skipped) rather than tolerated
 *    and collapsed onto the server's date.
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

  it('still deducts (2xx) but SKIPS the cook_confirm award when the client sends no date at all (#550)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    const res = await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [] }))

    expect(res.status).toBe(200)
    expect(awardBubblesMock).not.toHaveBeenCalledWith(
      mockUser.id,
      'cook_confirm',
      expect.anything(),
    )
  })

  it("awards cook_confirm exactly once when a valid-date confirm is followed by a no-date confirm of the same cook (#550: the fallback this replaces would have paid twice)", async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-08-26' }))
    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [] }))

    const cookConfirmCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'cook_confirm',
    )
    expect(cookConfirmCalls).toHaveLength(1)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-08-26')
  })

  it("awards cook_confirm only once, on the second call, when the client sends yesterday's (refused) date, then today's, for the same cook", async () => {
    // The old ±1 day tolerance is what let this scenario collapse onto one
    // server-dated key; #550 refuses yesterday's date outright, so the
    // first call is simply skipped (no award, no key at all) and only the
    // second (valid) call awards.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-08-25' }))
    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-08-26' }))

    const cookConfirmCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'cook_confirm',
    )
    expect(cookConfirmCalls).toHaveLength(1)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-08-26')
  })

  it("judges rescue eligibility on the client's accepted local day and keys BOTH cook_confirm and rescue on it, not the server's UTC day (#550)", async () => {
    // 18:00 at UTC-7 on 2026-09-23 is already 2026-09-24 01:00 UTC. The item
    // expires 2026-09-23: on the user's day it's the last day (0 left, a
    // rescue); on the server's day it would already be expired (no rescue).
    // With a correct tz_offset_minutes, '2026-09-23' is the ONE date
    // validateClientDate accepts (issue #550 — exact match, no ±1 day
    // tolerance), so both the eligibility judgement AND both ref_keys use
    // it, not the server's UTC date.
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
        tz_offset_minutes: -420,
      }),
    )

    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'cook_confirm', 'recipe-1:2026-09-23')
    expect(awardBubblesMock).toHaveBeenCalledWith(mockUser.id, 'rescue', 'item-1:2026-09-23')
  })

  it('two confirms of one recipe at 23:50 and 00:10 UTC that fall on the same local day key cook_confirm to the same ref_key (#550 acceptance criterion)', async () => {
    // UTC-1: 2026-08-25T23:50Z is 2026-08-25T22:50 local; 2026-08-26T00:10Z
    // is 2026-08-25T23:10 local — both the same local calendar day, even
    // though they straddle UTC midnight. Both confirms must key
    // `cook_confirm` on that one shared local date.
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T23:50:00.000Z'))
    await POST(
      makeRequest({
        recipe_id: 'recipe-1',
        deductions: [],
        date: '2026-08-25',
        tz_offset_minutes: -60,
      }),
    )

    jest.setSystemTime(new Date('2026-08-26T00:10:00.000Z'))
    await POST(
      makeRequest({
        recipe_id: 'recipe-1',
        deductions: [],
        date: '2026-08-25',
        tz_offset_minutes: -60,
      }),
    )

    const cookConfirmCalls = (
      awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>
    ).filter((call) => call[1] === 'cook_confirm')
    expect(cookConfirmCalls).toHaveLength(2)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-08-25')
    expect(cookConfirmCalls[1][2]).toBe('recipe-1:2026-08-25')
  })

  it('does not award rescue at all when the client date is invalid, rather than falling back to a server-dated key (#550)', async () => {
    // Rescue's eligibility judgement needs a real client-local date — unlike
    // cook_confirm, it has no safe server-UTC fallback, so an invalid date
    // just skips the rescue bonus for that call.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([
      makeSupabase([{ id: 'item-1', expiry_date: '2026-08-27' }]),
      mockUser,
    ])

    await POST(
      makeRequest({
        recipe_id: 'recipe-1',
        deductions: [{ pantry_item_id: 'item-1', deduct_qty: 1 }],
        date: '2026-08-25', // mismatches the offset-derived local date (2026-08-26)
      }),
    )

    const rescueCalls = (
      awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>
    ).filter((call) => call[1] === 'rescue')
    expect(rescueCalls).toHaveLength(0)
  })
})
