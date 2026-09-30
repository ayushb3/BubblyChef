/**
 * @jest-environment node
 *
 * Issue #497 (Spec B.5, backend): the `/api/grocery/*` CRUD routes.
 *
 * Runs the real route handlers against an in-memory PostgREST-shaped fake with
 * TWO users' rows in it. The fake deliberately does NOT emulate RLS: these
 * tests prove each route scopes every query by the authenticated user itself
 * (defence in depth), so another user's list can't be read, changed or deleted
 * even if a policy were ever missing. The policies are pinned separately
 * (ai-service/tests/test_issue_497_migration_rls.py) and exercised against the
 * hosted DB in the PR's Verify step.
 */

import { randomUUID } from 'crypto'

type Row = Record<string, unknown>

class Db {
  tables: Record<string, Row[]> = { grocery_lists: [], grocery_items: [] }
}

const UNIQUE: Record<string, string[]> = {
  grocery_lists: ['user_id'],
  grocery_items: ['list_id', 'name_key'],
}

class Query implements PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> {
  private filters: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private payload: Row | Row[] = {}
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  private wantRows = true
  private single: 'none' | 'maybe' | 'one' = 'none'

  constructor(
    private db: Db,
    private table: string
  ) {}

  select() {
    if (this.op !== 'select') this.wantRows = true
    return this
  }
  insert(p: Row | Row[]) {
    this.op = 'insert'
    this.payload = p
    this.wantRows = false
    return this
  }
  upsert(p: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert'
    this.payload = p
    this.opts = opts
    this.wantRows = false
    return this
  }
  update(p: Row) {
    this.op = 'update'
    this.payload = p
    this.wantRows = false
    return this
  }
  delete() {
    this.op = 'delete'
    this.wantRows = false
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val)
    return this
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]))
    return this
  }
  order() {
    return this
  }
  maybeSingle() {
    this.single = 'maybe'
    return this
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<T1 = any, T2 = never>(res?: (v: any) => T1 | PromiseLike<T1>, rej?: (e: unknown) => T2 | PromiseLike<T2>) {
    return Promise.resolve(this.run()).then(res, rej)
  }

  private match(r: Row) {
    return this.filters.every((f) => f(r))
  }

  private run() {
    const rows = (this.db.tables[this.table] ??= [])
    const unique = UNIQUE[this.table] ?? []
    const conflictCols = this.opts.onConflict ? this.opts.onConflict.split(',').map((s) => s.trim()) : unique
    let out: Row[] = []
    let error: { code?: string; message: string } | null = null

    if (this.op === 'select') {
      out = rows.filter((r) => this.match(r)).map((r) => ({ ...r }))
    } else if (this.op === 'insert' || this.op === 'upsert') {
      const batch = Array.isArray(this.payload) ? this.payload : [this.payload]
      for (const raw of batch) {
        const row: Row = { id: randomUUID(), checked: false, checked_at: null, ...raw }
        const dupe = rows.find((r) => conflictCols.every((c) => r[c] === row[c]))
        if (dupe) {
          if (this.op === 'upsert' && this.opts.ignoreDuplicates) continue
          if (this.op === 'upsert') {
            Object.assign(dupe, raw)
            out.push({ ...dupe })
            continue
          }
          error = { code: '23505', message: 'duplicate key value violates unique constraint' }
          break
        }
        rows.push(row)
        out.push({ ...row })
      }
    } else if (this.op === 'update') {
      const hit = rows.filter((r) => this.match(r))
      const clash = (this.payload as Row).name_key
      if (
        typeof clash === 'string' &&
        hit.some((h) => rows.some((r) => r !== h && r.list_id === h.list_id && r.name_key === clash))
      ) {
        error = { code: '23505', message: 'duplicate key value violates unique constraint' }
      } else {
        for (const r of hit) Object.assign(r, this.payload)
        out = hit.map((r) => ({ ...r }))
      }
    } else {
      const hit = rows.filter((r) => this.match(r))
      this.db.tables[this.table] = rows.filter((r) => !this.match(r))
      out = hit.map((r) => ({ ...r }))
    }

    if (error) return { data: null, error }
    if (this.single === 'maybe') return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }
}

function clientFor(db: Db) {
  return {
    from: (table: string) => new Query(db, table),
    rpc: async (fn: string, args: { p_token: string }) => {
      if (fn !== 'get_shared_grocery_list') return { data: null, error: { message: 'no such fn' } }
      const list = db.tables.grocery_lists.find(
        (l) => l.share_token && l.share_token === args.p_token
      )
      const data = list
        ? db.tables.grocery_items
            .filter((i) => i.list_id === list.id && !i.checked)
            .map(({ name, quantity, unit, category }) => ({ name, quantity, unit, category }))
        : []
      return { data, error: null }
    },
  }
}

const ALICE = { id: 'user-alice' }
const BOB = { id: 'user-bob' }

let db: Db
let currentUser: { id: string } | null

jest.mock('@/lib/response-helpers', () => {
  const actual = jest.requireActual('@/lib/response-helpers')
  return {
    ...actual,
    requireAuth: jest.fn(async () => {
      if (!currentUser) {
        const { NextResponse } = jest.requireActual('next/server')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return [clientFor(db), currentUser]
    }),
  }
})
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => clientFor(db)),
}))

type RouteCtx = { params: Promise<{ id: string }> }
const ctx = (id: string): RouteCtx => ({ params: Promise.resolve({ id }) })
const json = (body: unknown, method = 'POST') =>
  new Request('http://test/api/grocery', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

function seedList(user: string, items: Array<Partial<Row> & { name: string }> = [], token: string | null = null) {
  const list = { id: `list-${user}`, user_id: user, share_token: token, last_regenerated_at: null }
  db.tables.grocery_lists.push(list)
  for (const it of items) {
    db.tables.grocery_items.push({
      id: randomUUID(),
      list_id: list.id,
      user_id: user,
      name_key: it.name.toLowerCase(),
      quantity: null,
      unit: null,
      category: 'other',
      source: 'manual',
      source_ref: null,
      checked: false,
      checked_at: null,
      ...it,
    })
  }
  return list
}

const itemsOf = (user: string) => db.tables.grocery_items.filter((i) => i.user_id === user)

beforeEach(() => {
  jest.clearAllMocks()
  db = new Db()
  currentUser = ALICE
})

describe('GET /api/grocery', () => {
  it('401s without a session', async () => {
    currentUser = null
    const { GET } = await import('@/app/api/grocery/route')
    expect((await GET()).status).toBe(401)
  })

  it('is empty before the user has a list', async () => {
    const { GET } = await import('@/app/api/grocery/route')
    const body = await (await GET()).json()
    expect(body).toEqual({ list: null, items: [] })
  })

  it("returns the caller's lines and never another user's", async () => {
    seedList(ALICE.id, [{ name: 'eggs' }])
    seedList(BOB.id, [{ name: 'caviar' }])
    const { GET } = await import('@/app/api/grocery/route')
    const body = await (await GET()).json()
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['eggs'])
    expect(body.list.id).toBe(`list-${ALICE.id}`)
    expect(body.items[0]).not.toHaveProperty('user_id')
    expect(body.items[0]).not.toHaveProperty('list_id')
  })
})

describe('POST /api/grocery/items', () => {
  it('creates the list on first add and stores manual lines stamped with the user', async () => {
    const { POST } = await import('@/app/api/grocery/items/route')
    const res = await POST(json({ items: [{ name: ' Paper towels ' }, { name: 'Milk', quantity: 2, unit: 'L' }] }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['Paper towels', 'Milk'])
    expect(db.tables.grocery_lists).toHaveLength(1)
    expect(itemsOf(ALICE.id).map((i) => [i.name_key, i.source, i.user_id])).toEqual([
      ['paper towels', 'manual', ALICE.id],
      ['milk', 'manual', ALICE.id],
    ])
  })

  it('a food already on the list is adopted, not duplicated (and un-checked)', async () => {
    seedList(ALICE.id, [
      { name: 'eggs', source: 'depleted', checked: false },
      { name: 'milk', source: 'expiring', checked: true, checked_at: 'then' },
    ])
    const { POST } = await import('@/app/api/grocery/items/route')
    await POST(json({ items: [{ name: 'Eggs' }, { name: 'MILK', quantity: 3 }] }))
    const lines = itemsOf(ALICE.id)
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.source === 'manual' && l.checked === false)).toBe(true)
    expect(lines.find((l) => l.name_key === 'milk')?.quantity).toBe(3)
  })

  it('never writes into another user\'s list', async () => {
    seedList(BOB.id, [{ name: 'caviar' }])
    const { POST } = await import('@/app/api/grocery/items/route')
    await POST(json({ items: [{ name: 'caviar' }] }))
    expect(itemsOf(BOB.id)).toHaveLength(1)
    expect(itemsOf(ALICE.id)).toHaveLength(1) // Alice got her own line
    expect(db.tables.grocery_lists.map((l) => l.user_id).sort()).toEqual([ALICE.id, BOB.id])
  })

  it.each([[{}], [{ items: [] }], [{ items: [{ name: '' }] }], [{ items: [{ name: 'a', quantity: -1 }] }]])(
    '400s on %j',
    async (body) => {
      const { POST } = await import('@/app/api/grocery/items/route')
      expect((await POST(json(body))).status).toBe(400)
      expect(db.tables.grocery_items).toHaveLength(0)
    }
  )

  it('400s on a body that is not JSON', async () => {
    const { POST } = await import('@/app/api/grocery/items/route')
    const res = await POST(new Request('http://test/api/grocery/items', { method: 'POST', body: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('401s without a session', async () => {
    currentUser = null
    const { POST } = await import('@/app/api/grocery/items/route')
    expect((await POST(json({ items: [{ name: 'a' }] }))).status).toBe(401)
  })
})

describe('PATCH /api/grocery/items/[id]', () => {
  it('checks a line (stamping checked_at) and unchecks it (clearing it)', async () => {
    seedList(ALICE.id, [{ name: 'eggs', source: 'depleted' }])
    const id = itemsOf(ALICE.id)[0].id as string
    const { PATCH } = await import('@/app/api/grocery/items/[id]/route')

    const checked = await (await PATCH(json({ checked: true }, 'PATCH'), ctx(id))).json()
    expect(checked.item.checked).toBe(true)
    expect(checked.item.checked_at).toEqual(expect.any(String))
    // Checking does not change why the line exists: regenerate still refreshes it if unchecked later.
    expect(checked.item.source).toBe('depleted')

    const unchecked = await (await PATCH(json({ checked: false }, 'PATCH'), ctx(id))).json()
    expect(unchecked.item.checked).toBe(false)
    expect(unchecked.item.checked_at).toBeNull()
  })

  it('editing quantity, unit or name adopts a generated line as manual so regenerate leaves it', async () => {
    seedList(ALICE.id, [{ name: 'eggs', source: 'depleted' }])
    const id = itemsOf(ALICE.id)[0].id as string
    const { PATCH } = await import('@/app/api/grocery/items/[id]/route')
    const res = await (await PATCH(json({ quantity: 18, unit: 'item' }, 'PATCH'), ctx(id))).json()
    expect(res.item).toMatchObject({ quantity: 18, unit: 'item', source: 'manual' })
  })

  it('a rename updates the dedupe key and 409s when it collides with another line', async () => {
    seedList(ALICE.id, [{ name: 'eggs' }, { name: 'milk' }])
    const [eggs] = itemsOf(ALICE.id)
    const { PATCH } = await import('@/app/api/grocery/items/[id]/route')
    expect((await PATCH(json({ name: 'Free-range eggs' }, 'PATCH'), ctx(eggs.id as string))).status).toBe(200)
    expect(itemsOf(ALICE.id)[0].name_key).toBe('free-range eggs')
    expect((await PATCH(json({ name: 'Milk' }, 'PATCH'), ctx(eggs.id as string))).status).toBe(409)
  })

  it("404s on another user's line and leaves it untouched", async () => {
    seedList(BOB.id, [{ name: 'caviar' }])
    const id = itemsOf(BOB.id)[0].id as string
    const { PATCH } = await import('@/app/api/grocery/items/[id]/route')
    const res = await PATCH(json({ checked: true, quantity: 99 }, 'PATCH'), ctx(id))
    expect(res.status).toBe(404)
    expect(itemsOf(BOB.id)[0]).toMatchObject({ checked: false, quantity: null })
  })

  it.each([[{}], [{ checked: 'yes' }], [{ quantity: -1 }]])('400s on %j', async (body) => {
    seedList(ALICE.id, [{ name: 'eggs' }])
    const { PATCH } = await import('@/app/api/grocery/items/[id]/route')
    expect((await PATCH(json(body, 'PATCH'), ctx(itemsOf(ALICE.id)[0].id as string))).status).toBe(400)
  })
})

describe('DELETE /api/grocery/items/[id] and ?checked=1', () => {
  it('removes one of the caller\'s lines', async () => {
    seedList(ALICE.id, [{ name: 'eggs' }, { name: 'milk' }])
    const id = itemsOf(ALICE.id)[0].id as string
    const { DELETE } = await import('@/app/api/grocery/items/[id]/route')
    expect((await DELETE(new Request('http://t', { method: 'DELETE' }), ctx(id))).status).toBe(200)
    expect(itemsOf(ALICE.id)).toHaveLength(1)
  })

  it("404s on another user's line and leaves it in place", async () => {
    seedList(BOB.id, [{ name: 'caviar' }])
    const id = itemsOf(BOB.id)[0].id as string
    const { DELETE } = await import('@/app/api/grocery/items/[id]/route')
    expect((await DELETE(new Request('http://t', { method: 'DELETE' }), ctx(id))).status).toBe(404)
    expect(itemsOf(BOB.id)).toHaveLength(1)
  })

  it("clears only the caller's checked lines", async () => {
    seedList(ALICE.id, [{ name: 'eggs', checked: true }, { name: 'milk' }])
    seedList(BOB.id, [{ name: 'caviar', checked: true }])
    const { DELETE } = await import('@/app/api/grocery/items/route')
    const res = await DELETE(new Request('http://t/api/grocery/items?checked=1', { method: 'DELETE' }))
    expect((await res.json()).deleted).toBe(1)
    expect(itemsOf(ALICE.id).map((i) => i.name)).toEqual(['milk'])
    expect(itemsOf(BOB.id)).toHaveLength(1)
  })

  it('refuses a bare collection delete', async () => {
    seedList(ALICE.id, [{ name: 'eggs' }])
    const { DELETE } = await import('@/app/api/grocery/items/route')
    expect((await DELETE(new Request('http://t/api/grocery/items', { method: 'DELETE' }))).status).toBe(400)
    expect(itemsOf(ALICE.id)).toHaveLength(1)
  })
})

describe('share: POST/DELETE /api/grocery/share and GET /api/grocery/shared/[token]', () => {
  it('creates a token once, returns the same one on repeat, rotates on request', async () => {
    const { POST, DELETE } = await import('@/app/api/grocery/share/route')
    const first = await (await POST(json({}))).json()
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const again = await (await POST(json({}))).json()
    expect(again.token).toBe(first.token)
    const rotated = await (await POST(json({ rotate: true }))).json()
    expect(rotated.token).not.toBe(first.token)
    expect(db.tables.grocery_lists[0].share_token).toBe(rotated.token)

    expect((await DELETE()).status).toBe(200)
    expect(db.tables.grocery_lists[0].share_token).toBeNull()
  })

  it("sharing or revoking never touches another user's list", async () => {
    seedList(BOB.id, [{ name: 'caviar' }], 'bobs-token-0123456789')
    const { POST, DELETE } = await import('@/app/api/grocery/share/route')
    await POST(json({ rotate: true }))
    await DELETE()
    expect(db.tables.grocery_lists.find((l) => l.user_id === BOB.id)?.share_token).toBe('bobs-token-0123456789')
  })

  it('the public read returns only unchecked lines, no ids, plus the share text', async () => {
    seedList(
      ALICE.id,
      [
        { name: 'eggs', quantity: 12, unit: 'item', category: 'dairy' },
        { name: 'milk', quantity: 1, unit: 'L', category: 'dairy' },
        { name: 'bread', checked: true },
      ],
      'alice-token-0123456789'
    )
    currentUser = null // a signed-out friend
    const { GET } = await import('@/app/api/grocery/shared/[token]/route')
    const res = await GET(new Request('http://t'), { params: Promise.resolve({ token: 'alice-token-0123456789' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json()
    expect(body.text).toBe('- Eggs (12 items)\n- Milk (1 L)')
    expect(body.items).toHaveLength(2)
    expect(JSON.stringify(body)).not.toMatch(/user_id|list_id|"id"|alice/)
  })

  it('an unknown, revoked or malformed token is an empty list, not an error or a hint', async () => {
    seedList(ALICE.id, [{ name: 'eggs' }], null)
    const { GET } = await import('@/app/api/grocery/shared/[token]/route')
    for (const token of ['never-issued-0123456789', "x'; drop table--1234567890", 'short']) {
      const res = await GET(new Request('http://t'), { params: Promise.resolve({ token }) })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ items: [], text: '' })
    }
  })
})

describe('AI-service proxies', () => {
  it('forward regenerate and from-meal to the AI service and pass the status through', async () => {
    jest.resetModules()
    const aiProxyFetch = jest.fn(async () => new Response(JSON.stringify({ added: 1 }), { status: 200 }))
    jest.doMock('@/lib/api/ai-proxy', () => ({ aiProxyFetch }))

    const regen = await import('@/app/api/ai/grocery/regenerate/route')
    const res = await regen.POST()
    expect(res.status).toBe(200)
    expect(aiProxyFetch).toHaveBeenCalledWith('/v1/grocery/regenerate', expect.objectContaining({ method: 'POST' }))

    const fromMeal = await import('@/app/api/ai/grocery/from-meal/route')
    await fromMeal.POST(json({ meal_id: 'm1' }))
    expect(aiProxyFetch).toHaveBeenLastCalledWith(
      '/v1/grocery/from-meal',
      expect.objectContaining({ body: JSON.stringify({ meal_id: 'm1' }) })
    )
  })
})
