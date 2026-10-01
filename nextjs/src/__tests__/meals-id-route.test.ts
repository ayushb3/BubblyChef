/**
 * @jest-environment node
 *
 * Route tests for `/api/meals/[id]` (issue #650 / spec #647):
 *  - `PUT` promote cascades to draft dish recipes and awards bubbles.
 *  - `DELETE` removes draft dish recipes and keeps saved ones.
 *  - Auth.
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
jest.mock('@/lib/bubbles', () => ({ awardBubbles: awardBubblesMock }))

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/response-helpers'
import { GET, PUT, DELETE } from '@/app/api/meals/[id]/route'

afterEach(() => {
  jest.clearAllMocks()
})

function params(id = 'm1') {
  return { params: Promise.resolve({ id }) }
}

const MEAL_ROW = {
  id: 'm1',
  user_id: 'user-1',
  title: 'Lemon chicken dinner',
  servings: 2,
  constraints: {},
  is_draft: false,
  source_type: 'chat',
  last_cooked_at: null,
  times_cooked: 0,
  created_at: 't',
  updated_at: 't',
}

describe('GET /api/meals/[id]', () => {
  it('returns 404 when the meal does not exist or is not owned by this user', async () => {
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }) }),
      }),
    }
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await GET(new Request('http://localhost/api/meals/m1'), params())
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/meals/[id] — promote cascades to draft dish recipes', () => {
  function makeSupabase() {
    const updates: { meals: Record<string, unknown>[]; recipes: Record<string, unknown>[] } = {
      meals: [],
      recipes: [],
    }
    const dishRows = [
      { role: 'main', position: 0, recipe_id: 'r1', recipes: { id: 'r1', title: 'Main', is_draft: false } },
      { role: 'side', position: 1, recipe_id: 'r2', recipes: { id: 'r2', title: 'Side', is_draft: false } },
    ]

    const supabase = {
      from(table: string) {
        if (table === 'meals') {
          return {
            update: (values: Record<string, unknown>) => {
              updates.meals.push(values)
              return {
                eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'm1' }, error: null }) }) }) }),
              }
            },
            select: () => ({
              eq: () => ({ eq: () => ({ single: async () => ({ data: { ...MEAL_ROW, is_draft: false }, error: null }) }) }),
            }),
          }
        }
        if (table === 'meal_dishes') {
          return {
            // Dispatches on the select columns, since this table is queried
            // twice in the promote flow with different shapes: once for the
            // recipe_id lookup (awaited directly, two `.eq()`s, no further
            // chain), and once inside `fetchFullMeal`'s full dish fetch
            // (`.order()` at the end).
            select: (cols: string) => {
              if (cols.includes('recipes(')) {
                return {
                  eq: () => ({
                    eq: () => ({ order: async () => ({ data: dishRows, error: null }) }),
                  }),
                }
              }
              return {
                eq: () => ({
                  eq: async () => ({
                    data: dishRows.map((d) => ({ recipe_id: d.recipe_id })),
                    error: null,
                  }),
                }),
              }
            },
          }
        }
        if (table === 'recipes') {
          return {
            update: (values: Record<string, unknown>) => {
              updates.recipes.push(values)
              return {
                in: () => ({
                  eq: () => ({
                    eq: () => ({ select: async () => ({ data: [{ id: 'r1' }, { id: 'r2' }], error: null }) }),
                  }),
                }),
              }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
    return { supabase, updates }
  }

  function putRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/meals/m1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('sets is_draft=false on the meal, promotes its draft dish recipes, and awards bubbles for each', async () => {
    const { supabase, updates } = makeSupabase()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ promote: true }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(updates.meals[0]).toMatchObject({ is_draft: false })
    expect(updates.recipes[0]).toMatchObject({ is_draft: false })
    expect(awardBubblesMock).toHaveBeenCalledWith('user-1', 'recipe_save', 'r1')
    expect(awardBubblesMock).toHaveBeenCalledWith('user-1', 'recipe_save', 'r2')
    expect(body.is_draft).toBe(false)
  })

  it('updates title/servings without touching is_draft when promote is absent', async () => {
    const { supabase, updates } = makeSupabase()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await PUT(putRequest({ servings: 4 }), params())

    expect(updates.meals[0]).toEqual({ servings: 4 })
    expect(updates.recipes).toHaveLength(0)
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })

  it.each([0, -1, 2.5, 101, '4', null])(
    'rejects servings=%p with 400 and writes nothing',
    async (servings) => {
      const { supabase, updates } = makeSupabase()
      ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

      const res = await PUT(putRequest({ servings, promote: true }), params())

      expect(res.status).toBe(400)
      expect(updates.meals).toHaveLength(0)
      expect(updates.recipes).toHaveLength(0)
    },
  )

  it('returns 401 without touching Supabase when unauthenticated', async () => {
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    ;(requireAuth as jest.Mock).mockResolvedValue(unauthorized)

    const res = await PUT(putRequest({ promote: true }), params())
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/meals/[id] — keeps saved dish recipes, removes draft ones', () => {
  function makeSupabase(dishRows: Record<string, unknown>[]) {
    const deletes: { meals: string[]; recipes: unknown[] } = { meals: [], recipes: [] }

    const supabase = {
      from(table: string) {
        if (table === 'meal_dishes') {
          return {
            select: () => ({
              eq: () => ({ eq: async () => ({ data: dishRows, error: null }) }),
            }),
          }
        }
        if (table === 'recipes') {
          return {
            delete: () => ({
              in: (_col: string, ids: string[]) => {
                deletes.recipes.push(ids)
                return { eq: async () => ({ error: null }) }
              },
            }),
          }
        }
        if (table === 'meals') {
          return {
            delete: (opts?: { count?: string }) => ({
              eq: () => ({
                eq: async () => ({ error: null, count: opts?.count === 'exact' ? 1 : null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
    return { supabase, deletes }
  }

  it('deletes draft dish recipes and leaves saved ones untouched', async () => {
    const { supabase, deletes } = makeSupabase([
      { recipe_id: 'r1', recipes: { is_draft: false } }, // saved — kept
      { recipe_id: 'r2', recipes: { is_draft: true } }, // draft — deleted
    ])
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await DELETE(new Request('http://localhost/api/meals/m1'), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deleted).toBe(true)
    expect(deletes.recipes).toEqual([['r2']])
  })

  it('deletes no recipes when every dish is saved', async () => {
    const { supabase, deletes } = makeSupabase([{ recipe_id: 'r1', recipes: { is_draft: false } }])
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await DELETE(new Request('http://localhost/api/meals/m1'), params())

    expect(deletes.recipes).toHaveLength(0)
  })

  it('never deletes a linked saved main (issue #651 PR B), only the draft sides', async () => {
    const { supabase, deletes } = makeSupabase([
      { recipe_id: 'linked-main', recipes: { is_draft: false } }, // the user's own saved recipe
      { recipe_id: 'side-1', recipes: { is_draft: true } },
    ])
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await DELETE(new Request('http://localhost/api/meals/m1'), params())

    expect(res.status).toBe(200)
    expect(deletes.recipes).toEqual([['side-1']])
  })

  it("returns 404 and deletes nothing when the meal does not exist or is not this user's (issue #675)", async () => {
    const recipeDeletes: unknown[] = []
    const supabase = {
      from(table: string) {
        if (table === 'meal_dishes') {
          // RLS + the user_id filter: another user's (or a missing) meal has no visible dishes.
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }
        }
        if (table === 'recipes') {
          return {
            delete: () => ({
              in: (_c: string, ids: string[]) => {
                recipeDeletes.push(ids)
                return { eq: async () => ({ error: null }) }
              },
            }),
          }
        }
        if (table === 'meals') {
          return { delete: () => ({ eq: () => ({ eq: async () => ({ error: null, count: 0 }) }) }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await DELETE(new Request('http://localhost/api/meals/nope'), params('nope'))

    expect(res.status).toBe(404)
    expect(recipeDeletes).toHaveLength(0)
  })

  it('returns 401 without touching Supabase when unauthenticated', async () => {
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    ;(requireAuth as jest.Mock).mockResolvedValue(unauthorized)

    const res = await DELETE(new Request('http://localhost/api/meals/m1'), params())
    expect(res.status).toBe(401)
  })
})
