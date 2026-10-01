/**
 * Issue #784: the ingredient-to-pantry match client. It answers in the cook
 * proposal's `IngredientMatch` shape (so the food tags read it as they read a
 * cook proposal), and any failure rejects so the recipe card can render its
 * lines without tags instead of an error.
 */

import { fetchIngredientMatches } from '@/lib/api/ingredient-match'
import { pantryTag } from '@/components/recipes/ingredient-tags'

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

const lines = [{ name: 'flour', quantity: 200, unit: 'g' }, { name: 'saffron' }]

describe('fetchIngredientMatches', () => {
  it('POSTs the lines to the AI proxy and returns one match per line, in order', async () => {
    fetchMock.mockResolvedValue(
      reply({
        matches: [
          { name: 'flour', status: 'have', pantry_food: 'plain flour', basis: 'pantry' },
          { name: 'saffron', status: 'missing', pantry_food: null, basis: 'none' },
        ],
      })
    )
    const got = await fetchIngredientMatches(lines)
    expect(got.map((m) => [m.ingredient_name, m.status, m.pantry_item_name])).toEqual([
      ['flour', 'ready', 'plain flour'],
      ['saffron', 'missing', null],
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ai/pantry/match-ingredients')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      ingredients: [
        { name: 'flour', quantity: 200, unit: 'g' },
        { name: 'saffron', quantity: null, unit: null },
      ],
    })
  })

  it('passes free-text lines through as they are', async () => {
    fetchMock.mockResolvedValue(reply({ matches: [{ name: 'flour', status: 'have', basis: 'pantry' }] }))
    await fetchIngredientMatches(['200 g flour'])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ingredients: ['200 g flour'] })
  })

  it('maps low / staple / to-taste onto the statuses the food tags understand', async () => {
    fetchMock.mockResolvedValue(
      reply({
        matches: [
          { name: 'butter', status: 'low', pantry_food: 'butter', basis: 'pantry', pantry_qty_available: 50, shortfall: 50 },
          { name: 'salt', status: 'have', basis: 'assumed' },
          { name: 'salt and pepper', status: 'have', basis: 'to_taste' },
        ],
      })
    )
    const got = await fetchIngredientMatches(['butter', 'salt', 'salt and pepper'])
    expect(got.map((m) => m.status)).toEqual(['shortfall', 'assumed', 'to_taste'])
    expect(got.map((m) => pantryTag(m)?.label ?? null)).toEqual(['Short ½', 'Staple', null])
  })

  it('does not call the network for no lines', async () => {
    expect(await fetchIngredientMatches([])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(reply({ detail: 'down' }, 502))
    await expect(fetchIngredientMatches(lines)).rejects.toThrow(/502/)
  })

  it('rejects when the network call itself fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchIngredientMatches(lines)).rejects.toThrow()
  })

  it('rejects a response that is not one entry per line', async () => {
    fetchMock.mockResolvedValue(reply({ matches: [{ status: 'have' }] }))
    await expect(fetchIngredientMatches(lines)).rejects.toThrow(/unexpected/)
    fetchMock.mockResolvedValue(reply({}))
    await expect(fetchIngredientMatches(lines)).rejects.toThrow(/unexpected/)
  })

  it('rejects an unknown status rather than guessing', async () => {
    fetchMock.mockResolvedValue(reply({ matches: [{ status: 'have' }, { status: 'maybe' }] }))
    await expect(fetchIngredientMatches(lines)).rejects.toThrow(/status/)
  })
})
