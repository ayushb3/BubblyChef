/**
 * @jest-environment node
 *
 * Issue #140 — POST /api/pantry/[id]/resolve
 *
 * Frozen contract:
 *   request  { outcome: 'used' | 'tossed' }
 *   success  200 { resolved: true, id, outcome, event_id }
 *   errors   400 invalid/missing outcome · 401 unauthenticated ·
 *            404 item not found / not owned by caller
 *
 * Route handlers need the Web Fetch API globals (Request/Response) that
 * Node provides natively but jsdom (this project's default test
 * environment — see jest.config.js) does not; hence the environment
 * override above, scoped to just this file.
 */
jest.mock('@/lib/response-helpers', () => {
  const actual = jest.requireActual('@/lib/response-helpers')
  return {
    ...actual,
    requireAuth: jest.fn(),
  }
})

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/pantry/[id]/resolve/route'
import { requireAuth } from '@/lib/response-helpers'

const mockRequireAuth = requireAuth as jest.Mock

const USER = { id: 'user-1' }

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(body: unknown) {
  return { json: async () => body } as unknown as Request
}

/**
 * Chainable stand-in for a Supabase `PostgrestFilterBuilder`. `.eq()` chains;
 * `.single()` resolves like the real client. Chains ending without `.single()`
 * (the delete chain) are awaited directly, so the object itself must be
 * thenable.
 */
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn(async () => result),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

interface SupabaseMockConfig {
  fetchResult: { data: unknown; error: unknown }
  insertResult?: { data: unknown; error: unknown }
  deleteResult?: { data: unknown; error: unknown }
}

function makeSupabase({ fetchResult, insertResult, deleteResult }: SupabaseMockConfig) {
  const selectChain = makeChain(fetchResult)
  const insertChain = makeChain(insertResult ?? { data: { id: 'event-1' }, error: null })
  const deleteChain = makeChain(deleteResult ?? { data: null, error: null })

  // Kept stable across calls (not recreated per `from()` invocation) so tests
  // can assert on what the route actually passed to `.insert(...)`.
  const insertMock = jest.fn<ReturnType<typeof makeChain>, [Record<string, unknown>]>(
    () => insertChain,
  )

  const from = jest.fn((table: string) => {
    if (table === 'pantry_items') {
      return {
        select: jest.fn(() => selectChain),
        delete: jest.fn(() => deleteChain),
      }
    }
    if (table === 'pantry_events') {
      return {
        insert: insertMock,
      }
    }
    throw new Error(`unexpected table: ${table}`)
  })

  return { from, selectChain, insertChain, deleteChain, insertMock }
}

describe('POST /api/pantry/[id]/resolve', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset()
  })

  it('401s when unauthenticated', async () => {
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    mockRequireAuth.mockResolvedValue(unauthorized)

    const res = await POST(makeRequest({ outcome: 'used' }), makeParams('item-1'))

    expect(res.status).toBe(401)
  })

  it('400s on a missing outcome', async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase({ fetchResult: { data: null, error: null } }), USER])

    const res = await POST(makeRequest({}), makeParams('item-1'))

    expect(res.status).toBe(400)
  })

  it('400s on an invalid outcome (e.g. "cooked", which is reserved for the cook-confirm flow)', async () => {
    mockRequireAuth.mockResolvedValue([makeSupabase({ fetchResult: { data: null, error: null } }), USER])

    const res = await POST(makeRequest({ outcome: 'cooked' }), makeParams('item-1'))

    expect(res.status).toBe(400)
  })

  it('404s when the item does not exist or is not owned by the caller', async () => {
    const supabase = makeSupabase({ fetchResult: { data: null, error: { message: 'no rows' } } })
    mockRequireAuth.mockResolvedValue([supabase, USER])

    const res = await POST(makeRequest({ outcome: 'used' }), makeParams('someone-elses-item'))

    expect(res.status).toBe(404)
    expect(supabase.from).toHaveBeenCalledWith('pantry_items')
  })

  it('resolves a "used" item: inserts the event, deletes the item, returns the frozen shape', async () => {
    const item = {
      id: 'item-1',
      name: 'Eggs',
      quantity: 6,
      unit: 'count',
      expiry_date: null,
    }
    const supabase = makeSupabase({
      fetchResult: { data: item, error: null },
      insertResult: { data: { id: 'event-abc' }, error: null },
    })
    mockRequireAuth.mockResolvedValue([supabase, USER])

    const res = await POST(makeRequest({ outcome: 'used' }), makeParams('item-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({
      resolved: true,
      id: 'item-1',
      outcome: 'used',
      event_id: 'event-abc',
    })
  })

  it('resolves a "tossed" item the same way', async () => {
    const item = { id: 'item-2', name: 'Milk', quantity: 1, unit: 'carton', expiry_date: null }
    const supabase = makeSupabase({
      fetchResult: { data: item, error: null },
      insertResult: { data: { id: 'event-xyz' }, error: null },
    })
    mockRequireAuth.mockResolvedValue([supabase, USER])

    const res = await POST(makeRequest({ outcome: 'tossed' }), makeParams('item-2'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.outcome).toBe('tossed')
    expect(json.event_id).toBe('event-xyz')
  })

  it('records a negative days_until_expiry for an already-expired item', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 3)
    const item = {
      id: 'item-3',
      name: 'Yogurt',
      quantity: 1,
      unit: 'cup',
      expiry_date: yesterday.toISOString().slice(0, 10),
    }
    const supabase = makeSupabase({
      fetchResult: { data: item, error: null },
      insertResult: { data: { id: 'event-3' }, error: null },
    })
    mockRequireAuth.mockResolvedValue([supabase, USER])

    await POST(makeRequest({ outcome: 'tossed' }), makeParams('item-3'))

    const insertCall = supabase.insertMock.mock.calls[0][0]
    expect(insertCall.days_until_expiry).toBeLessThan(0)
    expect(insertCall.item_name).toBe('Yogurt')
    expect(insertCall.outcome).toBe('tossed')
  })

  it('does not report success if the delete fails after the event is written', async () => {
    const item = { id: 'item-4', name: 'Bread', quantity: 1, unit: 'loaf', expiry_date: null }
    const supabase = makeSupabase({
      fetchResult: { data: item, error: null },
      insertResult: { data: { id: 'event-4' }, error: null },
      deleteResult: { data: null, error: { message: 'delete failed' } },
    })
    mockRequireAuth.mockResolvedValue([supabase, USER])

    const res = await POST(makeRequest({ outcome: 'used' }), makeParams('item-4'))

    expect(res.status).toBe(500)
  })
})
