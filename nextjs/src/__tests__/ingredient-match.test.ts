/**
 * Issue #784: the ingredient-to-pantry match client. Any failure rejects, so the
 * recipe card can render its lines without tags instead of an error.
 */

import { fetchIngredientMatches } from '@/lib/api/ingredient-match'

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
          { name: 'flour', status: 'have', pantry_food: 'plain flour' },
          { name: 'saffron', status: 'missing', pantry_food: null },
        ],
      })
    )
    expect(await fetchIngredientMatches(lines)).toEqual([
      { status: 'have', pantryFood: 'plain flour' },
      { status: 'missing', pantryFood: null },
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
