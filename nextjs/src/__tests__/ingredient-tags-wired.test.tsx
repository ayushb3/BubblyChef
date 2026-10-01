/**
 * Issue #784: the recipe page and the meal's dish cards wear real pantry food
 * tags, fed by the deterministic ingredient match; when the call fails they
 * render the same rows with no tags (not an error).
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryRecipeDetail from '@/components/recipes/PantryRecipeDetail'
import RecipeCard from '@/components/recipes/RecipeCard'
import type { Recipe } from '@/components/recipes/RecipePage'

jest.mock('@/components/timers/HeaderQuickSetTimers', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/timers/StepTimerChip', () => ({ __esModule: true, default: () => null }))

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })

const MATCHES = {
  matches: [
    { name: 'onions', status: 'have', pantry_food: 'onions', basis: 'pantry' },
    { name: 'butter', status: 'low', pantry_food: 'butter', basis: 'pantry', pantry_qty_available: 50, shortfall: 50 },
    { name: 'saffron', status: 'missing', pantry_food: null, basis: 'none' },
  ],
}

const recipe: Recipe = {
  id: 'r1',
  user_id: 'u1',
  title: 'Soup',
  ingredients: ['2 onions', { name: 'butter', quantity: 100, unit: 'g' }, 'saffron'],
  instructions: ['Cook.'],
}

describe('recipe page food tags', () => {
  it('tags each ingredient from the match; a missing one is untagged', async () => {
    fetchMock.mockResolvedValue(reply(MATCHES))
    render(withClient(<PantryRecipeDetail recipe={recipe} />))
    await waitFor(() => expect(screen.getAllByTestId('ingredient-tag')).toHaveLength(2))
    expect(screen.getAllByTestId('ingredient-tag').map((t) => t.textContent)).toEqual([
      'In pantry',
      'Short ½',
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      ingredients: ['2 onions', { name: 'butter', quantity: 100, unit: 'g' }, 'saffron'],
    })
  })

  it('renders the ingredients with no tags and no error when the call fails', async () => {
    fetchMock.mockResolvedValue(reply({ detail: 'down' }, 502))
    render(withClient(<PantryRecipeDetail recipe={recipe} />))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText('2 onions')).toBeInTheDocument()
    expect(screen.queryByTestId('ingredient-tag')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders with no tags when the request itself throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(withClient(<PantryRecipeDetail recipe={recipe} />))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText('saffron')).toBeInTheDocument()
    expect(screen.queryByTestId('ingredient-tag')).not.toBeInTheDocument()
  })
})

describe('staleness', () => {
  it('a pantry invalidation (add, edit, delete, cook confirm) refetches the match and updates the tags', async () => {
    fetchMock.mockResolvedValueOnce(reply(MATCHES))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <PantryRecipeDetail recipe={recipe} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getAllByTestId('ingredient-tag')).toHaveLength(2))

    // The user then restocks butter: the next match says it is covered.
    fetchMock.mockResolvedValueOnce(
      reply({
        matches: [
          MATCHES.matches[0],
          { name: 'butter', status: 'have', pantry_food: 'butter', basis: 'pantry' },
          MATCHES.matches[2],
        ],
      }),
    )
    await client.invalidateQueries({ queryKey: ['pantry'] })
    await waitFor(() =>
      expect(screen.getAllByTestId('ingredient-tag').map((t) => t.textContent)).toEqual([
        'In pantry',
        'In pantry',
      ]),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('meal dish card food tags', () => {
  const ingredients = [{ name: 'onions', quantity: 2 }, { name: 'butter', quantity: 100, unit: 'g' }]
  const matches = [
    { ingredient_name: 'onions', status: 'ready' },
    { ingredient_name: 'butter', status: 'shortfall', pantry_qty_available: 50, shortfall: 50 },
  ] as never

  it('wears a tag on an expanded ingredient row when row matches are given', () => {
    render(
      <RecipeCard
        variant="dish"
        role="main"
        title="Soup"
        ingredients={ingredients}
        instructions={['Cook.']}
        rowMatches={matches}
      />,
    )
    expect(screen.getAllByTestId('ingredient-tag').map((t) => t.textContent)).toEqual([
      'In pantry',
      'Short ½',
    ])
  })

  it('shows no tags without matches', () => {
    render(<RecipeCard variant="dish" role="main" title="Soup" ingredients={ingredients} instructions={['Cook.']} />)
    expect(screen.queryByTestId('ingredient-tag')).not.toBeInTheDocument()
  })
})
