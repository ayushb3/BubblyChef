/**
 * Issue #650 — the meal page's servings stepper scales every dish's
 * displayed ingredient quantities by `meal.servings / recipe.servings`.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meal } from '@/types/meals'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meal-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const BASE_MEAL: Meal = {
  id: 'meal-1',
  user_id: 'user-1',
  title: 'Lemon chicken dinner',
  description: null,
  servings: 2,
  constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
  is_draft: false,
  source_type: 'chat',
  last_cooked_at: null,
  times_cooked: 0,
  created_at: 't',
  updated_at: 't',
  dishes: [
    {
      role: 'main',
      position: 0,
      recipe: {
        id: 'r1',
        user_id: 'user-1',
        title: 'Lemon butter chicken',
        ingredients: [{ name: 'chicken thighs', quantity: 2, unit: 'lb' }],
        instructions: ['Cook it'],
        servings: 2,
      },
    },
  ],
}

const fetchMeal = jest.fn()
const updateMeal = jest.fn()
jest.mock('@/lib/api/meals', () => ({
  fetchMeal: (...args: unknown[]) => fetchMeal(...args),
  updateMeal: (...args: unknown[]) => updateMeal(...args),
  fetchSideAlternatives: jest.fn(),
  expandMealDish: jest.fn(),
  toNewDishRecipePayload: jest.fn(),
}))

// The screen's missing-steps upgrade (issue #652) fires for every dish
// without `steps` on mount — BASE_MEAL's dish has none, so this must be
// mocked or the effect hits a real `fetch()` in jsdom.
const ensureSteps = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  ensureSteps: (...args: unknown[]) => ensureSteps(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MealDetailPage = require('@/app/meals/[id]/page').default as () => React.JSX.Element

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MealDetailPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ensureSteps.mockResolvedValue({ recipe_id: 'r1', steps: [], derived: false })
})

describe('meal page servings scaling (issue #650)', () => {
  it('renders each dish\'s ingredients at the recipe\'s own servings initially', async () => {
    fetchMeal.mockResolvedValue(BASE_MEAL)
    renderPage()

    expect(await screen.findByText('2 lb chicken thighs')).toBeInTheDocument()
  })

  it('scales displayed quantities after the servings stepper increases servings', async () => {
    fetchMeal.mockResolvedValue(BASE_MEAL)
    // meal.servings 2 -> 4, recipe.servings stays 2, so scale = 4/2 = 2.
    updateMeal.mockResolvedValue({ ...BASE_MEAL, servings: 4 })
    renderPage()

    await screen.findByText('2 lb chicken thighs')
    // Durations never scale (issue #652 review, nit) — capture the timeline
    // total before the servings change so the assertion below actually
    // exercises that, not just quantities.
    const timelineBefore = screen.getByText(/Timeline —/).textContent

    fireEvent.click(screen.getByRole('button', { name: 'Increase servings' }))

    await waitFor(() => expect(updateMeal).toHaveBeenCalledWith('meal-1', { servings: 3 }))
    // The mock always resolves with servings: 4 regardless of the requested
    // value, so the rendered scale reflects exactly what the mutation
    // returned — proving the page re-derives the scale from fresh query
    // data rather than computing it once from the initial fetch.
    expect(await screen.findByText('4 lb chicken thighs')).toBeInTheDocument()
    expect(screen.queryByText('2 lb chicken thighs')).not.toBeInTheDocument()
    // Same dish, same steps, same total — the timeline shouldn't have moved
    // just because servings did.
    expect(screen.getByText(/Timeline —/).textContent).toBe(timelineBefore)
  })

  it('the decrease button is disabled at 1 serving', async () => {
    fetchMeal.mockResolvedValue({ ...BASE_MEAL, servings: 1 })
    renderPage()

    await screen.findByText('1 lb chicken thighs')
    expect(screen.getByRole('button', { name: 'Decrease servings' })).toBeDisabled()
  })
})
