/**
 * Issue #849 — the cook-along's step card shows the scaled amounts of the
 * ingredients a step uses, an Ingredients sheet lists every dish's scaled
 * ingredients (checkable), the step text is at least 20px, and Ask Bubbly
 * reports the step the cook is on (not the next scheduled one) and offers
 * one-tap prompts that send immediately.
 *
 * Harness copied from `meal-cook-page.test.tsx` (timers + AI mocked; the
 * session lives in real jsdom localStorage).
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meal, MealCookProposal } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'
import type { ChatResponse } from '@/types/chat'
import {
  startMealCookSession,
  saveMealCookProgress,
  endMealCookSession,
  getActiveMealCookSession,
  isMealCookSessionEnded,
  type MealCookSession,
} from '@/lib/meal-cook-session'
import { formatClockTime } from '@/lib/meal-anchor'
import { dishStepSignaturesForMeal } from '@/lib/meal-dishes'
import { TIMER_COMPLETED_EVENT, type CookingTimer } from '@/lib/useCookingTimers'
// The real class, re-exported from the mock factory below — `err instanceof
// MealCookError` in the page needs the real constructor.
import { MealCookError } from '@/lib/api/meals'

// Issue #654 PR B — the Ask Bubbly overlay (rendered for real, mounted by
// the page) calls `streamChatMessage`; mocked exactly as
// `ask-bubbles-overlay.test.tsx` mocks it for the component in isolation.
jest.mock('@/lib/api/chat', () => ({ streamChatMessage: jest.fn() }))
// eslint-disable-next-line @typescript-eslint/no-require-imports
const streamChatMessageMock = require('@/lib/api/chat').streamChatMessage as jest.Mock

const pushMock = jest.fn()
const replaceMock = jest.fn()
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meal-1' }),
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: jest.fn() }),
}))

const fetchMeal = jest.fn()
const requestMealCookProposal = jest.fn()
const confirmMealCook = jest.fn()
jest.mock('@/lib/api/meals', () => {
  const actual = jest.requireActual('@/lib/api/meals')
  return {
    fetchMeal: (...args: unknown[]) => fetchMeal(...args),
    requestMealCookProposal: (...args: unknown[]) => requestMealCookProposal(...args),
    confirmMealCook: (...args: unknown[]) => confirmMealCook(...args),
    // The real class — the page's `err instanceof MealCookError` checks need
    // the real constructor, not a mock stub.
    MealCookError: actual.MealCookError,
  }
})

let mockTimers: CookingTimer[] = []
const mockStart = jest.fn((label: string, seconds: number) => {
  const id = `timer-${mockTimers.length + 1}`
  mockTimers = [
    ...mockTimers,
    { id, label, durationSeconds: seconds, remainingSeconds: seconds, status: 'running' as const },
  ]
  return id
})
const mockDismiss = jest.fn()
const mockPause = jest.fn()
const mockResume = jest.fn()
const mockExtend = jest.fn()
jest.mock('@/lib/useCookingTimers', () => {
  const actual = jest.requireActual('@/lib/useCookingTimers')
  return {
    ...actual,
    useCookingTimers: () => ({
      timers: mockTimers,
      start: mockStart,
      pause: mockPause,
      resume: mockResume,
      dismiss: mockDismiss,
      extend: mockExtend,
    }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MealCookPage = require('@/app/meals/[id]/cook/page').default as () => React.JSX.Element

function step(overrides: Partial<Step> & { text: string; label: string; duration_minutes: number; hands_on: boolean }): Step {
  return {
    ongoing_label: null,
    duration_estimated: false,
    depends_on: [],
    exclusive: [],
    ...overrides,
  }
}

// A single dish, three sequential steps: hands-on (5m) -> hands-off (8m,
// depends on 0) -> hands-on (2m, depends on 1). Total 15 minutes. Keeping
// the hands-off step in the *middle* (not last) sidesteps deriveStream's own
// "nothing pending, nothing hands-on running" fallback — a dish that ends on
// a still-running hands-off step is a real gap in that fallback (see the
// slice B report), out of scope for this page-only slice.
const MAIN_RECIPE: Recipe = {
  id: 'r-main',
  user_id: 'user-1',
  title: 'Pasta dinner',
  ingredients: [],
  instructions: ['Bring a pot of water to a boil and cook the pasta', 'Let the sauce simmer', 'Plate everything up'],
  steps: [
    step({
      text: 'Bring a pot of water to a boil and cook the pasta',
      label: 'Boil pasta',
      duration_minutes: 5,
      hands_on: true,
      depends_on: [],
    }),
    step({
      text: 'Let the sauce simmer',
      label: 'Simmer sauce',
      ongoing_label: 'the sauce simmers',
      duration_minutes: 8,
      hands_on: false,
      depends_on: [0],
    }),
    step({
      text: 'Plate everything up',
      label: 'Plate up',
      duration_minutes: 2,
      hands_on: true,
      depends_on: [1],
    }),
  ],
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

function renderPage(client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    ...render(
      <QueryClientProvider client={client}>
        <MealCookPage />
      </QueryClientProvider>,
    ),
    client,
  }
}

// Issue #653 review round 1 (S4) — computed from the real `dishStepSignaturesForMeal`
// rather than hand-typed, so a session seeded here is never spuriously "stale"
// against what the page itself derives from `baseMeal()`.
const MAIN_STEP_SIGNATURES = dishStepSignaturesForMeal(baseMeal())

/** Seeds a session at `startedAtMs` with `steps` already recorded, mirroring a resumed reload. */
function seedSession(startedAtMs: number, steps: MealCookSession['steps'] = {}): void {
  const session = startMealCookSession('meal-1', ['r-main'], startedAtMs, MAIN_STEP_SIGNATURES)
  saveMealCookProgress({ ...session, steps })
}

/**
 * Waits for the persisted session to actually have `key` at `status` —
 * used after the initial render instead of only matching visible text,
 * since the Now card's *label* is identical before and after the page's own
 * "becoming active" effect fires (it's still the same step), so a
 * text-only `waitFor` can resolve a render early, before that effect (and
 * the fresh event-handler closures a following render attaches) has
 * actually settled.
 */
async function waitForStepStatus(key: string, status: string): Promise<void> {
  await waitFor(() => expect(getActiveMealCookSession('meal-1')?.steps[key]?.status).toBe(status))
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  mockTimers = []
  fetchMeal.mockResolvedValue(baseMeal())
})

afterEach(() => {
  jest.useRealTimers()
})


const RECIPE: Recipe = {
  ...MAIN_RECIPE,
  servings: 2,
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'sauce', quantity: 1, unit: 'cup' },
    '1 tsp salt',
  ],
}

// 4 servings from a 2-serving recipe: every amount doubles.
function scaledMeal(): Meal {
  return baseMeal({ servings: 4, dishes: [{ role: 'main', position: 0, recipe: RECIPE }] })
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  mockTimers = []
  fetchMeal.mockResolvedValue(scaledMeal())
})

afterEach(() => {
  jest.useRealTimers()
})

describe('MealCookPage — step ingredients (issue #849)', () => {
  it('shows the scaled amount of an ingredient the step uses', async () => {
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    const chips = screen.getByTestId('meal-now-card-ingredients')
    expect(chips).toHaveTextContent('400 g pasta')
    expect(chips).not.toHaveTextContent('sauce')
  })

  it('a step that names no ingredient shows no chips', async () => {
    seedSession(Date.now() - 20 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 5 },
      'r-main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0, ended_at_minutes: 13 },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Plate up')).toBeInTheDocument())
    expect(screen.queryByTestId('meal-now-card-ingredients')).not.toBeInTheDocument()
  })

  it('the step text is at least 20px (text-xl)', async () => {
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    expect(screen.getByTestId('meal-now-card-step-text').className).toMatch(/\btext-(xl|2xl|3xl)\b/)
  })
})

describe('MealCookPage — Ingredients sheet (issue #849)', () => {
  it('lists every ingredient at the meal scale, and the ticks survive closing and reopening', async () => {
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('meal-cook-ingredients-button'))
    const sheet = await screen.findByTestId('meal-ingredients-sheet')
    expect(sheet).toHaveTextContent('Pasta dinner')
    expect(sheet).toHaveTextContent('400 g pasta')
    expect(sheet).toHaveTextContent('2 cup sauce')
    expect(sheet).toHaveTextContent('2 tsp salt')

    const box = screen.getByRole('checkbox', { name: /400 g pasta/ })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(screen.getByRole('checkbox', { name: /400 g pasta/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Close ingredients' }))
    await waitFor(() => expect(screen.queryByTestId('meal-ingredients-sheet')).not.toBeInTheDocument())
    fireEvent.click(screen.getByTestId('meal-cook-ingredients-button'))
    expect(await screen.findByRole('checkbox', { name: /400 g pasta/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /2 cup sauce/ })).not.toBeChecked()
  })
})

describe('MealCookPage — Ask Bubbly step and quick prompts (issue #849)', () => {
  // Boil pasta done, Simmer sauce running (timer ticking), so the Now card is
  // the upcoming "Plate up" (step 3), waiting on the simmer (step 2).
  function seedSimmerRunning() {
    seedSession(Date.now() - 6 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 5 },
      'r-main:1': { status: 'running', started_at_minutes: 5, extra_minutes: 0, timer_id: 'timer-1' },
    })
    mockTimers = [
      { id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 420, status: 'running' },
    ]
  }

  it('with the simmer running, Ask Bubbly reports the simmer (step 2), not the next card (step 3)', async () => {
    seedSimmerRunning()
    renderPage()
    await waitFor(() => expect(screen.getByText('Plate up')).toBeInTheDocument())

    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    expect(screen.getByRole('dialog', { name: 'Ask Bubbly about step 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to step 2' })).toBeInTheDocument()

    streamChatMessageMock.mockImplementationOnce(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'How long left?' }))
    expect(streamChatMessageMock).toHaveBeenCalledTimes(1)
    const request = streamChatMessageMock.mock.calls[0][0] as { message: string }
    expect(request.message).toContain('step 2')
    expect(request.message).toContain('Let the sauce simmer')
    expect(request.message).toContain('How long left?')
  })

  it.each(['Is it done?', 'I burnt it', 'Swap an ingredient', 'How long left?'])(
    'tapping "%s" sends it at once',
    async (prompt) => {
      seedSession(Date.now())
      renderPage()
      await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
      act(() => {
        screen.getByTestId('meal-now-card-ask-bubbles').click()
      })
      streamChatMessageMock.mockImplementationOnce(async () => {})
      fireEvent.click(screen.getByRole('button', { name: prompt }))
      expect(streamChatMessageMock).toHaveBeenCalledTimes(1)
      expect((streamChatMessageMock.mock.calls[0][0] as { message: string }).message).toContain(prompt)
    },
  )
})
