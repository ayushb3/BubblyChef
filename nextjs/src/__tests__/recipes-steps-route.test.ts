/**
 * @jest-environment node
 *
 * Tests for structured recipe steps (issue #648) on the Next.js recipes CRUD
 * routes:
 *  - `POST /api/recipes` persists a `steps` payload alongside `instructions`.
 *  - `PUT /api/recipes/[id]` clears `steps` when the instruction text
 *    actually changes, and leaves it alone on a same-content resave (the
 *    common case — `RecipeEditModal` always resends the full array).
 */
const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

const awardBubblesMock = jest.fn()
jest.mock('@/lib/bubbles', () => ({
  awardBubbles: awardBubblesMock,
}))

import { requireAuth } from '@/lib/response-helpers'
import { POST } from '@/app/api/recipes/route'
import { PUT } from '@/app/api/recipes/[id]/route'

const STEPS = [
  {
    text: 'Boil the pasta.',
    label: 'Boil the pasta',
    ongoing_label: 'the pasta boils',
    duration_minutes: 10,
    duration_estimated: false,
    hands_on: false,
    depends_on: [],
    exclusive: [],
  },
]

afterEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/recipes persists structured steps (#648)', () => {
  function makeInsertSupabase(storedInsert: { current: Record<string, unknown> }) {
    return {
      from: () => ({
        insert: (values: Record<string, unknown>) => {
          storedInsert.current = values
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'r1', is_draft: false, ...values },
                error: null,
              }),
            }),
          }
        },
      }),
    }
  }

  function makeRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('writes the caller-supplied steps to the insert payload', async () => {
    const storedInsert = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeInsertSupabase(storedInsert), mockUser])

    const res = await POST(
      makeRequest({ title: 'Pasta', instructions: ['Boil the pasta.'], steps: STEPS }),
    )
    const body = await res.json()

    expect(storedInsert.current.steps).toEqual(STEPS)
    expect(body.steps).toEqual(STEPS)
  })

  it('defaults steps to null when the caller sends none (e.g. a URL import)', async () => {
    const storedInsert = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeInsertSupabase(storedInsert), mockUser])

    await POST(makeRequest({ title: 'Pasta', instructions: ['Boil the pasta.'] }))

    expect(storedInsert.current.steps).toBeNull()
  })

  it('stores null instead of malformed steps (PR #655 review)', async () => {
    const storedInsert = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([makeInsertSupabase(storedInsert), mockUser])

    await POST(
      makeRequest({
        title: 'Pasta',
        instructions: ['Boil the pasta.'],
        steps: [{ text: 'Boil the pasta.', label: 'Boil', duration_minutes: 'ten' }],
      }),
    )

    expect(storedInsert.current.steps).toBeNull()
  })
})

describe('PUT /api/recipes/[id] clears steps only when instructions actually change (#648)', () => {
  function makeSupabase(
    currentInstructions: unknown,
    storedUpdates: { current: Record<string, unknown> },
  ) {
    return {
      from: () => ({
        // The route's own pre-update select for the instructions diff.
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: { instructions: currentInstructions },
                error: null,
              }),
            }),
          }),
        }),
        update: (updates: Record<string, unknown>) => {
          storedUpdates.current = updates
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { id: 'r1', ...updates },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        },
      }),
    }
  }

  function makeRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost/api/recipes/r1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('clears steps to null when the instruction text changes', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabase(['Boil the pasta.'], storedUpdates),
      mockUser,
    ])

    const res = await PUT(makeRequest({ instructions: ['Boil the pasta until al dente.'] }), {
      params: Promise.resolve({ id: 'r1' }),
    })
    const body = await res.json()

    expect(storedUpdates.current.steps).toBeNull()
    expect(body.steps).toBeNull()
  })

  it('leaves steps untouched when the resent instructions are byte-identical (a normal RecipeEditModal resave)', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabase(['Boil the pasta.'], storedUpdates),
      mockUser,
    ])

    await PUT(makeRequest({ title: 'New title', instructions: ['Boil the pasta.'] }), {
      params: Promise.resolve({ id: 'r1' }),
    })

    expect(storedUpdates.current).not.toHaveProperty('steps')
  })

  it('leaves steps untouched when instructions are not part of the update at all', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabase(['Boil the pasta.'], storedUpdates),
      mockUser,
    ])

    await PUT(makeRequest({ is_favorite: true }), { params: Promise.resolve({ id: 'r1' }) })

    expect(storedUpdates.current).not.toHaveProperty('steps')
  })

  it('clears steps even if the caller also sends an explicit steps payload alongside changed instructions', async () => {
    const storedUpdates = { current: {} as Record<string, unknown> }
    ;(requireAuth as jest.Mock).mockResolvedValue([
      makeSupabase(['Boil the pasta.'], storedUpdates),
      mockUser,
    ])

    await PUT(
      makeRequest({ instructions: ['Boil the pasta until al dente.'], steps: STEPS }),
      { params: Promise.resolve({ id: 'r1' }) },
    )

    expect(storedUpdates.current.steps).toBeNull()
  })
})
