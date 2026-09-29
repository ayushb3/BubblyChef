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
 * Mirrors `meal_dishes`' real constraints (`supabase/migrations/
 * 00013_meals.sql`): unique `(meal_id, position)`, unique `(meal_id,
 * recipe_id)`, and `(role = 'main') = (position = 0)`. Without this, the
 * fake would silently accept a buggy write order (e.g. renumbering position
 * 2 → 1 *before* deleting position 1) that a real Postgres constraint would
 * reject — so `removeSide`'s delete-then-renumber ordering (issue #652
 * review) wouldn't actually be exercised by the renumbering test below.
 * `excludeId` is the row's own id on an update (never conflicts with
 * itself); `null` on an insert (nothing to exclude).
 */
function checkMealDishesRow(store: Store, row: Row, excludeId: string | null): string | null {
  const others = store.meal_dishes.filter((r) => r.id !== excludeId)
  if (others.some((r) => r.meal_id === row.meal_id && r.position === row.position)) {
    return 'duplicate key value violates unique constraint "uq_meal_dishes_position"'
  }
  if (others.some((r) => r.meal_id === row.meal_id && r.recipe_id === row.recipe_id)) {
    return 'duplicate key value violates unique constraint "uq_meal_dishes_recipe"'
  }
  if ((row.role === 'main') !== (row.position === 0)) {
    return 'new row for relation "meal_dishes" violates check constraint "ck_meal_dishes_role_position"'
  }
  return null
}

/**
 * Just enough of the supabase-js builder for the meals dish-op path:
 * insert / update / select / delete, `eq` / `in` filters, `order`,
 * `single` / `maybeSingle`, and the `recipes(is_draft)` join on
 * `meal_dishes`.
 *
 * `onRecipeInsert`, when given, fires the instant a `recipes` row is
 * inserted — the exact async gap between `replaceDish`'s initial read and
 * its update (`insertDishRecipe` awaits a `recipes.insert`) — so a test can
 * simulate a concurrent `remove_side` landing in that window.
 */
function makeStore(opts: { onRecipeInsert?: (store: Store) => void } = {}) {
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
        if (table === 'meal_dishes') {
          const conflict = checkMealDishesRow(store, row, null)
          if (conflict) return { data: [], error: { message: conflict } }
        }
        store[table].push(row)
        if (table === 'recipes') opts.onRecipeInsert?.(store)
        return { data: [row], error: null }
      }
      const matched = store[table].filter((r) => filters.every((f) => f(r)))
      if (op === 'update') {
        if (table === 'meal_dishes') {
          for (const r of matched) {
            const conflict = checkMealDishesRow(store, { ...r, ...values }, r.id as string)
            if (conflict) return { data: [], error: { message: conflict } }
          }
        }
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

  it('409s and writes nothing when expected_recipe_id no longer matches what is at that position', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, { sides: [{ recipeId: 'r-side1', isDraft: false }] })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(
      putRequest({
        replace_dish: { position: 1, recipe: newRecipe('New side'), expected_recipe_id: 'stale-id' },
      }),
      params(),
    )

    expect(res.status).toBe(409)
    expect(store.recipes.some((r) => r.title === 'New side')).toBe(false) // never inserted
  })

  it('a remove_side landing between the read and the update makes replace_dish 409, cleans up the inserted recipe, and never touches the other side', async () => {
    const { supabase, store } = makeStore({
      onRecipeInsert: (s) => {
        // Simulates a concurrent `remove_side { position: 2 }` completing
        // in the gap between replaceDish's initial read and its update:
        // position 2 is gone, and (since removing position 2 needs no
        // renumbering) position 1 is untouched at the DB level — but a
        // caller who read the meal *before* this still thinks position 1's
        // recipe_id is what it was, which is exactly what expected_recipe_id
        // is for.
        const idx = s.meal_dishes.findIndex((d) => d.position === 2)
        if (idx >= 0) s.meal_dishes.splice(idx, 1)
        // And a genuinely conflicting concurrent replace of *this* position
        // by someone else, landing first:
        const row = s.meal_dishes.find((d) => d.position === 1)
        if (row) row.recipe_id = 'r-side1-raced'
      },
    })
    seedMeal(store, {
      sides: [
        { recipeId: 'r-side1', isDraft: false },
        { recipeId: 'r-side2', isDraft: false },
      ],
    })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(
      putRequest({
        replace_dish: { position: 1, recipe: newRecipe('New side'), expected_recipe_id: 'r-side1' },
      }),
      params(),
    )

    expect(res.status).toBe(409)
    expect(store.recipes.some((r) => r.title === 'New side')).toBe(false) // inserted, then cleaned up
    expect(store.meal_dishes.find((d) => d.position === 1)?.recipe_id).toBe('r-side1-raced') // untouched
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

  it('409s and deletes nothing when expected_recipe_id no longer matches what is at that position', async () => {
    const { supabase, store } = makeStore()
    seedMeal(store, {
      sides: [
        { recipeId: 'r-side1', isDraft: false },
        { recipeId: 'r-side2', isDraft: false },
      ],
    })
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const res = await PUT(
      putRequest({ remove_side: { position: 1, expected_recipe_id: 'stale-id' } }),
      params(),
    )

    expect(res.status).toBe(409)
    expect(store.meal_dishes).toHaveLength(3) // nothing removed
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
