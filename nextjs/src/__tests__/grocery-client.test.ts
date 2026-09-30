/**
 * Issue #497 (Spec B.5, backend): the typed client in `lib/api/grocery.ts`.
 * Asserts the URLs, methods and bodies it sends (the wire contract the held
 * /grocery page will build on) and how it reports failures.
 */

import {
  fetchGroceryList,
  addGroceryItems,
  setGroceryItemChecked,
  updateGroceryItem,
  removeGroceryItem,
  clearCheckedGroceryItems,
  regenerateGroceryList,
  addMealToGroceryList,
  shareGroceryList,
  stopSharingGroceryList,
  fetchSharedGroceryList,
} from '@/lib/api/grocery'

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

function lastCall() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url: url as string, init: (init ?? {}) as RequestInit }
}

describe('grocery client', () => {
  it('fetchGroceryList → GET /api/grocery', async () => {
    fetchMock.mockResolvedValue(reply({ list: null, items: [] }))
    expect(await fetchGroceryList()).toEqual({ list: null, items: [] })
    expect(lastCall().url).toBe('/api/grocery')
  })

  it('addGroceryItems takes plain names (the meal screen passes string[])', async () => {
    fetchMock.mockResolvedValue(reply({ items: [{ id: '1', name: 'basil' }] }, 201))
    const items = await addGroceryItems(['basil', 'feta'])
    expect(items).toEqual([{ id: '1', name: 'basil' }])
    const { url, init } = lastCall()
    expect(url).toBe('/api/grocery/items')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ items: [{ name: 'basil' }, { name: 'feta' }] })
  })

  it('addGroceryItems also takes full line objects', async () => {
    fetchMock.mockResolvedValue(reply({ items: [] }, 201))
    await addGroceryItems([{ name: 'milk', quantity: 2, unit: 'L' }])
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      items: [{ name: 'milk', quantity: 2, unit: 'L' }],
    })
  })

  it('check / uncheck / edit / remove / clear', async () => {
    fetchMock.mockResolvedValue(reply({ item: { id: 'a b', checked: true }, deleted: true }))

    await setGroceryItemChecked('a b', true)
    expect(lastCall().url).toBe('/api/grocery/items/a%20b')
    expect(lastCall().init.method).toBe('PATCH')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ checked: true })

    await updateGroceryItem('x', { quantity: 3, unit: 'kg' })
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ quantity: 3, unit: 'kg' })

    await removeGroceryItem('x')
    expect(lastCall().init.method).toBe('DELETE')
    expect(lastCall().url).toBe('/api/grocery/items/x')

    fetchMock.mockResolvedValue(reply({ deleted: 2 }))
    expect(await clearCheckedGroceryItems()).toBe(2)
    expect(lastCall().url).toBe('/api/grocery/items?checked=1')
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('regenerate and add-meal go through the AI proxy routes', async () => {
    fetchMock.mockResolvedValue(reply({ added: 2, updated: 0, removed: 1, items: [] }))
    expect((await regenerateGroceryList()).added).toBe(2)
    expect(lastCall().url).toBe('/api/ai/grocery/regenerate')
    expect(lastCall().init.method).toBe('POST')

    fetchMock.mockResolvedValue(reply({ to_buy: ['basil'], added: ['basil'], already_on_list: [], items: [] }))
    const r = await addMealToGroceryList('meal 1')
    expect(r.to_buy).toEqual(['basil'])
    expect(lastCall().url).toBe('/api/ai/grocery/from-meal')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ meal_id: 'meal 1' })
  })

  it('share: token in, token out, revoke, and the public read', async () => {
    fetchMock.mockResolvedValue(reply({ token: 'tok-0123456789abcdef' }))
    expect(await shareGroceryList()).toBe('tok-0123456789abcdef')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({})
    await shareGroceryList({ rotate: true })
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ rotate: true })

    fetchMock.mockResolvedValue(reply({ shared: false }))
    await stopSharingGroceryList()
    expect(lastCall()).toMatchObject({ url: '/api/grocery/share', init: { method: 'DELETE' } })

    fetchMock.mockResolvedValue(reply({ items: [], text: '' }))
    await fetchSharedGroceryList('tok/0123456789abcdef')
    expect(lastCall().url).toBe('/api/grocery/shared/tok%2F0123456789abcdef')
  })

  it('surfaces the server message on a failure, including the AI service detail', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'That food is already on the list' }, 409))
    await expect(updateGroceryItem('x', { name: 'milk' })).rejects.toThrow('That food is already on the list')

    fetchMock.mockResolvedValue(reply({ detail: 'Meal not found' }, 404))
    await expect(addMealToGroceryList('nope')).rejects.toThrow('Meal not found')

    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json') } })
    await expect(regenerateGroceryList()).rejects.toThrow(/502/)
  })
})
