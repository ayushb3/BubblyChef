/**
 * @jest-environment node
 *
 * Issue #682: the Next.js update routes read the row back with
 * `.update().select().single()`. When the row doesn't exist (deleted, or
 * another user's), PostgREST reports zero rows as PGRST116, and the route used
 * to forward that as a 500 before its own "not found" branch could run.
 *
 * Each route must answer 404 for a missing row, and must keep answering 500
 * for any other database error (a real failure must not masquerade as a
 * missing row).
 */
const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

jest.mock('@/lib/api/ai-proxy', () => ({
  normalizeBaseUnit: jest.fn(async () => ({ quantity_base: null, unit_base: null })),
}))

jest.mock('@/lib/bubbles', () => ({
  awardBubbles: jest.fn(),
}))

import { requireAuth } from '@/lib/response-helpers'
import { PUT as pantryPUT } from '@/app/api/pantry/[id]/route'
import { PATCH as slotPATCH } from '@/app/api/pantry/[id]/slot/route'
import { PUT as profilePUT } from '@/app/api/profile/[id]/route'
import { PUT as recipesPUT } from '@/app/api/recipes/[id]/route'

type DbError = { code?: string; message: string }

const NO_ROW: DbError = {
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
}

/**
 * A Supabase stand-in where every chain ends in `.single()` / `.maybeSingle()`
 * and resolves to the given outcome. PostgREST reports a missing row as an
 * error only from `.single()`; `.maybeSingle()` resolves `{ data: null }`, so
 * the stub behaves the same way for either terminal.
 */
function makeSupabase(outcome: { data: unknown; error: DbError | null }) {
  const terminal = {
    single: async () => outcome,
    maybeSingle: async () =>
      outcome.error?.code === 'PGRST116' ? { data: null, error: null } : outcome,
  }
  const chain: Record<string, unknown> = {
    ...terminal,
    eq: () => chain,
    select: () => chain,
    update: () => chain,
  }
  return { from: () => chain }
}

const params = Promise.resolve({ id: 'does-not-exist' })

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/x', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const routes: Array<{
  name: string
  call: () => Promise<Response>
}> = [
  {
    name: 'PUT /api/pantry/[id]',
    // `slot_index` only: skips the read-first normalisation branch, so this
    // exercises the update's own `.single()`.
    call: () => pantryPUT(jsonRequest({ slot_index: 2 }), { params }),
  },
  {
    name: 'PATCH /api/pantry/[id]/slot',
    call: () =>
      slotPATCH(new Request('http://localhost/api/pantry/x/slot?slot_index=2', { method: 'PATCH' }), {
        params,
      }),
  },
  {
    name: 'PUT /api/profile/[id]',
    call: () => profilePUT(jsonRequest({ display_name: 'Ghost' }), { params }),
  },
  {
    name: 'PUT /api/recipes/[id]',
    call: () => recipesPUT(jsonRequest({ title: 'Ghost' }), { params }),
  },
]

afterEach(() => {
  jest.clearAllMocks()
})

describe.each(routes)('$name', ({ call }) => {
  it('returns 404 when the row does not exist (PGRST116)', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabase({ data: null, error: NO_ROW }),
      mockUser,
    ])

    const res = await call()

    expect(res.status).toBe(404)
  })

  it('still returns 500 for any other database error', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabase({ data: null, error: { code: '57014', message: 'statement timeout' } }),
      mockUser,
    ])

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'statement timeout' })
  })

  it('returns 200 with the row when it exists', async () => {
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabase({ data: { id: 'r1', name: 'x', quantity: 1, unit: 'g' }, error: null }),
      mockUser,
    ])

    const res = await call()

    expect(res.status).toBe(200)
  })
})
