/**
 * @jest-environment node
 *
 * `POST /api/meals` is idempotent on `source_ref` (PR #659 review, finding
 * 1): the chat card's in-page guard is lost when the page remounts, so
 * Open → Back → Save used to create a second meal. With the proposal's
 * `meal_ref` sent as `source_ref`, a repeat POST resolves to the first meal.
 *
 * Uses a small stateful in-memory Supabase so the sequence of calls (create,
 * repeat, promote) runs against one consistent store rather than per-call
 * canned responses.
 */
const mockUser = { id: 'user-1' }
const awardBubblesMock = jest.fn()

jest.mock('@/lib/response-helpers', () => ({
  requireAuth: jest.fn(),
  errorResponse: (message: string, status = 500) =>
    new Response(JSON.stringify({ error: message }), { status }),
  notFound: (entity = 'Resource') =>
    new Response(JSON.stringify({ error: `${entity} not found` }), { status: 404 }),
}))
jest.mock('@/lib/bubbles', () => ({ awardBubbles: awardBubblesMock }))

import { requireAuth } from '@/lib/response-helpers'
import { POST } from '@/app/api/meals/route'

type Row = Record<string, unknown>
type Store = Record<'meals' | 'recipes' | 'meal_dishes', Row[]>

/**
 * Just enough of the supabase-js builder for the meals routes: insert /
 * update / select, `eq` / `in` filters, `order`, `single` / `maybeSingle`,
 * and the `recipes(*)` join on `meal_dishes`. `meals` enforces the partial
 * unique index on (user_id, source_ref) with a 23505, like Postgres.
 *
 * `hideNextRefLookup` makes the next `source_ref` lookup miss, to simulate a
 * concurrent first tap inserting between this request's lookup and insert.
 */
function makeStore(opts: { hideNextRefLookup?: boolean } = {}) {
  const store: Store = { meals: [], recipes: [], meal_dishes: [] }
  let counter = 0
  let hideNextRefLookup = opts.hideNextRefLookup ?? false

  function from(table: keyof Store) {
    let op: 'select' | 'insert' | 'update' = 'select'
    let values: Row = {}
    let cols = '*'
    const filters: ((r: Row) => boolean)[] = []
    let refLookup = false

    const run = (): { data: Row[]; error: { code?: string; message: string } | null } => {
      if (op === 'insert') {
        if (
          table === 'meals' &&
          values.source_ref != null &&
          store.meals.some((m) => m.user_id === values.user_id && m.source_ref === values.source_ref)
        ) {
          return { data: [], error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        }
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
      if (refLookup && hideNextRefLookup) {
        hideNextRefLookup = false
        return { data: [], error: null }
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
      select(c = '*') {
        if (op === 'select') cols = c
        return builder
      },
      eq(col: string, val: unknown) {
        if (col === 'source_ref') refLookup = true
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

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/meals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mealBody(isDraft: boolean, sourceRef?: string) {
  return {
    title: 'Lemon chicken dinner',
    servings: 2,
    is_draft: isDraft,
    ...(sourceRef ? { source_ref: sourceRef } : {}),
    dishes: [
      { role: 'main', position: 0, recipe: { title: 'Lemon butter chicken', instructions: ['Cook it'] } },
      { role: 'side', position: 1, recipe: { title: 'Buttered orzo', instructions: ['Boil it'] } },
    ],
  }
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/meals — idempotent on source_ref', () => {
  it('Open → Back → Save: the save resolves to the draft Open made and promotes it, not a second meal', async () => {
    const { supabase, store } = makeStore()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const open = await POST(makeRequest(mealBody(true, 'ref-abc')))
    const opened = await open.json()
    expect(open.status).toBe(201)
    expect(opened.is_draft).toBe(true)

    // The page remounted: no client-side memory of the meal, so Save POSTs.
    const save = await POST(makeRequest(mealBody(false, 'ref-abc')))
    const saved = await save.json()

    expect(save.status).toBe(200)
    expect(saved.id).toBe(opened.id)
    expect(store.meals).toHaveLength(1)
    expect(store.recipes).toHaveLength(2)
    // Promoted: the meal and both of its draft dishes, with bubbles per dish.
    expect(saved.is_draft).toBe(false)
    expect(store.recipes.every((r) => r.is_draft === false)).toBe(true)
    expect(awardBubblesMock).toHaveBeenCalledTimes(2)
  })

  it('a repeat Open against a saved meal returns it without demoting it', async () => {
    const { supabase, store } = makeStore()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const save = await POST(makeRequest(mealBody(false, 'ref-abc')))
    const saved = await save.json()

    const open = await POST(makeRequest(mealBody(true, 'ref-abc')))
    const reopened = await open.json()

    expect(open.status).toBe(200)
    expect(reopened.id).toBe(saved.id)
    expect(reopened.is_draft).toBe(false)
    expect(store.meals).toHaveLength(1)
    expect(awardBubblesMock).not.toHaveBeenCalled()
  })

  it('two concurrent first taps: the loser hits the unique index and gets the winner’s meal', async () => {
    const { supabase, store } = makeStore()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    const first = await (await POST(makeRequest(mealBody(true, 'ref-abc')))).json()

    // The second request's lookup ran before the first insert landed.
    const racing = makeStore({ hideNextRefLookup: true })
    racing.store.meals.push(...store.meals)
    racing.store.recipes.push(...store.recipes)
    racing.store.meal_dishes.push(...store.meal_dishes)
    ;(requireAuth as jest.Mock).mockResolvedValue([racing.supabase, mockUser])

    const res = await POST(makeRequest(mealBody(true, 'ref-abc')))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.id).toBe(first.id)
    expect(racing.store.meals).toHaveLength(1)
    // It bailed before creating any dish recipes of its own.
    expect(racing.store.recipes).toHaveLength(2)
  })

  it('different source_refs make different meals', async () => {
    const { supabase, store } = makeStore()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await POST(makeRequest(mealBody(true, 'ref-one')))
    await POST(makeRequest(mealBody(true, 'ref-two')))

    expect(store.meals).toHaveLength(2)
  })

  it('without a source_ref every POST creates a meal, as before', async () => {
    const { supabase, store } = makeStore()
    ;(requireAuth as jest.Mock).mockResolvedValue([supabase, mockUser])

    await POST(makeRequest(mealBody(true)))
    await POST(makeRequest(mealBody(true)))

    expect(store.meals).toHaveLength(2)
    expect(store.meals.every((m) => m.source_ref === null)).toBe(true)
  })
})
