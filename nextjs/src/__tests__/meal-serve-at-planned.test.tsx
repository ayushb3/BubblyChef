/**
 * Issue #755: the meal screen writes tonight's planned meal. Setting a saved meal
 * to Serve at (a time that can be met) keeps a device-local record the Bubbles card
 * reads; Start now or a too-soon time drops it; reopening the screen shows the
 * plan as the serve-at time it was set to ("Show the timeline").
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meal } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'
import {
  PLANNED_TONIGHT_KEY,
  readPlannedTonight,
  savePlannedTonight,
} from '@/lib/kitchen/planned-tonight'

jest.mock('@/lib/useCookingTimers', () => {
  const actual = jest.requireActual('@/lib/useCookingTimers')
  return {
    ...actual,
    useCookingTimers: () => ({
      timers: [],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss: jest.fn(),
      extend: jest.fn(),
    }),
  }
})

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meal-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const fetchMeal = jest.fn()
jest.mock('@/lib/api/meals', () => ({
  fetchMeal: (...args: unknown[]) => fetchMeal(...args),
  updateMeal: jest.fn(),
  deleteMeal: jest.fn(),
  fetchSideAlternatives: jest.fn(),
  expandMealDish: jest.fn(),
  toNewDishRecipePayload: jest.fn(),
}))

const ensureSteps = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  ensureSteps: (...args: unknown[]) => ensureSteps(...args),
}))

jest.mock('@/lib/api/grocery', () => ({
  fetchMealToBuy: jest.fn().mockRejectedValue(new Error('offline')),
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

function recipe(id: string, title: string, instruction: string): Recipe {
  return {
    id,
    user_id: 'user-1',
    title,
    ingredients: [],
    instructions: [instruction],
    steps: [step(instruction)],
    servings: 2,
  }
}

function baseMeal(): Meal {
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
    dishes: [
      { role: 'main', position: 0, recipe: recipe('r-main', 'Lemon chicken', 'Cook the chicken') },
      { role: 'side', position: 1, recipe: recipe('r-side1', 'Green salad', 'Toss the salad') },
      { role: 'side', position: 2, recipe: recipe('r-side2', 'Roast potatoes', 'Roast the potatoes') },
    ],
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MealDetailPage />
    </QueryClientProvider>,
  )
}

const NOW = new Date('2026-09-29T15:00:00') // local 15:00

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  jest.useFakeTimers().setSystemTime(NOW)
  ensureSteps.mockResolvedValue({ recipe_id: 'x', steps: [], derived: false })
  fetchMeal.mockResolvedValue(baseMeal())
})

afterEach(() => {
  jest.useRealTimers()
})

async function openScreen() {
  renderPage()
  await screen.findByRole('heading', { name: 'Green salad', level: 3 })
}

function serveAt(hhmm: string) {
  fireEvent.click(screen.getByRole('radio', { name: /Serve at/ }))
  fireEvent.change(screen.getByLabelText('Serve at time'), { target: { value: hhmm } })
}

const at = (h: number, m = 0, day = 29) => new Date(2026, 8, day, h, m).getTime()

describe('setting Serve at writes the planned-tonight record', () => {
  it('Serve at 19:00 today keeps the meal, the serve time and when to start', async () => {
    await openScreen()
    serveAt('19:00')

    const record = readPlannedTonight()!
    expect(record).toMatchObject({ mealId: 'meal-1', title: 'Weeknight dinner', servings: 2 })
    expect(record.serveAtMs).toBe(at(19))
    // Serve time minus the meal's own length (three one-step dishes, 15 minutes).
    expect(record.startAtMs).toBe(at(18, 45))
    // The dish that starts first, by name.
    expect(['Lemon chicken', 'Green salad', 'Roast potatoes']).toContain(record.startDish)
  })

  it('following the time input keeps the record current', async () => {
    await openScreen()
    serveAt('19:00')
    fireEvent.change(screen.getByLabelText('Serve at time'), { target: { value: '20:30' } })
    expect(readPlannedTonight()!.serveAtMs).toBe(at(20, 30))
  })

  it('a time earlier than now is tomorrow: the record is for tomorrow, not today', async () => {
    await openScreen()
    serveAt('07:00')
    expect(readPlannedTonight()!.serveAtMs).toBe(at(7, 0, 30))
  })

  it('a serve time that is too soon keeps nothing', async () => {
    await openScreen()
    serveAt('19:00')
    fireEvent.change(screen.getByLabelText('Serve at time'), { target: { value: '15:05' } })
    expect(await screen.findByTestId('serve-at-too-late')).toBeInTheDocument()
    expect(window.localStorage.getItem(PLANNED_TONIGHT_KEY)).toBeNull()
  })

  it('Start now drops the plan', async () => {
    await openScreen()
    serveAt('19:00')
    expect(readPlannedTonight()).not.toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Start now' }))
    expect(window.localStorage.getItem(PLANNED_TONIGHT_KEY)).toBeNull()
  })

  it("Start now here does not drop a different meal's plan", async () => {
    savePlannedTonight({
      v: 1,
      mealId: 'other-meal',
      title: 'Other',
      servings: 4,
      serveAtMs: at(19),
      startAtMs: at(18, 30),
      startDish: null,
    })
    await openScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Start now' }))
    expect(readPlannedTonight()?.mealId).toBe('other-meal')
  })

  it('opening the screen writes nothing', async () => {
    await openScreen()
    expect(window.localStorage.getItem(PLANNED_TONIGHT_KEY)).toBeNull()
  })
})

describe('Show the timeline: the screen opens on the plan', () => {
  it('a plan for this meal today opens in Serve at, at its time', async () => {
    savePlannedTonight({
      v: 1,
      mealId: 'meal-1',
      title: 'Weeknight dinner',
      servings: 2,
      serveAtMs: at(19),
      startAtMs: at(18, 45),
      startDish: 'Green salad',
    })
    await openScreen()
    expect(screen.getByRole('radio', { name: /Serve at/ })).toBeChecked()
    expect(screen.getByLabelText('Serve at time')).toHaveValue('19:00')
  })

  it('a plan that was moved to tomorrow does not open the screen on its time', async () => {
    savePlannedTonight({
      v: 1,
      mealId: 'meal-1',
      title: 'Weeknight dinner',
      servings: 2,
      serveAtMs: at(19, 0, 30),
      startAtMs: at(18, 45, 30),
      startDish: null,
    })
    await openScreen()
    expect(screen.getByRole('radio', { name: 'Start now' })).toBeChecked()
  })

  it("another meal's plan does not change this screen", async () => {
    savePlannedTonight({
      v: 1,
      mealId: 'other',
      title: 'Other',
      servings: 2,
      serveAtMs: at(19),
      startAtMs: at(18, 45),
      startDish: null,
    })
    await openScreen()
    expect(screen.getByRole('radio', { name: 'Start now' })).toBeChecked()
  })
})
