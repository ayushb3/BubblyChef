/**
 * @jest-environment node
 *
 * Issue #654 — `POST /api/ai/meals/cook/confirm` still returns the upstream
 * 200 body, unchanged, when the bubbles award insert throws. Unlike
 * `meal-cook-confirm-route.test.ts` (which mocks `@/lib/bubbles` directly for
 * speed), this exercises the *real* `awardBubbles` / `awardCookBubbles` chain
 * against a Supabase client mocked to throw on `upsert`, the same
 * end-to-end style `bubbles-award-call-sites.test.ts` uses for every other
 * award call site — the guarantee this proves (a bubbles outage never blocks
 * the route's own response) lives in `awardBubbles`'s own try/catch, not in
 * anything this route does defensively.
 */

const mockUser = { id: 'user-1' }

const upsertMock = jest.fn(() => {
  throw new Error('bubble_events insert boom')
})

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}))

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

const upstreamBody = {
  success: true,
  already_confirmed: false,
  deductions_applied: 1,
  deductions_requested: 1,
  deductions_skipped: [] as string[],
  recipes_marked_cooked: ['r1'],
  meal_times_cooked: 1,
  cooked_on: '2026-09-29',
}

jest.mock('@/lib/api/ai-proxy', () => ({
  aiProxyFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => upstreamBody })),
}))

import { requireAuth } from '@/lib/response-helpers'
import { POST } from '@/app/api/ai/meals/cook/confirm/route'

const mockRequireAuth = requireAuth as jest.Mock

describe('POST /api/ai/meals/cook/confirm — an award failure never changes the response', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsertMock.mockImplementation(() => {
      throw new Error('bubble_events insert boom')
    })
  })

  it('still returns the upstream 200 body, unchanged, when the bubbles insert throws', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }
    mockRequireAuth.mockResolvedValue([supabase, mockUser])

    const res = await POST(
      new Request('http://localhost/api/ai/meals/cook/confirm', {
        method: 'POST',
        body: JSON.stringify({ meal_id: 'meal-1', cook_ref: 'ref-1', deductions: [] }),
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(upstreamBody)
    // The real chain really did attempt the award (and really did fail) —
    // this isn't passing because nothing was attempted.
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'cook_confirm', ref_key: 'meal:meal-1:2026-09-29' }),
      expect.anything(),
    )
  })
})
