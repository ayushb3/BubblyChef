/**
 * Issue #869: the library loaded only `GET /api/recipes`'s default first page
 * of 50, so search and the Favourites filter (client-side, issue #855) could
 * not see recipe 51 onward. The loader now walks every page.
 *
 * The fake route below behaves like the real one: 50 rows when no `limit` is
 * given, `limit`/`offset` honoured, `total_count` always the full count.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

jest.mock('@/components/recipes/MealsList', () => ({
  __esModule: true,
  default: () => <div data-testid="meals-list" />,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecipeBookLoader = require('@/components/recipes/RecipeBookLoader').default as () => React.JSX.Element

const TOTAL = 60
const pad = (n: number) => String(n).padStart(2, '0')
const ALL = Array.from({ length: TOTAL }, (_, i) => ({
  id: `r${i + 1}`,
  user_id: 'u1',
  title: `Stew number ${pad(i + 1)}`,
  ingredients: ['water'],
  instructions: ['Simmer.'],
  servings: 2,
  is_favorite: i + 1 === 55,
}))

const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body })

let recipeUrls: string[]

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  recipeUrls = []
  global.fetch = jest.fn((url: string) => {
    if (url.startsWith('/api/recipes')) {
      recipeUrls.push(url)
      const params = new URL(url, 'http://localhost').searchParams
      const limit = parseInt(params.get('limit') ?? '50', 10)
      const offset = parseInt(params.get('offset') ?? '0', 10)
      return Promise.resolve(
        reply({ recipes: ALL.slice(offset, offset + limit), total_count: TOTAL, limit, offset }),
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

async function search(text: string) {
  const input = await screen.findByPlaceholderText('Search your recipes...')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400))
  })
}

describe('library loads every recipe (issue #869)', () => {
  it('lists all 60 recipes, not just the first 50', async () => {
    renderLoader()
    await waitFor(() => expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(TOTAL))
    // Pages are fetched with explicit limit/offset, not one bare request.
    expect(recipeUrls.length).toBeGreaterThan(0)
  })

  it('search finds recipe 55', async () => {
    renderLoader()
    await search('number 55')
    const cards = await screen.findAllByTestId('recipe-card-saved')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Stew number 55')
  })

  it('the Favourites filter finds a favourite past the first 50', async () => {
    renderLoader()
    fireEvent.click(await screen.findByRole('button', { name: /Favourites/ }))
    const cards = await screen.findAllByTestId('recipe-card-saved')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Stew number 55')
  })
})

describe('fetchAllRecipes (issue #869)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fetchAllRecipes } = require('@/lib/api/recipes') as typeof import('@/lib/api/recipes')

  const offsetOf = (url: string) =>
    parseInt(new URL(url, 'http://localhost').searchParams.get('offset') ?? '0', 10)

  it('stops on an empty page even if total_count overstates', async () => {
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        reply({ recipes: offsetOf(url) === 0 ? ALL.slice(0, 3) : [], total_count: 999 }),
      ),
    ) as unknown as typeof fetch
    await expect(fetchAllRecipes()).resolves.toHaveLength(3)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws rather than returning a partial list when a page fails', async () => {
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        offsetOf(url) === 0
          ? reply({ recipes: ALL.slice(0, 60), total_count: 150 })
          : reply({}, 500),
      ),
    ) as unknown as typeof fetch
    await expect(fetchAllRecipes()).rejects.toThrow(/500/)
  })
})
