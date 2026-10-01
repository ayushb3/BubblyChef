/**
 * @jest-environment node
 *
 * Route tests for the meals CRUD (issue #650 / spec #647):
 *  - `POST /api/meals` — create with new dish recipes, create with an
 *    existing recipe id, the side-count rule, auth.
 *  - `GET /api/meals` — saved vs. drafts.
 */
const mockUser = { id: 'user-1' }

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/response-helpers'
import { GET, POST } from '@/app/api/meals/route'

afterEach(() => {
  jest.clearAllMocks()
})

const MEAL_ROW = {
  id: 'm1',
  user_id: 'user-1',
  title: 'Lemon chicken dinner',
  description: null,
  servings: 2,
  constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
  is_draft: true,
  source_type: 'chat',
  last_cooked_at: null,
  times_cooked: 0,
  created_at: 't',
  updated_at: 't',
}

const DISH_ROWS = [
  { role: 'main', position: 0, recipe_id: 'r1', recipes: { id: 'r1', title: 'Lemon butter chicken' } },
  { role: 'side', position: 1, recipe_id: 'r2', recipes: { id: 'r2', title: 'Buttered orzo' } },
]

/** Builds a fake Supabase client for `POST /api/meals` that creates two new dish recipes. */
function makeCreateSupabase() {
  const inserts: { meals: Record<string, unknown>[]; recipes: Record<string, unknown>[]; meal_dishes: Record<string, unknown>[] } = {
    meals: [],
    recipes: [],
    meal_dishes: [],
  }
  let recipeCounter = 0

  const supabase = {
    from(table: string) {
      if (table === 'meals') {
        return {
          insert: (values: Record<string, unknown>) => {
            inserts.meals.push(values)
            return { select: () => ({ single: async () => ({ data: MEAL_ROW, error: null }) }) }
          },
          select: () => ({
            eq: () => ({ eq: () => ({ single: async () => ({ data: MEAL_ROW, error: null }) }) }),
          }),
        }
      }
      if (table === 'recipes') {
        return {
          insert: (values: Record<string, unknown>) => {
            inserts.recipes.push(values)
            recipeCounter += 1
            const id = `r${recipeCounter}`
            return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) }
          },
        }
      }
      if (table === 'meal_dishes') {
        return {
          insert: (values: Record<string, unknown>) => {
            inserts.meal_dishes.push(values)
            return Promise.resolve({ error: null })
          },
          select: () => ({
            eq: () => ({ eq: () => ({ order: async () => ({ data: DISH_ROWS, error: null }) }) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { supabase, inserts }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/meals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const TWO_DISHES = [
  { role: 'main', position: 0, recipe: { title: 'Lemon butter chicken', instructions: ['Cook it'] } },
  { role: 'side', position: 1, recipe: { title: 'Buttered orzo', instructions: ['Boil it'] } },
]

describe('POST /api/meals', () => {
  it('creates a meal with two new dish recipes, saved as drafts matching the meal', async () => {
    const { supabase, inserts } = makeCreateSupabase()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await POST(
      makeRequest({ title: 'Lemon chicken dinner', servings: 2, is_draft: true, dishes: TWO_DISHES }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(inserts.meals).toHaveLength(1)
    expect(inserts.meals[0]).toMatchObject({ title: 'Lemon chicken dinner', servings: 2, is_draft: true })
    expect(inserts.recipes).toHaveLength(2)
    // Every new dish recipe is a draft exactly when the meal is.
    expect(inserts.recipes.every((r) => r.is_draft === true)).toBe(true)
    expect(inserts.meal_dishes).toHaveLength(2)
    expect(inserts.meal_dishes[0]).toMatchObject({ meal_id: 'm1', role: 'main', position: 0 })
    expect(body.id).toBe('m1')
    expect(body.dishes).toHaveLength(2)
    expect(body.dishes[0].recipe.title).toBe('Lemon butter chicken')
  })

  it('references an existing recipe id instead of copying it', async () => {
    const { supabase, inserts } = makeCreateSupabase()
    // The route verifies ownership with a scoped select before referencing it.
    const supabaseWithExisting = {
      ...supabase,
      from(table: string) {
        if (table === 'recipes') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { id: 'existing-r2' }, error: null }) }),
              }),
            }),
            insert: (values: Record<string, unknown>) => {
              inserts.recipes.push(values)
              return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) }
            },
          }
        }
        return supabase.from(table)
      },
    }
    ;(requireAuth as jest.Mock).mockResolvedValue([supabaseWithExisting, mockUser])

    await POST(
      makeRequest({
        title: 'Lemon chicken dinner',
        dishes: [
          { role: 'main', position: 0, recipe: { title: 'Lemon butter chicken', instructions: ['Cook it'] } },
          { role: 'side', position: 1, recipe_id: 'existing-r2' },
        ],
      }),
    )

    // Only the main was a new recipe payload — the side referenced an
    // existing recipe and was never inserted into `recipes`.
    expect(inserts.recipes).toHaveLength(1)
    expect(inserts.meal_dishes[1]).toMatchObject({ recipe_id: 'existing-r2', role: 'side', position: 1 })
  })

  // Issue #651 PR B: a make-it-a-meal main is a saved recipe referenced by id.
  function supabaseWithRecipeLookup(found: boolean) {
    const { supabase, inserts } = makeCreateSupabase()
    // Every `.eq(column, value)` on the ownership lookup, so a test can prove
    // the route filters by the caller.
    const recipeEqs: unknown[][] = []
    const lookup = {
      eq: (...args: unknown[]) => {
        recipeEqs.push(args)
        return lookup
      },
      maybeSingle: async () => ({ data: found ? { id: 'saved-main' } : null, error: null }),
    }
    const wrapped = {
      ...supabase,
      from(table: string) {
        if (table === 'recipes') {
          return {
            select: () => lookup,
            insert: (values: Record<string, unknown>) => {
              inserts.recipes.push(values)
              return { select: () => ({ single: async () => ({ data: { id: 'rNew' }, error: null }) }) }
            },
          }
        }
        if (table === 'meals') {
          // A failed dish write rolls the just-created meal back with a delete.
          return {
            ...supabase.from(table),
            delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
          }
        }
        return supabase.from(table)
      },
    }
    return { wrapped, inserts, recipeEqs }
  }

  const LINKED_MAIN_DISHES = [
    { role: 'main', position: 0, recipe_id: 'saved-main' },
    { role: 'side', position: 1, recipe: { title: 'Buttered orzo', instructions: ['Boil it'] } },
  ]

  it('links a saved main by id without inserting it into recipes', async () => {
    const { wrapped, inserts, recipeEqs } = supabaseWithRecipeLookup(true)
    ;(requireAuth as jest.Mock).mockResolvedValue([wrapped, mockUser])

    const res = await POST(makeRequest({ title: 'Pasta night', dishes: LINKED_MAIN_DISHES }))

    expect(res.status).toBe(201)
    // The ownership lookup is scoped to the caller: losing this filter would
    // let a user link someone else's recipe.
    expect(recipeEqs).toContainEqual(['user_id', mockUser.id])
    expect(recipeEqs).toContainEqual(['id', 'saved-main'])
    // Only the side was a new recipe; the linked main was never copied.
    expect(inserts.recipes).toHaveLength(1)
    expect(inserts.recipes[0]).toMatchObject({ title: 'Buttered orzo' })
    expect(inserts.meal_dishes[0]).toMatchObject({ recipe_id: 'saved-main', role: 'main', position: 0 })
  })

  it("rejects a main id the user doesn't own (400) and writes no dish", async () => {
    const { wrapped, inserts, recipeEqs } = supabaseWithRecipeLookup(false)
    ;(requireAuth as jest.Mock).mockResolvedValue([wrapped, mockUser])

    const res = await POST(makeRequest({ title: 'Pasta night', dishes: LINKED_MAIN_DISHES }))

    expect(res.status).toBe(400)
    expect(recipeEqs).toContainEqual(['user_id', mockUser.id])
    expect(inserts.meal_dishes).toHaveLength(0)
    expect(inserts.recipes).toHaveLength(0)
  })

  it('accepts a main with no side (issue #758: a main can be a whole plate)', async () => {
    const { supabase, inserts } = makeCreateSupabase()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await POST(
      makeRequest({
        title: 'Just a main',
        dishes: [{ role: 'main', position: 0, recipe: { title: 'Chicken', instructions: [] } }],
      }),
    )

    expect(res.status).toBe(201)
    expect(inserts.meals).toHaveLength(1)
    expect(inserts.meal_dishes).toHaveLength(1)
    expect(inserts.meal_dishes[0]).toMatchObject({ role: 'main', position: 0 })
  })

  it('rejects a meal with three sides (the side-count rule)', async () => {
    const { supabase, inserts } = makeCreateSupabase()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await POST(
      makeRequest({
        title: 'Too many sides',
        dishes: [
          { role: 'main', position: 0, recipe: { title: 'Chicken', instructions: [] } },
          { role: 'side', position: 1, recipe: { title: 'A', instructions: [] } },
          { role: 'side', position: 2, recipe: { title: 'B', instructions: [] } },
          { role: 'side', position: 3, recipe: { title: 'C', instructions: [] } },
        ],
      }),
    )

    expect(res.status).toBe(400)
    expect(inserts.meals).toHaveLength(0)
  })

  it('returns 401 without ever touching Supabase when unauthenticated', async () => {
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    ;(requireAuth as jest.Mock).mockResolvedValue(unauthorized)

    const res = await POST(makeRequest({ title: 'X', dishes: TWO_DISHES }))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/meals', () => {
  function makeListSupabase(rows: Record<string, unknown>[]) {
    return {
      from: (table: string) => {
        expect(table).toBe('meals')
        return {
          select: () => ({
            eq: () => ({
              eq: (_col: string, value: boolean) => ({
                order: async () => ({ data: rows.filter((r) => r.is_draft === value), error: null }),
              }),
            }),
          }),
        }
      },
    }
  }

  it('lists saved meals by default (is_draft=false)', async () => {
    const rows = [
      { id: 'm1', title: 'Saved meal', servings: 2, is_draft: false, meal_dishes: [] },
      { id: 'm2', title: 'Draft meal', servings: 2, is_draft: true, meal_dishes: [] },
    ]
    ;(requireAuth as jest.Mock).mockResolvedValue([makeListSupabase(rows), mockUser])

    const res = await GET(new Request('http://localhost/api/meals'))
    const body = await res.json()

    expect(body.meals).toHaveLength(1)
    expect(body.meals[0].id).toBe('m1')
  })

  it('lists drafts with ?drafts=1', async () => {
    const rows = [
      { id: 'm1', title: 'Saved meal', servings: 2, is_draft: false, meal_dishes: [] },
      { id: 'm2', title: 'Draft meal', servings: 2, is_draft: true, meal_dishes: [] },
    ]
    ;(requireAuth as jest.Mock).mockResolvedValue([makeListSupabase(rows), mockUser])

    const res = await GET(new Request('http://localhost/api/meals?drafts=1'))
    const body = await res.json()

    expect(body.meals).toHaveLength(1)
    expect(body.meals[0].id).toBe('m2')
  })

  it('returns 401 without touching Supabase when unauthenticated', async () => {
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    ;(requireAuth as jest.Mock).mockResolvedValue(unauthorized)

    const res = await GET(new Request('http://localhost/api/meals'))
    expect(res.status).toBe(401)
  })
})
