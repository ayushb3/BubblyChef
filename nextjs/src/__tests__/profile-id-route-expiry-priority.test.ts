/**
 * @jest-environment node
 *
 * `PUT /api/profile/[id]` accepts `expiry_priority` (issue #502): one of
 * off / gentle / aggressive, written only for the signed-in user's row. Anything else is a
 * 400, never a best-effort save.
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

describe('PUT /api/profile/[id] expiry_priority (#502)', () => {
  let written: { updates?: Record<string, unknown>; eqs: Array<[string, unknown]> }

  beforeEach(() => {
    written = { eqs: [] }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeSupabase(written), mockUser])
  })

  it.each(['off', 'gentle', 'aggressive'])('writes %s, scoped to the signed-in user', async (level) => {
    const res = await put({ expiry_priority: level })

    expect(res.status).toBe(200)
    expect(written.updates).toEqual({ expiry_priority: level })
    expect(written.eqs).toEqual([
      ['id', 'profile-1'],
      ['user_id', 'user-1'],
    ])
  })

  it.each(['maximum', '', 'OFF', 3, null, ['gentle']])('rejects %p with a 400 and writes nothing', async (bad) => {
    const res = await put({ expiry_priority: bad })

    expect(res.status).toBe(400)
    expect(written.updates).toBeUndefined()
  })

  it('leaves expiry_priority out of the update when the body does not carry it', async () => {
    await put({ display_name: 'Bubbles' })

    expect(written.updates).toEqual({ display_name: 'Bubbles' })
  })
})
