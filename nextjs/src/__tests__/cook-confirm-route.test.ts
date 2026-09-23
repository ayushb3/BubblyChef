/**
 * @jest-environment node
 *
 * `POST /api/ai/recipes/cook/confirm` \u2014 regression tests for review findings
 * on the #524 rescue-bonus PR, amended by issue #550, amended again by the
 * #595 PR review:
 *
 * 1. `cook_confirm` and `rescue` key on `validDate` \u2014 the client's local date
 *    checked exactly against the offset-derived local date
 *    (`validateClientDate` in `lib/date.ts`) \u2014 when there is one. With no
 *    usable date, both are SKIPPED, never fallback-keyed to the server's UTC
 *    date (an earlier revision's fallback reopened a double pay of its own:
 *    one confirm with a valid local date pays `<recipe>:<localDate>`, a
 *    second confirm of the same cook with a missing date pays a DIFFERENT
 *    fallback key). The cook DEDUCTION is never gated on the date either way.
 * 2. **#595 review, the actual fix**: `validDate`'s "exact match" is exact
 *    only relative to `tz_offset_minutes`, which is client-supplied \u2014 a
 *    fabricated offset makes ANY date "the" caller's exact local date, so
 *    keying alone (matching or not) cannot be what prevents a double pay.
 *    The real boundary is a 20h cooldown on the server's own `created_at`
 *    for this recipe's `cook_confirm` awards (`mostRecentEventCreatedAt` +
 *    `isRateLimited` in `lib/bubbles.ts`): at most one `cook_confirm` per
 *    recipe per ~20h, independent of what ref_key any individual call's date
 *    would produce. The tests below use a NON-UTC offset fixture (UTC-7)
 *    specifically because a UTC/offset-0 fixture makes `validDate` and the
 *    (now-removed) server-UTC fallback collide, which is exactly what made
 *    the pre-review version of this test pass for the wrong reason.
 */

const mockUser = { id: 'user-1' }

const awardBubblesMock = jest.fn(async () => 10)
// `null` by default (no prior event of this type) — individual tests override
// with `mockResolvedValueOnce` to simulate a recent prior award. `isRateLimited`
// is the REAL, pure implementation (imported via `requireActual`), not mocked —
// its correctness given a `created_at` is exactly what these tests are pinning.
const mostRecentEventCreatedAtMock = jest.fn(async () => null as string | null)
jest.mock('@/lib/bubbles', () => {
  const actual = jest.requireActual('@/lib/bubbles')
  return {
    ...actual,
    awardBubbles: awardBubblesMock,
    RESCUE_CAP_PER_COOK: 3,
    mostRecentEventCreatedAt: mostRecentEventCreatedAtMock,
  }
})

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

  it('awards cook_confirm exactly once when a valid-date confirm is followed by a no-date confirm of the same cook (non-UTC fixture, order: valid then missing)', async () => {
    // UTC-7 fixture (not offset 0) — see the file header on why a UTC
    // fixture makes this assertion pass for the wrong reason. The no-date
    // second call is skipped for its own reason (no `validDate` at all, so
    // `mostRecentEventCreatedAt` for cook_confirm is never even queried) —
    // this pins that skip, not the cooldown; the cooldown itself is pinned
    // separately below with two calls that BOTH have a valid (but
    // different) date.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T01:00:00.000Z')) // 2026-09-23 18:00 local at UTC-7
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-09-23', tz_offset_minutes: -420 }),
    )
    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [] }))

    const cookConfirmCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'cook_confirm',
    )
    expect(cookConfirmCalls).toHaveLength(1)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-09-23')
  })

  it('awards cook_confirm exactly once when a no-date confirm is followed by a valid-date confirm of the same cook (non-UTC fixture, order: missing then valid)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-24T01:00:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    await POST(makeRequest({ recipe_id: 'recipe-1', deductions: [] }))
    await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-09-23', tz_offset_minutes: -420 }),
    )

    const cookConfirmCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'cook_confirm',
    )
    expect(cookConfirmCalls).toHaveLength(1)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-09-23')
  })

  it("refuses a second cook_confirm within 20h for the same recipe even when the second call's valid date is a DIFFERENT key (#595 review findings 2 & 3: keying alone can't prevent this, only the cooldown does)", async () => {
    // Both calls send a genuinely "valid" date per `validateClientDate` —
    // the first honestly (UTC-7), the second via a different offset that
    // makes the NEXT calendar day the "exact" local date, exactly the
    // offset-fabrication finding 1 describes. Without the cooldown these
    // would be two different ref_keys and both would pay.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T23:30:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    // First confirm: honest UTC-7 client. No prior cook_confirm exists yet.
    mostRecentEventCreatedAtMock.mockResolvedValueOnce(null)
    await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-09-23', tz_offset_minutes: -420 }),
    )

    // Second confirm, 10 minutes later (well inside the 20h cooldown) — a
    // fabricated offset (+30) makes '2026-09-24' the exact expected local
    // date. Simulate the first award as the most recent cook_confirm row
    // for this recipe, ~10 minutes old.
    jest.setSystemTime(new Date('2026-09-23T23:40:00.000Z'))
    mostRecentEventCreatedAtMock.mockResolvedValueOnce(new Date('2026-09-23T23:30:05.000Z').toISOString())
    await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-09-24', tz_offset_minutes: 30 }),
    )

    const cookConfirmCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'cook_confirm',
    )
    expect(cookConfirmCalls).toHaveLength(1)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-09-23')
  })

  it('allows a new cook_confirm for the same recipe once the 20h cooldown has elapsed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T23:30:00.000Z'))
    mockRequireAuth.mockResolvedValue([makeSupabase(), mockUser])

    // The most recent cook_confirm for this recipe was 21 hours ago — past
    // the 20h cooldown — so a new one is allowed.
    mostRecentEventCreatedAtMock.mockResolvedValueOnce(
      new Date('2026-09-23T02:30:00.000Z').toISOString(),
    )
    await POST(
      makeRequest({ recipe_id: 'recipe-1', deductions: [], date: '2026-09-23', tz_offset_minutes: -420 }),
    )

    const cookConfirmCalls = (awardBubblesMock.mock.calls as unknown as Array<[string, string, string]>).filter(
      (call) => call[1] === 'cook_confirm',
    )
    expect(cookConfirmCalls).toHaveLength(1)
    expect(cookConfirmCalls[0][2]).toBe('recipe-1:2026-09-23')
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
