/**
 * @jest-environment node
 *
 * `PUT /api/profile/[id]` accepts `allergies` and `disliked_ingredients`
 * (issue #500): cleaned, validated, and written only for the signed-in user's row.
 */
import { PUT } from '@/app/api/profile/[id]/route'

const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

import { requireAuth } from '@/lib/response-helpers'

function makeSupabase(written: { updates?: Record<string, unknown>; eqs: Array<[string, unknown]> }) {
  const chain = {
    update: (updates: Record<string, unknown>) => {
      written.updates = updates
      return chain
    },
    eq: (column: string, value: unknown) => {
      written.eqs.push([column, value])
      return chain
    },
    select: () => chain,
    single: async () => ({ data: { id: 'profile-1', ...written.updates }, error: null }),
  }
  return { from: () => chain }
}

function put(body: unknown) {
  return PUT(
    new Request('http://localhost/api/profile/profile-1', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'profile-1' }) },
  )
}

describe('PUT /api/profile/[id] allergies and dislikes (#500)', () => {
  let written: { updates?: Record<string, unknown>; eqs: Array<[string, unknown]> }

  beforeEach(() => {
    written = { eqs: [] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabase(written), mockUser])
  })

  it('writes both lists, cleaned, scoped to the signed-in user', async () => {
    const res = await put({
      allergies: ['  Peanut ', 'peanut', ''],
      disliked_ingredients: ['cilantro'],
    })

    expect(res.status).toBe(200)
    expect(written.updates).toEqual({
      allergies: ['Peanut'],
      disliked_ingredients: ['cilantro'],
    })
    expect(written.eqs).toContainEqual(['user_id', 'user-1'])
  })

  it('writes only the field that was sent', async () => {
    await put({ disliked_ingredients: ['olives'] })
    expect(written.updates).toEqual({ disliked_ingredients: ['olives'] })
  })

  it('can clear a list', async () => {
    await put({ allergies: [] })
    expect(written.updates).toEqual({ allergies: [] })
  })

  it('answers 400 for a value that is not a list of strings, and writes nothing', async () => {
    const res = await put({ allergies: 'peanut' })

    expect(res.status).toBe(400)
    expect(written.updates).toBeUndefined()
  })
})
