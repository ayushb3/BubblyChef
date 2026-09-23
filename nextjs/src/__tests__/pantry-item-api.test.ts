/**
 * Issue #478 — `updatePantryItem` / `deletePantryItem` in `lib/api/pantry.ts`.
 *
 * The edit modal used to call `fetch` directly for its PUT and DELETE, the
 * only single-item write paths in the app. They now live in the per-domain
 * client like every other call. These pin the request shape the route
 * expects (method, path, JSON body) and the error contract the modal shows
 * verbatim. Kitchen location is not part of the update input any more
 * (issue #397); the row the server returns still carries the column.
 */
import { updatePantryItem, deletePantryItem } from '@/lib/api/pantry'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('updatePantryItem (#478)', () => {
  it('PUTs a JSON body to /api/pantry/[id] and returns the updated row', async () => {
    const updated = {
      id: 'abc',
      name: 'oat milk',
      category: 'dairy',
      location: 'fridge',
      quantity: 2,
      unit: 'quart',
      expiry_date: '2026-10-01',
    }
    const fetchMock = jest.fn(async () => jsonResponse(updated))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await updatePantryItem('abc', {
      name: 'oat milk',
      quantity: 2,
      unit: 'quart',
      category: 'dairy',
      expiry_date: '2026-10-01',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/pantry/abc')
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'oat milk',
      quantity: 2,
      unit: 'quart',
      category: 'dairy',
      expiry_date: '2026-10-01',
    })
    expect(result).toEqual(updated)
  })

  it('sends expiry_date: null through (clearing a date), not undefined', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ id: 'abc' }))
    global.fetch = fetchMock as unknown as typeof fetch

    await updatePantryItem('abc', { expiry_date: null })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ expiry_date: null })
  })

  it('throws the session-expired message on a 401', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401)) as unknown as typeof fetch

    await expect(updatePantryItem('abc', { name: 'x' })).rejects.toThrow(/sign in again/i)
  })

  it('shows friendly copy, not the raw server error, on any other failure', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ error: 'row is locked' }, 500)) as unknown as typeof fetch

    const err = await updatePantryItem('abc', { name: 'x' }).catch((e: Error) => e)
    expect((err as Error).message).toBe("Couldn't save that item. Please try again.")
  })

  it('shows the network message, not "Failed to fetch", when the request never lands', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    const err = await updatePantryItem('abc', { name: 'x' }).catch((e: Error) => e)
    expect((err as Error).message).toBe('Network problem — check your connection and try again.')
  })

  it('uses the same friendly copy when the error body is not JSON', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })) as unknown as typeof fetch

    await expect(updatePantryItem('abc', { name: 'x' })).rejects.toThrow(
      "Couldn't save that item. Please try again.",
    )
  })
})

describe('deletePantryItem (#478)', () => {
  it('sends DELETE to /api/pantry/[id] and resolves with nothing', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ deleted: true }))
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(deletePantryItem('abc')).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // No ?date= (#524/#570 review): DELETE never records waste, so it no
    // longer needs the client's local date at all.
    expect(url).toBe('/api/pantry/abc')
    expect(init.method).toBe('DELETE')
  })

  it('shows friendly copy, not the raw server error, when the delete is rejected', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ error: 'Pantry item not found' }, 404)) as unknown as typeof fetch

    const err = await deletePantryItem('missing').catch((e: Error) => e)
    expect((err as Error).message).toBe("Couldn't delete that item. Please try again.")
  })

  it('shows the network message when the delete never lands', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    const err = await deletePantryItem('abc').catch((e: Error) => e)
    expect((err as Error).message).toBe('Network problem — check your connection and try again.')
  })
})
