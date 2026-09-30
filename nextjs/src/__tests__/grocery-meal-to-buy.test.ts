/**
 * Issue #497 (Spec B.5): a saved meal's to-buy list. The client
 * (`fetchMealToBuy`) and the proxy route to the AI service, plus the hookup the
 * held meal-screen action will use: fetch the names, then `addToGroceryList`.
 */

import { fetchMealToBuy } from '@/lib/api/grocery'
import { addToGroceryList, loadGroceryLines } from '@/lib/grocery-store'

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  window.localStorage.clear()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('fetchMealToBuy', () => {
  it('POSTs the meal id to the AI proxy and returns the names', async () => {
    fetchMock.mockResolvedValue(reply({ to_buy: ['fresh basil', 'spaghetti'] }))
    expect(await fetchMealToBuy('meal-1')).toEqual(['fresh basil', 'spaghetti'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ai/grocery/meal-to-buy')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ meal_id: 'meal-1' })
  })

  it('tolerates a missing or malformed list', async () => {
    fetchMock.mockResolvedValue(reply({}))
    expect(await fetchMealToBuy('m')).toEqual([])
    fetchMock.mockResolvedValue(reply({ to_buy: ['ok', 3, null] }))
    expect(await fetchMealToBuy('m')).toEqual(['ok'])
  })

  it('rejects with the server message (a meal that is not the caller\'s is a 404)', async () => {
    fetchMock.mockResolvedValue(reply({ detail: 'Meal not found' }, 404))
    await expect(fetchMealToBuy('nope')).rejects.toThrow('Meal not found')
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('x') } })
    await expect(fetchMealToBuy('m')).rejects.toThrow(/502/)
  })

  it('the meal-screen hookup: fetch the names, then append them to the manual set', async () => {
    fetchMock.mockResolvedValue(reply({ to_buy: ['fresh basil', 'feta'] }))
    addToGroceryList('u1', ['milk'])
    addToGroceryList('u1', await fetchMealToBuy('meal-1'))
    expect(loadGroceryLines('u1').map((l) => [l.name, l.source])).toEqual([
      ['feta', 'manual'],
      ['fresh basil', 'manual'],
      ['milk', 'manual'],
    ])
  })
})
