/**
 * Bulk edits in the storage sheet's List (issue #750): "Move to <place>" and
 * "Used up" / "Tossed" on several selected items go through the existing
 * per-item endpoints (`PUT /api/pantry/[id]`, `POST /api/pantry/[id]/resolve`),
 * one at a time, and report exactly which items did and did not go through so
 * the sheet can keep the failed ones selected.
 */
import { movePantryItems, resolvePantryItems } from '@/lib/api/pantry'

type Call = { url: string; method: string; body: Record<string, unknown> }

function mockFetch(failIds: string[] = [], calls: Call[] = []) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : {},
    })
    const id = /\/api\/pantry\/([^/]+)/.exec(url)![1]
    if (failIds.includes(id)) {
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({ id }) } as Response
  }) as unknown as typeof fetch
  return calls
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

describe('movePantryItems', () => {
  it('saves the new location on every item, through the per-item endpoint', async () => {
    const calls = mockFetch()
    const result = await movePantryItems(['a', 'b', 'c'], 'freezer')
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['PUT', '/api/pantry/a', { location: 'freezer' }],
      ['PUT', '/api/pantry/b', { location: 'freezer' }],
      ['PUT', '/api/pantry/c', { location: 'freezer' }],
    ])
    expect(result).toEqual({ done: ['a', 'b', 'c'], failed: [] })
  })

  it('carries on past a failure and says which items failed', async () => {
    const calls = mockFetch(['b'])
    const result = await movePantryItems(['a', 'b', 'c'], 'counter')
    expect(calls).toHaveLength(3)
    expect(result).toEqual({ done: ['a', 'c'], failed: ['b'] })
  })

  it('treats a network failure as a failed item, not a thrown error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
    await expect(movePantryItems(['a'], 'fridge')).resolves.toEqual({ done: [], failed: ['a'] })
  })
})

describe('resolvePantryItems', () => {
  it('records the outcome on every item', async () => {
    const calls = mockFetch()
    const result = await resolvePantryItems(['a', 'b'], 'used')
    expect(calls.map((c) => [c.method, c.url, c.body.outcome])).toEqual([
      ['POST', '/api/pantry/a/resolve', 'used'],
      ['POST', '/api/pantry/b/resolve', 'used'],
    ])
    expect(result).toEqual({ done: ['a', 'b'], failed: [] })
  })

  it('sends "tossed" as tossed, never as used', async () => {
    const calls = mockFetch()
    await resolvePantryItems(['a'], 'tossed')
    expect(calls[0].body.outcome).toBe('tossed')
  })

  it('reports the items that failed', async () => {
    mockFetch(['a'])
    await expect(resolvePantryItems(['a', 'b'], 'tossed')).resolves.toEqual({
      done: ['b'],
      failed: ['a'],
    })
  })
})
