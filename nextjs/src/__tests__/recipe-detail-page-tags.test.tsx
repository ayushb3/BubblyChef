/**
 * Issue #784: the `/recipes/[id]` page ("Open recipe" from the meal screen) wears
 * the same pantry food tags as the recipe book, and renders its ingredient rows
 * with no tags and no error when the match call fails.
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RecipeDetailPage from '@/app/recipes/[id]/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'recipe-1' }),
  useRouter: () => ({ push: jest.fn() }),
}))

const RECIPE = {
  id: 'recipe-1',
  title: 'Tomato butter pasta',
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'butter', quantity: 100, unit: 'g' },
    'saffron',
  ],
  instructions: ['Boil the pasta.'],
}

const MATCHES = {
  matches: [
    { name: 'pasta', status: 'have', pantry_food: 'pasta', basis: 'pantry' },
    { name: 'butter', status: 'low', pantry_food: 'butter', basis: 'pantry', pantry_qty_available: 50, shortfall: 50 },
    { name: 'saffron', status: 'missing', pantry_food: null, basis: 'none' },
  ],
}

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RecipeDetailPage />
    </QueryClientProvider>,
  )
}

/** Routes by URL: the recipe, then the match call (whatever `match` returns). */
function mockFetch(match: () => unknown) {
  global.fetch = jest.fn((url: string) =>
    Promise.resolve(url.startsWith('/api/ai/pantry/match-ingredients') ? match() : reply(RECIPE)),
  ) as unknown as typeof fetch
}

describe('RecipeDetailPage food tags (#784)', () => {
  it('tags each ingredient from the pantry match; a missing one is untagged', async () => {
    mockFetch(() => reply(MATCHES))
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId('ingredient-tag')).toHaveLength(2))
    expect(screen.getAllByTestId('ingredient-tag').map((t) => t.textContent)).toEqual([
      'In pantry',
      'Short ½',
    ])
  })

  it('two lines of one food each get their own tag (2 eggs in stock: "2 eggs" is covered, "1 egg" is short)', async () => {
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        url.startsWith('/api/ai/pantry/match-ingredients')
          ? reply({
              matches: [
                { name: 'eggs', status: 'have', pantry_food: 'eggs', basis: 'pantry', pantry_qty_available: 2, shortfall: null },
                { name: 'egg', status: 'low', pantry_food: 'eggs', basis: 'pantry', pantry_qty_available: 0, shortfall: 1 },
              ],
            })
          : reply({ ...RECIPE, ingredients: ['2 eggs', '1 egg'] }),
      ),
    ) as unknown as typeof fetch
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId('ingredient-tag')).toHaveLength(2))
    expect(screen.getAllByTestId('ingredient-tag').map((t) => t.textContent)).toEqual(['In pantry', 'Short'])
  })

  it('renders the ingredients with no tags and no error when the call fails', async () => {
    mockFetch(() => reply({ detail: 'down' }, 502))
    renderPage()
    expect(await screen.findByText('saffron')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('match-ingredients')),
      ).toBe(true),
    )
    expect(screen.queryByTestId('ingredient-tag')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders with no tags when the request itself throws', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    renderPage()
    expect(await screen.findByText('saffron')).toBeInTheDocument()
    expect(screen.queryByTestId('ingredient-tag')).not.toBeInTheDocument()
  })
})
