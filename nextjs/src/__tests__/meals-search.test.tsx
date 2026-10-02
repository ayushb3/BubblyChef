/**
 * Issue #904: the library's Meals tab had no search (only the Recipes tab did).
 * The Meals tab now has the same search bar, filtering client-side by meal title
 * and dish titles, with the same "No results for ..." copy. Each tab keeps its
 * own query, so switching tabs never leaves a filter on the other list.
 */
import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? 'meals' : null) }),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecipeBookLoader = require('@/components/recipes/RecipeBookLoader').default as () => React.JSX.Element

const dish = (title: string, position: number, role: 'main' | 'side' = 'side') => ({
  role,
  position,
  recipe_id: `d-${title}`,
  title,
  total_time_minutes: 30,
})

const MEALS = [
  {
    id: 'm1',
    title: 'Sunday Roast',
    servings: 4,
    is_draft: false,
    dishes: [dish('Roast Chicken', 0, 'main'), dish('Garlic Green Beans', 1)],
  },
  {
    id: 'm2',
    title: 'Taco Night',
    servings: 4,
    is_draft: false,
    dishes: [dish('Carnitas Tacos', 0, 'main'), dish('Mango Salsa', 1)],
  },
]

const RECIPES = [
  {
    id: 'r1',
    user_id: 'u1',
    title: 'Lentil Soup',
    is_favorite: true,
    ingredients: ['lentils'],
    instructions: ['Simmer.'],
    servings: 2,
  },
  {
    id: 'r2',
    user_id: 'u1',
    title: 'Pancakes',
    ingredients: ['flour'],
    instructions: ['Fry.'],
    servings: 2,
  },
]

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  global.fetch = jest.fn((url: string) => {
    if (url.startsWith('/api/meals')) return Promise.resolve(reply({ meals: MEALS }))
    if (url.startsWith('/api/recipes')) {
      return Promise.resolve(
        reply({ recipes: RECIPES, total_count: RECIPES.length, limit: 50, offset: 0 }),
      )
    }
    return Promise.resolve(reply({}))
  }) as unknown as typeof fetch
})

function renderLoader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RecipeBookLoader />
    </QueryClientProvider>,
  )
}

async function typeInto(placeholder: string, text: string) {
  const input = await screen.findByPlaceholderText(placeholder)
  fireEvent.change(input, { target: { value: text } })
  // The bar debounces by 300ms, same as the Recipes tab.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400))
  })
}

const mealList = () => screen.findByRole('list', { name: 'Saved meals' })

describe('Meals tab search (issue #904)', () => {
  it('shows a search bar above the meals list', async () => {
    renderLoader()
    expect(await screen.findByPlaceholderText('Search your meals...')).toBeInTheDocument()
    expect(within(await mealList()).getAllByRole('listitem')).toHaveLength(2)
  })

  it('finds a meal by its title', async () => {
    renderLoader()
    await typeInto('Search your meals...', 'taco')
    const items = within(await mealList()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Taco Night')
  })

  it('finds a meal by a dish title, main or side, case-insensitively', async () => {
    renderLoader()
    await typeInto('Search your meals...', 'GREEN BEANS')
    let items = within(await mealList()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Sunday Roast')

    await typeInto('Search your meals...', 'carnitas')
    items = within(await mealList()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Taco Night')
  })

  it('says "No results for" the query when nothing matches', async () => {
    renderLoader()
    await typeInto('Search your meals...', 'sushi')
    expect(await screen.findByText(/No results for/)).toHaveTextContent('No results for “sushi”')
    expect(screen.queryByRole('list', { name: 'Saved meals' })).not.toBeInTheDocument()
    // The bar stays, so the query can be edited or cleared.
    expect(screen.getByPlaceholderText('Search your meals...')).toBeInTheDocument()
  })

  it('keeps the query per tab, not shared', async () => {
    renderLoader()
    await typeInto('Search your meals...', 'taco')

    fireEvent.click(screen.getByRole('tab', { name: /Recipes/ }))
    // The Recipes tab starts with an empty search and the full list.
    const recipeSearch = await screen.findByPlaceholderText('Search your recipes...')
    expect(recipeSearch).toHaveValue('')
    expect(await screen.findAllByTestId('recipe-card-saved')).toHaveLength(2)

    await typeInto('Search your recipes...', 'lentil')
    expect(await screen.findAllByTestId('recipe-card-saved')).toHaveLength(1)

    // Back on Meals, its own query is still there and still applied.
    fireEvent.click(screen.getByRole('tab', { name: /Meals/ }))
    expect(await screen.findByPlaceholderText('Search your meals...')).toHaveValue('taco')
    const items = within(await mealList()).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Taco Night')

    // And the Recipes query survived too.
    fireEvent.click(screen.getByRole('tab', { name: /Recipes/ }))
    expect(await screen.findByPlaceholderText('Search your recipes...')).toHaveValue('lentil')
  })
})

describe('Favorites heart in the tab row (issue #904)', () => {
  it('sits on the same row as the tabs, outside the tablist, labelled and unpressed', async () => {
    renderLoader()
    const heart = await screen.findByRole('button', { name: 'Favorites' })
    const toolbar = screen.getByTestId('library-toolbar')
    expect(toolbar).toContainElement(heart)
    expect(toolbar).toContainElement(screen.getByRole('tab', { name: /Meals/ }))
    expect(screen.getByRole('tablist')).not.toContainElement(heart)
    expect(heart).toHaveAttribute('aria-pressed', 'false')
  })

  it('is disabled on the Meals tab, since meals have no favorites', async () => {
    renderLoader()
    expect(await screen.findByRole('button', { name: 'Favorites' })).toBeDisabled()
  })

  it('filters the Recipes tab, which no longer has a Favorites chip row', async () => {
    renderLoader()
    fireEvent.click(await screen.findByRole('tab', { name: /Recipes/ }))
    expect(await screen.findAllByTestId('recipe-card-saved')).toHaveLength(2)
    // Only the toolbar heart: no second Favorites control inside the book.
    expect(screen.getAllByRole('button', { name: 'Favorites' })).toHaveLength(1)

    const heart = screen.getByRole('button', { name: 'Favorites' })
    expect(heart).toBeEnabled()
    fireEvent.click(heart)
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    const cards = await screen.findAllByTestId('recipe-card-saved')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Lentil Soup')

    fireEvent.click(heart)
    expect(await screen.findAllByTestId('recipe-card-saved')).toHaveLength(2)
  })

  it('keeps the filter across a trip to the Meals tab, shown unpressed while there', async () => {
    renderLoader()
    fireEvent.click(await screen.findByRole('tab', { name: /Recipes/ }))
    await screen.findAllByTestId('recipe-card-saved')
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    expect(await screen.findAllByTestId('recipe-card-saved')).toHaveLength(1)

    fireEvent.click(screen.getByRole('tab', { name: /Meals/ }))
    const heart = screen.getByRole('button', { name: 'Favorites' })
    expect(heart).toBeDisabled()
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    expect(within(await mealList()).getAllByRole('listitem')).toHaveLength(2)

    fireEvent.click(screen.getByRole('tab', { name: /Recipes/ }))
    expect(await screen.findAllByTestId('recipe-card-saved')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says "No favorites yet" (American spelling) when nothing is hearted', async () => {
    const original = RECIPES[0].is_favorite
    RECIPES[0].is_favorite = false
    try {
      renderLoader()
      fireEvent.click(await screen.findByRole('tab', { name: /Recipes/ }))
      await screen.findAllByTestId('recipe-card-saved')
      fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
      expect(await screen.findByText(/No favorites yet/)).toBeInTheDocument()
      expect(screen.queryByText(/favourite/i)).not.toBeInTheDocument()
    } finally {
      RECIPES[0].is_favorite = original
    }
  })
})
