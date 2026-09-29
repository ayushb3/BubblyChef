/**
 * @jest-environment node
 *
 * Route tests for `PUT /api/meals/[id]`'s dish operations (issue #652 / spec
 * #647 "PUT /api/meals/[id]: dish operations"): `replace_dish`, `add_side`,
 * `remove_side`, the one-to-two-sides rule enforced server-side, position
 * renumbering on removal, and the draft-delete / saved-keep rule for the
 * dish being replaced or removed.
 *
 * Uses a small stateful in-memory Supabase fake — the same shape
 * `meals-route-idempotent.test.ts` built for `POST /api/meals`, extended
 * here with `delete()` for the dish-op writes.
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
import { PUT } from '@/app/api/meals/[id]/route'

type Row = Record<string, unknown>
type Store = Record<'meals' | 'recipes' | 'meal_dishes', Row[]>

/**
 * Just enough of the supabase-js builder for the meals dish-op path:
 * insert / update / select / delete, `eq` / `in` filters, `order`,
 * `single` / `maybeSingle`, and the `recipes(is_draft)` join on
 * `meal_dishes`.
 */
function makeStore() {
  const store: Store = { meals: [], recipes: [], meal_dishes: [] }
  let counter = 0

  function from(table: keyof Store) {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let values: Row = {}
    let cols = '*'
    const filters: ((r: Row) => boolean)[] = []

    const run = (): { data: Row[]; error: { message: string } | null } => {
      if (op === 'insert') {
        counter += 1
        const row = { id: `${table}-${counter}`, ...values }
        store[table].push(row)
        return { data: [row], error: null }
      }
      const matched = store[table].filter((r) => filters.every((f) => f(r)))
      if (op === 'update') {
        matched.forEach((r) => Object.assign(r, values))
        return { data: matched, error: null }
      }
      if (op === 'delete') {
        for (const r of matched) {
          const idx = store[table].indexOf(r)
          if (idx >= 0) store[table].splice(idx, 1)
        }
        return { data: matched, error: null }
      }
      const withJoin = cols.includes('recipes(')
        ? matched.map((r) => ({ ...r, recipes: store.recipes.find((x) => x.id === r.recipe_id) ?? null }))
        : matched
      return { data: withJoin, error: null }
    }

    const builder = {
      insert(v: Row) {
        op = 'insert'
        values = v
        return builder
      },
      update(v: Row) {
        op = 'update'
        values = v
        return builder
      },
      delete() {
        op = 'delete'
        return builder
      },
      select(c = '*') {
        if (op === 'select') cols = c
        return builder
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val)
        return builder
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]))
        return builder
      },
      order() {
        return builder
      },
      async single() {
        const { data, error } = run()
        return { data: data[0] ?? null, error: error ?? (data[0] ? null : { message: 'no rows' }) }
      },
      async maybeSingle() {
        const { data, error } = run()
        return { data: data[0] ?? null, error }
      },
      then(resolve: (v: { data: Row[]; error: unknown }) => unknown) {
        return Promise.resolve(run()).then(resolve)
      },
    }
    return builder
  }

  return { supabase: { from }, store }
}

/** Seeds a meal with a main plus the given sides (each `{ recipeId, isDraft }`). */
function seedMeal(
  store: Store,
  opts: { mealId?: string; isDraft?: boolean; sides: Array<{ recipeId: string; isDraft: boolean }> },
) {
  const mealId = opts.mealId ?? 'm1'
  store.meals.push({
    id: mealId,
    user_id: 'user-1',
    title: 'Lemon chicken dinner',
    servings: 2,
    constraints: {},
    is_draft: opts.isDraft ?? false,
  })
  store.recipes.push({ id: 'r-main', user_id: 'user-1', title: 'Lemon chicken', is_draft: opts.isDraft ?? false })
  store.meal_dishes.push({ id: 'md-0', meal_id: mealId, user_id: 'user-1', recipe_id: 'r-main', role: 'main', position: 0 })
  opts.sides.forEach((side, i) => {
    store.recipes.push({ id: side.recipeId, user_id: 'user-1', title: `Side ${i + 1}`, is_draft: side.isDraft })
    store.meal_dishes.push({
      id: `md-${i + 1}`,
      meal_id: mealId,
      user_id: 'user-1',
      recipe_id: side.recipeId,
      role: 'side',
      position: i + 1,
    })
  })
  return mealId
}

function putRequest(body: Record<string, unknown>, mealId = 'm1'): Request {
  return new Request(`http://localhost/api/meals/${mealId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function params(id = 'm1') {
  return { params: Promise.resolve({ id }) }
}

const newRecipe = (title: string) => ({ title, instructions: ['Do it'] })

afterEach(() => {
  jest.clearAllMocks()
})

describe('PUT /api/meals/[id] — replace_dish', () => {
  it('replaces the side, deletes the old recipe when it was a draft', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: true }, { recipeId: 'r-side2', isDraft: false }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ replace_dish: { position: 1, recipe: newRecipe('Charred broccolini') } }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(store.recipes.find((r) => r.id === 'r-side1')).toBeUndefined() // draft — deleted
    expect(store.recipes.find((r) => r.id === 'r-side2')).toBeDefined() // untouched
    const dish1 = body.dishes.find((d: { position: number }) => d.position === 1)
    expect(dish1.recipe.title).toBe('Charred broccolini')
  })

  it('replaces the side, keeps the old recipe in the library when it was saved', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: false }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await PUT(putRequest({ replace_dish: { position: 1, recipe: newRecipe('Charred broccolini') } }), params())

    expect(store.recipes.find((r) => r.id === 'r-side1')).toBeDefined() // saved — kept
  })

  it('rejects replacing the main (position 0) with 400', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: true }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ replace_dish: { position: 0, recipe: newRecipe('New main') } }), params())

    expect(res.status).toBe(400)
    expect(store.recipes.some((r) => r.title === 'New main')).toBe(false)
  })

  it('the new recipe is a draft exactly when the meal is', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { isDraft: true, sides: [{ recipeId: 'r-side1', isDraft: true }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await PUT(putRequest({ replace_dish: { position: 1, recipe: newRecipe('New side') } }), params())

    const created = store.recipes.find((r) => r.title === 'New side')
    expect(created?.is_draft).toBe(true)
  })
})

describe('PUT /api/meals/[id] — add_side', () => {
  it('adds a side at the next free position', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: false }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ add_side: { recipe: newRecipe('Green beans') } }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    const dish2 = body.dishes.find((d: { position: number }) => d.position === 2)
    expect(dish2.recipe.title).toBe('Green beans')
    expect(dish2.role).toBe('side')
  })

  it('400s when the meal already has two sides', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, {
      sides: [
        { recipeId: 'r-side1', isDraft: false },
        { recipeId: 'r-side2', isDraft: false },
      ],
    })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ add_side: { recipe: newRecipe('Third side') } }), params())

    expect(res.status).toBe(400)
    expect(store.recipes.some((r) => r.title === 'Third side')).toBe(false)
  })
})

describe('PUT /api/meals/[id] — remove_side', () => {
  it('400s when the meal has only one side', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: false }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ remove_side: { position: 1 } }), params())

    expect(res.status).toBe(400)
    expect(store.meal_dishes).toHaveLength(2) // main + the one side, untouched
  })

  it('400s when the position is the main, not a side', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, {
      sides: [
        { recipeId: 'r-side1', isDraft: false },
        { recipeId: 'r-side2', isDraft: false },
      ],
    })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ remove_side: { position: 0 } }), params())

    expect(res.status).toBe(400)
  })

  it('removes position 1 and renumbers position 2 down to 1, deleting the draft recipe', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, {
      sides: [
        { recipeId: 'r-side1', isDraft: true },
        { recipeId: 'r-side2', isDraft: false },
      ],
    })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ remove_side: { position: 1 } }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(store.recipes.find((r) => r.id === 'r-side1')).toBeUndefined() // draft — deleted
    expect(body.dishes).toHaveLength(2) // main + the renumbered side
    const renumbered = body.dishes.find((d: { recipe: { id: string } }) => d.recipe.id === 'r-side2')
    expect(renumbered.position).toBe(1)
  })

  it('removes position 2 without renumbering, keeping the saved recipe', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, {
      sides: [
        { recipeId: 'r-side1', isDraft: false },
        { recipeId: 'r-side2', isDraft: false },
      ],
    })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(putRequest({ remove_side: { position: 2 } }), params())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.dishes).toHaveLength(2)
    expect(store.recipes.find((r) => r.id === 'r-side2')).toBeDefined() // saved — kept
  })
})

describe('PUT /api/meals/[id] — dish op guardrails', () => {
  it('400s when the body carries two dish ops at once', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: false }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(
      putRequest({
        add_side: { recipe: newRecipe('Extra side') },
        remove_side: { position: 1 },
      }),
      params(),
    )

    expect(res.status).toBe(400)
    expect(store.meal_dishes).toHaveLength(2) // untouched
  })

  it('404s on a meal that is not this user\'s', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: false }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, { id: 'someone-else' }])

    const res = await PUT(putRequest({ add_side: { recipe: newRecipe('Side') } }), params())

    expect(res.status).toBe(404)
  })
})
