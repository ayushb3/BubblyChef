/**
 * Issue #805: the per-card "N to buy" line takes its dishes from the service's
 * `items[].dish_positions` (the service decides "same food" with
 * `normalize_food_name`; the client no longer re-matches names with a different
 * key), and falls back to name matching only when an older service sends no
 * `items`.
 */

import { fetchMealToBuyDetail } from '@/lib/api/grocery'
import { toBuyByDish } from '@/lib/meal-to-buy'

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('fetchMealToBuyDetail', () => {
  it('returns the names and the per-dish items', async () => {
    fetchMock.mockResolvedValue(
      reply({
        to_buy: ['fresh basil'],
        items: [{ name: 'fresh basil', dish_positions: [0, 1], dish_names: ['fresh basil', 'basil'] }],
      }),
    )
    expect(await fetchMealToBuyDetail('m')).toEqual({
      names: ['fresh basil'],
      items: [
        {
          name: 'fresh basil',
          dishPositions: [0, 1],
          dishNames: ['fresh basil', 'basil'],
          // No amount fields on the wire (an older service): no amount (issue #850).
          quantity: null,
          unit: null,
          category: null,
        },
      ],
    })
  })

  it('items is null when an older service sends none, or a malformed one', async () => {
    fetchMock.mockResolvedValue(reply({ to_buy: ['onion'] }))
    expect(await fetchMealToBuyDetail('m')).toEqual({ names: ['onion'], items: null })
    fetchMock.mockResolvedValue(reply({ to_buy: ['onion'], items: [{ name: 'onion' }] }))
    expect(await fetchMealToBuyDetail('m')).toEqual({ names: ['onion'], items: null })
    fetchMock.mockResolvedValue(
      reply({ to_buy: ['onion'], items: [{ name: 'onion', dish_positions: [0, 1], dish_names: ['onion'] }] }),
    )
    expect((await fetchMealToBuyDetail('m')).items).toBeNull()
  })

  it('rejects with the server message on a failure, like fetchMealToBuy', async () => {
    fetchMock.mockResolvedValue(reply({ detail: 'Meal not found' }, 404))
    await expect(fetchMealToBuyDetail('nope')).rejects.toThrow('Meal not found')
  })
})

const DISHES = [
  { position: 0, names: ['fresh basil', 'onion'] },
  { position: 1, names: ['basil', 'cucumber'] },
]

describe('toBuyByDish', () => {
  it('uses dish_positions: "fresh basil" and "basil" are one entry on both cards, each as written', () => {
    const result = toBuyByDish(
      {
        names: ['fresh basil', 'cucumber'],
        items: [
          { name: 'fresh basil', dishPositions: [0, 1], dishNames: ['fresh basil', 'basil'] },
          { name: 'cucumber', dishPositions: [1], dishNames: ['cucumber'] },
        ],
      },
      DISHES,
    )
    expect(result.get(0)).toEqual(['fresh basil'])
    expect(result.get(1)).toEqual(['basil', 'cucumber'])
  })

  it('does not re-match names: the service\'s positions win over what the names suggest', () => {
    const result = toBuyByDish(
      { names: ['onion'], items: [{ name: 'onion', dishPositions: [1], dishNames: ['onion'] }] },
      DISHES,
    )
    expect(result.get(0)).toEqual([])
    expect(result.get(1)).toEqual(['onion'])
  })

  it('every dish has an entry, and a position no dish has is dropped', () => {
    const result = toBuyByDish(
      { names: ['x'], items: [{ name: 'x', dishPositions: [7], dishNames: ['x'] }] },
      DISHES,
    )
    expect([...result.keys()]).toEqual([0, 1])
    expect(result.get(0)).toEqual([])
  })

  it('falls back to name matching when the service sent no items (older service during a deploy)', () => {
    const result = toBuyByDish({ names: ['onion', 'cucumber'], items: null }, DISHES)
    expect(result.get(0)).toEqual(['onion'])
    expect(result.get(1)).toEqual(['cucumber'])
  })
})
