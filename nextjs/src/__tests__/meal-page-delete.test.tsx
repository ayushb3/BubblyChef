/**
 * Issue #675 — deleting a saved meal from the meal screen
 * (`app/meals/[id]/page.tsx`): a confirm step before anything is deleted,
 * the cook-along for that meal (session + running dock timers) ends with it,
 * the meals caches refresh, the user lands on the library's Meals tab, and a
 * failed delete leaves everything as it was.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meal } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'
import {
  startMealCookSession,
  saveMealCookProgress,
  getActiveMealCookSession,
} from '@/lib/meal-cook-session'
import { dishStepSignaturesForMeal } from '@/lib/meal-dishes'

const mockDismiss = jest.fn()
jest.mock('@/lib/useCookingTimers', () => {
  const actual = jest.requireActual('@/lib/useCookingTimers')
  return {
    ...actual,
    useCookingTimers: () => ({
      timers: [],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss: mockDismiss,
      extend: jest.fn(),
    }),
  }
})

const pushMock = jest.fn()
const replaceMock = jest.fn()
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meal-1' }),
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: jest.fn() }),
}))

const fetchMeal = jest.fn()
const deleteMeal = jest.fn()
jest.mock('@/lib/api/meals', () => ({
  fetchMeal: (...args: unknown[]) => fetchMeal(...args),
  updateMeal: jest.fn(),
  deleteMeal: (...args: unknown[]) => deleteMeal(...args),
  fetchSideAlternatives: jest.fn(),
  expandMealDish: jest.fn(),
  toNewDishRecipePayload: jest.fn(),
}))

const ensureSteps = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  ensureSteps: (...args: unknown[]) => ensureSteps(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MealDetailPage = require('@/app/meals/[id]/page').default as () => React.JSX.Element

function step(text: string): Step {
  return {
    text,
    label: text,
    ongoing_label: null,
    duration_minutes: 5,
    duration_estimated: false,
    hands_on: true,
    depends_on: [],
    exclusive: [],
  }
}

const MAIN_RECIPE: Recipe = {
  id: 'r-main',
  user_id: 'user-1',
  title: 'Lemon chicken',
  ingredients: [{ name: 'chicken thighs', quantity: 2, unit: 'lb' }],
  instructions: ['Cook the chicken'],
  steps: [step('Cook the chicken')],
  servings: 2,
}

function baseMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'meal-1',
    user_id: 'user-1',
    title: 'Weeknight dinner',
    description: null,
    servings: 2,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
    is_draft: false,
    source_type: 'chat',
    last_cooked_at: null,
    times_cooked: 0,
    created_at: 't',
    updated_at: 't',
    dishes: [{ role: 'main', position: 0, recipe: MAIN_RECIPE }],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = jest.spyOn(client, 'invalidateQueries')
  const remove = jest.spyOn(client, 'removeQueries')
  render(
    <QueryClientProvider client={client}>
      <MealDetailPage />
    </QueryClientProvider>,
  )
  return { client, invalidate, remove }
}

async function openConfirm() {
  await screen.findByRole('heading', { name: 'Lemon chicken', level: 3 })
  fireEvent.click(screen.getByRole('button', { name: 'Delete meal' }))
  return screen.getByRole('alertdialog')
}

/** A running cook-along with one step holding a live dock timer. */
function startCookWithRunningTimer(mealId = 'meal-1', dishIds = ['r-main'], timerId = 'timer-7') {
  const session = startMealCookSession(mealId, dishIds, Date.now(), dishStepSignaturesForMeal(baseMeal()))
  saveMealCookProgress({
    ...session,
    steps: {
      [`${dishIds[0]}:0`]: { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: timerId },
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  ensureSteps.mockResolvedValue({ recipe_id: 'x', steps: [], derived: false })
  fetchMeal.mockResolvedValue(baseMeal())
  deleteMeal.mockResolvedValue(undefined)
})

describe('meal page — delete (issue #675)', () => {
  it('asks for confirmation first and deletes nothing until confirmed', async () => {
    renderPage()
    const dialog = await openConfirm()

    expect(within(dialog).getByText(/Delete .*Weeknight dinner.*\?/)).toBeInTheDocument()
    expect(deleteMeal).not.toHaveBeenCalled()
  })

  it('Cancel closes the confirm without deleting', async () => {
    renderPage()
    const dialog = await openConfirm()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete meal' })).toBeInTheDocument()
    expect(deleteMeal).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('Confirm deletes the meal, refreshes the meals caches and lands on the library Meals tab', async () => {
    const { invalidate, remove } = renderPage()
    const dialog = await openConfirm()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteMeal).toHaveBeenCalledWith('meal-1'))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/recipes?tab=meals'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meals'] })
    expect(remove).toHaveBeenCalledWith({ queryKey: ['meal', 'meal-1'] })
  })

  it('says the saved recipes stay, for a saved meal', async () => {
    renderPage()
    const dialog = await openConfirm()
    expect(within(dialog).getByText(/saved recipes stay/i)).toBeInTheDocument()
  })

  it('says unsaved dishes go too, for a draft meal', async () => {
    fetchMeal.mockResolvedValue(baseMeal({ is_draft: true }))
    renderPage()
    const dialog = await openConfirm()
    expect(within(dialog).getByText(/haven.t saved as recipes/i)).toBeInTheDocument()
  })

  it('a failed delete shows the error, keeps the meal, the cook and the page', async () => {
    startCookWithRunningTimer()
    deleteMeal.mockRejectedValue(new Error('Could not delete'))
    const { remove } = renderPage()
    const dialog = await openConfirm()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Could not delete')).toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(mockDismiss).not.toHaveBeenCalled()
    expect(getActiveMealCookSession('meal-1')).not.toBeNull()
  })

  describe('while its cook-along is active', () => {
    it('the confirm copy says the cook-along will end', async () => {
      startCookWithRunningTimer()
      renderPage()
      const dialog = await openConfirm()
      expect(within(dialog).getByText(/cook-along.*will end/i)).toBeInTheDocument()
    })

    it('no cook-along copy when there is none', async () => {
      renderPage()
      const dialog = await openConfirm()
      expect(within(dialog).queryByText(/cook-along/i)).not.toBeInTheDocument()
    })

    it('deleting dismisses its running dock timers and clears the session', async () => {
      startCookWithRunningTimer('meal-1', ['r-main'], 'timer-7')
      renderPage()
      const dialog = await openConfirm()

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(replaceMock).toHaveBeenCalled())
      expect(mockDismiss).toHaveBeenCalledTimes(1)
      expect(mockDismiss).toHaveBeenCalledWith('timer-7')
      expect(getActiveMealCookSession()).toBeNull()
    })

    it("leaves a different meal's cook-along and timers alone", async () => {
      startCookWithRunningTimer('meal-2', ['r-other'], 'timer-other')
      renderPage()
      const dialog = await openConfirm()
      expect(within(dialog).queryByText(/cook-along/i)).not.toBeInTheDocument()

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(replaceMock).toHaveBeenCalled())
      expect(mockDismiss).not.toHaveBeenCalled()
      expect(getActiveMealCookSession('meal-2')).not.toBeNull()
    })
  })
})
