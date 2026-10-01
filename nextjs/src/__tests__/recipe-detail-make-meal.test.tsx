/**
 * Issue #651 PR B — the recipe page's "Make it a meal" link. It's a plain
 * link to `/chat?meal=<id>&title=<title>` (the chat's seed does the work), and
 * only the loaded state has it.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RecipeDetailPage from '@/app/recipes/[id]/page'

// The page's ingredient food tags use React Query (issue #784).
const withClient = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
)

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'recipe-1' }),
  useRouter: () => ({ push: jest.fn() }),
}))

function mockFetchOnce(body: unknown, status = 200) {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('RecipeDetailPage — Make it a meal (#651 PR B)', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  it('links to the chat seed with the recipe id and title', async () => {
    mockFetchOnce({
      id: 'recipe-1',
      title: 'Mac & Cheese',
      ingredients: [],
      instructions: ['Boil'],
    })

    render(withClient(<RecipeDetailPage />))

    const link = await screen.findByRole('link', { name: /make it a meal/i })
    const href = link.getAttribute('href') ?? ''
    expect(href.startsWith('/chat?')).toBe(true)
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    expect(params.get('meal')).toBe('recipe-1')
    expect(params.get('title')).toBe('Mac & Cheese')
  })

  it('is absent on the 404 screen', async () => {
    mockFetchOnce({}, 404)

    render(withClient(<RecipeDetailPage />))

    expect(await screen.findByText('Recipe not found')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /make it a meal/i })).toBeNull()
  })

  it('is absent on the load-error screen', async () => {
    mockFetchOnce({}, 500)

    render(withClient(<RecipeDetailPage />))

    expect(await screen.findByText('Could not load recipe')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /make it a meal/i })).toBeNull()
  })
})
