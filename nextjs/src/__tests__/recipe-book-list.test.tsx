/**
 * Issue #801: the Recipes tab lists saved recipes through the shared RecipeCard
 * (`saved` variant), not the old ruled-paper book with its sidebar. Search,
 * favourite, open, edit and delete all still work, and the opened recipe keeps
 * the pantry food tags (#784, PantryRecipeDetail).
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RecipeBook from '@/components/recipes/RecipeBook'
import type { Recipe } from '@/components/recipes/RecipePage'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

function recipe(over: Partial<Recipe> & { id: string; title: string }): Recipe {
  return {
    user_id: 'u1',
    ingredients: [{ name: 'pasta', quantity: 200, unit: 'g' }, 'saffron'],
    instructions: ['Boil the pasta.'],
    servings: 2,
    ...over,
  } as Recipe
}

const RECIPES: Recipe[] = [
  recipe({ id: 'r1', title: 'Creamy Tomato Pasta', cuisine: 'Italian', total_time_minutes: 30 }),
  recipe({ id: 'r2', title: 'Green Curry', cuisine: 'Thai', tags: ['spicy'], is_favorite: true }),
  recipe({ id: 'r3', title: 'Pancakes', description: 'Fluffy breakfast stack' }),
]

const MATCHES = {
  matches: [
    { name: 'pasta', status: 'have', pantry_food: 'pasta', basis: 'pantry' },
    { name: 'saffron', status: 'missing', pantry_food: null, basis: 'none' },
  ],
}

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })

let calls: { url: string; method: string; body?: unknown }[]

function mockFetch(overrides: Record<string, () => unknown> = {}) {
  calls = []
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (url.startsWith('/api/ai/pantry/match-ingredients')) return Promise.resolve(reply(MATCHES))
    const key = `${method} ${url}`
    if (overrides[key]) return Promise.resolve(overrides[key]())
    return Promise.resolve(reply({}))
  }) as unknown as typeof fetch
}

function renderBook(recipes = RECIPES, onMutate = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <RecipeBook recipes={recipes} onMutate={onMutate} />
    </QueryClientProvider>,
  )
  return { ...utils, onMutate }
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  mockFetch()
})

describe('Recipes tab list (issue #801)', () => {
  it('draws every saved recipe through the shared RecipeCard', () => {
    renderBook()
    const cards = screen.getAllByTestId('recipe-card-saved')
    expect(cards).toHaveLength(3)
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Creamy Tomato Pasta'),
      expect.stringContaining('Green Curry'),
      expect.stringContaining('Pancakes'),
    ])
  })

  it('no longer draws the book: no sidebar tab, no page indicator, no ruled paper', () => {
    renderBook()
    expect(screen.queryByRole('button', { name: 'Open recipe list' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next recipe' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Ingredients$/)).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no recipes', () => {
    renderBook([])
    expect(screen.getByText('No recipes yet')).toBeInTheDocument()
    expect(screen.queryByTestId('recipe-card-saved')).not.toBeInTheDocument()
  })

  describe('search', () => {
    it('filters the list, best match first, and says so when nothing matches', async () => {
      jest.useFakeTimers()
      try {
        renderBook()
        const input = screen.getByPlaceholderText('Search your recipes...')

        fireEvent.change(input, { target: { value: 'curry' } })
        act(() => {
          jest.advanceTimersByTime(350)
        })
        const cards = screen.getAllByTestId('recipe-card-saved')
        expect(cards).toHaveLength(1)
        expect(cards[0]).toHaveTextContent('Green Curry')

        fireEvent.change(input, { target: { value: 'zzzz' } })
        act(() => {
          jest.advanceTimersByTime(350)
        })
        expect(screen.queryByTestId('recipe-card-saved')).not.toBeInTheDocument()
        expect(screen.getByText(/No results for .zzzz./)).toBeInTheDocument()
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('favourite', () => {
    it('flips the heart at once and saves it with PUT is_favorite', async () => {
      renderBook()
      fireEvent.click(screen.getByRole('button', { name: 'Favorite: Creamy Tomato Pasta' }))
      expect(screen.getByRole('button', { name: 'Unfavorite: Creamy Tomato Pasta' })).toBeInTheDocument()
      await waitFor(() =>
        expect(calls).toContainEqual({ url: '/api/recipes/r1', method: 'PUT', body: { is_favorite: true } }),
      )
    })

    it('unfavourites an already favourite recipe', async () => {
      renderBook()
      fireEvent.click(screen.getByRole('button', { name: 'Unfavorite: Green Curry' }))
      expect(screen.getByRole('button', { name: 'Favorite: Green Curry' })).toBeInTheDocument()
      await waitFor(() =>
        expect(calls).toContainEqual({ url: '/api/recipes/r2', method: 'PUT', body: { is_favorite: false } }),
      )
    })

    it('puts the heart back and says so when the save fails', async () => {
      mockFetch({ 'PUT /api/recipes/r1': () => reply({}, 500) })
      renderBook()
      fireEvent.click(screen.getByRole('button', { name: 'Favorite: Creamy Tomato Pasta' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not update favorite')
      expect(screen.getByRole('button', { name: 'Favorite: Creamy Tomato Pasta' })).toBeInTheDocument()
    })
  })

  describe('open', () => {
    it('opens the recipe in place with its pantry food tags, and Back returns to the list', async () => {
      renderBook()
      fireEvent.click(screen.getByRole('button', { name: 'Open recipe: Creamy Tomato Pasta' }))

      // One card now (the header), and the detail with its ingredients and tags.
      expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(1)
      expect(screen.getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument()
      // Pasta is stocked; saffron is missing, which reads To buy (issue #805), not no tag.
      await waitFor(() => expect(screen.getAllByTestId('ingredient-tag')).toHaveLength(2))
      expect(screen.getAllByTestId('ingredient-tag').map((t) => t.textContent)).toEqual([
        'In pantry',
        'To buy',
      ])
      expect(screen.getByRole('button', { name: 'Cook this recipe' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Back to recipes/ }))
      expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(3)
    })

    it('Cook this recipe opens the guided cook flow', () => {
      renderBook()
      fireEvent.click(screen.getByRole('button', { name: 'Open recipe: Pancakes' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cook this recipe' }))
      expect(screen.getByTestId('guided-cook-flow')).toBeInTheDocument()
    })
  })

  describe('edit', () => {
    it('opens the edit sheet from the card menu and saves with PUT', async () => {
      const { onMutate } = renderBook()
      fireEvent.click(screen.getByRole('button', { name: 'More options for Green Curry' }))
      fireEvent.click(screen.getByRole('button', { name: /Edit/ }))

      const title = await screen.findByDisplayValue('Green Curry')
      fireEvent.change(title, { target: { value: 'Red Curry' } })
      fireEvent.click(screen.getByRole('button', { name: /^save/i }))

      await waitFor(() => expect(onMutate).toHaveBeenCalled())
      const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/recipes/r2')
      expect(put?.body).toMatchObject({ title: 'Red Curry' })
    })
  })

  describe('delete', () => {
    it('confirms under the card, names the meals it is in, then DELETEs and refreshes', async () => {
      const recipes = [...RECIPES]
      recipes[0] = { ...recipes[0], meal_titles: ['Pasta night'] }
      const { onMutate } = renderBook(recipes)

      fireEvent.click(screen.getByRole('button', { name: 'More options for Creamy Tomato Pasta' }))
      fireEvent.click(screen.getByRole('button', { name: /Delete/ }))

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveTextContent('Creamy Tomato Pasta')
      expect(dialog).toHaveTextContent('Pasta night')
      // The confirm sits with the card it is about.
      expect(dialog.closest('li')).toContainElement(screen.getAllByTestId('recipe-card-saved')[0])

      fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))
      await waitFor(() => expect(onMutate).toHaveBeenCalled())
      expect(calls).toContainEqual({ url: '/api/recipes/r1', method: 'DELETE', body: undefined })
    })

    it('Cancel leaves the recipe alone', () => {
      renderBook()
      fireEvent.click(screen.getByRole('button', { name: 'More options for Pancakes' }))
      fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
      expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(3)
    })
  })
})
