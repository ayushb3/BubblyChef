/**
 * Issue #855: the library has a Favourites filter, finds recipes by ingredient
 * and tag as well as title, and shows "Cooked Nx, last ..." on a card that has
 * been cooked.
 */
import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RecipeBook from '@/components/recipes/RecipeBook'
import type { Recipe } from '@/components/recipes/RecipePage'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

function recipe(over: Partial<Recipe> & { id: string; title: string }): Recipe {
  return { user_id: 'u1', ingredients: ['salt'], instructions: ['Cook.'], servings: 2, ...over } as Recipe
}

const daysAgoIso = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

const RECIPES: Recipe[] = [
  recipe({
    id: 'r1',
    title: 'Weeknight Curry',
    ingredients: [{ name: 'chickpeas', quantity: 1, unit: 'can' }, 'rice'],
    is_favorite: true,
    times_cooked: 3,
    last_cooked_at: daysAgoIso(2),
  }),
  recipe({ id: 'r2', title: 'Creamy Tomato Pasta', ingredients: ['pasta', 'tomato'], times_cooked: 0 }),
  recipe({ id: 'r3', title: 'Pancakes', ingredients: ['flour', 'milk'], is_favorite: true }),
]

function renderBook(recipes = RECIPES) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
  ) as unknown as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RecipeBook recipes={recipes} onMutate={jest.fn()} />
    </QueryClientProvider>,
  )
}

const titles = () =>
  screen.queryAllByTestId('recipe-card-saved').map((c) => c.querySelector('span span')?.textContent)

function search(q: string) {
  jest.useFakeTimers()
  try {
    fireEvent.change(screen.getByPlaceholderText('Search your recipes...'), { target: { value: q } })
    act(() => {
      jest.advanceTimersByTime(350)
    })
  } finally {
    jest.useRealTimers()
  }
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('Favourites filter (issue #855)', () => {
  it('shows a Favourites chip that is off by default, with every recipe listed', () => {
    renderBook()
    const chip = screen.getByRole('button', { name: /favourites/i })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(3)
  })

  it('narrows the list to favourites when pressed, and back when pressed again', () => {
    renderBook()
    const chip = screen.getByRole('button', { name: /favourites/i })

    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(2)
    expect(screen.queryByText('Creamy Tomato Pasta')).not.toBeInTheDocument()
    expect(screen.getByText('2 of 3 recipes')).toBeInTheDocument()

    fireEvent.click(chip)
    expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(3)
  })

  it('combines with search', () => {
    renderBook()
    fireEvent.click(screen.getByRole('button', { name: /favourites/i }))
    search('tomato')
    expect(screen.queryByTestId('recipe-card-saved')).not.toBeInTheDocument()
    search('pancakes')
    expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(1)
  })

  it('says there are no favourites yet when the filter is on and none are hearted', () => {
    renderBook([recipe({ id: 'a', title: 'Plain Rice' })])
    fireEvent.click(screen.getByRole('button', { name: /favourites/i }))
    expect(screen.queryByTestId('recipe-card-saved')).not.toBeInTheDocument()
    expect(screen.getByText(/no favourites yet/i)).toBeInTheDocument()
  })

  it('drops a recipe from the filtered list the moment it is unfavourited', () => {
    renderBook()
    fireEvent.click(screen.getByRole('button', { name: /favourites/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Unfavorite: Pancakes' }))
    expect(screen.queryByText('Pancakes')).not.toBeInTheDocument()
  })

  it('is not offered on an empty library', () => {
    renderBook([])
    expect(screen.queryByRole('button', { name: /favourites/i })).not.toBeInTheDocument()
  })
})

describe('ingredient search (issue #855)', () => {
  it('finds a recipe by an ingredient that is not in the title', () => {
    renderBook()
    search('chickpea dinner')
    expect(screen.getAllByTestId('recipe-card-saved')).toHaveLength(1)
    expect(screen.getByText('Weeknight Curry')).toBeInTheDocument()
  })
})

describe('cooked history on the card (issue #855)', () => {
  it('shows "Cooked 3x, last 2 days ago" on a cooked recipe', () => {
    renderBook()
    const cards = screen.getAllByTestId('recipe-card-saved')
    expect(within(cards[0]).getByText('Cooked 3x, last 2 days ago')).toBeInTheDocument()
  })

  it('shows nothing on a recipe that was never cooked, or has no cook data', () => {
    renderBook()
    const cards = screen.getAllByTestId('recipe-card-saved')
    expect(within(cards[1]).queryByText(/cooked/i)).not.toBeInTheDocument()
    expect(within(cards[2]).queryByText(/cooked/i)).not.toBeInTheDocument()
  })
})
