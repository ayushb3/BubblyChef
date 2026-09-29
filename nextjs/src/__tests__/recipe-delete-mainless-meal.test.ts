/**
 * @jest-environment node
 *
 * Issue #650 / spec #647 "Deleting": `DELETE /api/recipes/[id]` deletes any
 * meal this recipe was the *main* of (a meal left with no main is deleted
 * too), and leaves a meal alone when the recipe was only a side (the
 * `meal_dishes` FK cascade removes that link on its own).
 */
const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

jest.mock('@/lib/bubbles', () => ({ awardBubbles: jest.fn() }))

import { requireAuth } from '@/lib/response-helpers'
import { DELETE } from '@/app/api/recipes/[id]/route'

afterEach(() => {
  jest.clearAllMocks()
})

function params(id = 'r1') {
  return { params: Promise.resolve({ id }) }
}

function makeSupabase(
  mainOfRows: Array<{ meal_id: string }>,
  sideRows: Array<{ recipe_id: string; recipes: { is_draft: boolean } }> = [],
) {
  const calls: { mealsDeletedIds: string[][]; recipesDeletedIds: string[][] } = {
    mealsDeletedIds: [],
    recipesDeletedIds: [],
  }

  const supabase = {
    from(table: string) {
      if (table === 'meal_dishes') {
        return {
          select: () => ({
            // The main-of lookup: .eq(recipe_id).eq(user_id).eq(role)
            eq: () => ({
              eq: () => ({ eq: async () => ({ data: mainOfRows, error: null }) }),
            }),
            // The mainless meals' sides: .in(meal_id).eq(user_id).eq(role)
            in: () => ({
              eq: () => ({ eq: async () => ({ data: sideRows, error: null }) }),
            }),
          }),
        }
      }
      if (table === 'recipes') {
        return {
          delete: () => ({
            eq: () => ({ eq: async () => ({ error: null }) }),
            in: (_col: string, ids: string[]) => {
              calls.recipesDeletedIds.push(ids)
              return { eq: async () => ({ error: null }) }
            },
          }),
        }
      }
      if (table === 'meals') {
        return {
          delete: () => ({
            in: (_col: string, ids: string[]) => {
              calls.mealsDeletedIds.push(ids)
              return { eq: async () => ({ error: null }) }
            },
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { supabase, calls }
}

describe('DELETE /api/recipes/[id]', () => {
  it('deletes a meal the recipe was the main of', async () => {
    const { supabase, calls } = makeSupabase([{ meal_id: 'm1' }])
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await DELETE(new Request('http://localhost/api/recipes/r1'), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deleted).toBe(true)
    expect(calls.mealsDeletedIds).toEqual([['m1']])
  })

  it('deletes every mainless meal when the recipe was the main of more than one', async () => {
    const { supabase, calls } = makeSupabase([{ meal_id: 'm1' }, { meal_id: 'm2' }])
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await DELETE(new Request('http://localhost/api/recipes/r1'), params())

    expect(calls.mealsDeletedIds).toEqual([['m1', 'm2']])
  })

  it('does not touch the meals table when the recipe was never a main', async () => {
    const { supabase, calls } = makeSupabase([])
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await DELETE(new Request('http://localhost/api/recipes/r1'), params())

    expect(res.status).toBe(200)
    expect(calls.mealsDeletedIds).toEqual([])
  })

  it("deletes a mainless meal's draft sides and keeps its saved ones", async () => {
    const { supabase, calls } = makeSupabase(
      [{ meal_id: 'm1' }],
      [
        { recipe_id: 'draft-side', recipes: { is_draft: true } },
        { recipe_id: 'saved-side', recipes: { is_draft: false } },
      ],
    )
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await DELETE(new Request('http://localhost/api/recipes/r1'), params())

    expect(calls.mealsDeletedIds).toEqual([['m1']])
    expect(calls.recipesDeletedIds).toEqual([['draft-side']])
  })
})
