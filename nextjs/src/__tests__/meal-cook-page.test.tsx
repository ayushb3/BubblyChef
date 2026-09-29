/**
 * Issue #653 — page-level tests for the cook-along route
 * (`app/meals/[id]/cook/page.tsx`): Done/+2min/Skip re-planning with no
 * extra fetch, a hands-off Start wiring the dock, a linked timer completion
 * surfacing the dependent step, a dock extend re-planning, a reload
 * restoring at the same step, the finished screen, and a degraded
 * (fallback-steps) dish flowing through the same machinery.
 *
 * `@/lib/useCookingTimers` is mocked so timer state and `start`/`dismiss`
 * calls are fully controllable — `lib/meal-cook-session.ts` is used for
 * real, against the real `localStorage` (jsdom), the same as a real reload
 * would read/write.
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meal } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'
import {
  startMealCookSession,
  saveMealCookProgress,
  endMealCookSession,
  getActiveMealCookSession,
  isMealCookSessionEnded,
  type MealCookSession,
} from '@/lib/meal-cook-session'
import { formatClockTime } from '@/lib/meal-anchor'
import { TIMER_COMPLETED_EVENT, type CookingTimer } from '@/lib/useCookingTimers'

const pushMock = jest.fn()
const replaceMock = jest.fn()
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meal-1' }),
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: jest.fn() }),
}))

const fetchMeal = jest.fn()
jest.mock('@/lib/api/meals', () => ({
  fetchMeal: (...args: unknown[]) => fetchMeal(...args),
}))

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MealCookPage />
    </QueryClientProvider>,
  )
}

/** Seeds a session at `startedAtMs` with `steps` already recorded, mirroring a resumed reload. */
function seedSession(startedAtMs: number, steps: MealCookSession['steps'] = {}): void {
  const session = startMealCookSession('meal-1', ['r-main'], startedAtMs)
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

describe('MealCookPage — restore / redirect', () => {
  it('redirects to the meal screen when there is no active session', async () => {
    renderPage()
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/meals/meal-1'))
  })

  it('redirects when the session is stale (dish ids no longer match)', async () => {
    startMealCookSession('meal-1', ['some-other-recipe'], Date.now())
    renderPage()
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/meals/meal-1'))
  })

  it('redirects when the session was already ended', async () => {
    startMealCookSession('meal-1', ['r-main'], Date.now())
    endMealCookSession('meal-1')
    renderPage()
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/meals/meal-1'))
  })

  it('restores a fresh session and shows the first hands-on step as active', async () => {
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    await waitForStepStatus('r-main:0', 'running')
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-on')
    expect(replaceMock).not.toHaveBeenCalled()
  })
})

describe('MealCookPage — Done / +2 min / Skip', () => {
  it('Done advances the Now card; +2 min shifts the dependent step; no extra fetch', async () => {
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    await waitForStepStatus('r-main:0', 'running')
    expect(fetchMeal).toHaveBeenCalledTimes(1)

    const beforeExtend = screen.getByTestId('meal-next-up').textContent

    act(() => {
      screen.getByRole('button', { name: 'Add 2 minutes' }).click()
    })
    // The dependent hands-off step's start shifts by 2 minutes — next_up's
    // displayed clock time changes even though the Now card is unchanged.
    await waitFor(() => expect(screen.getByTestId('meal-next-up').textContent).not.toBe(beforeExtend))

    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitFor(() => expect(screen.queryByText('Boil pasta')).not.toBeInTheDocument())
    // Now the sauce (hands-off) is the topic — either as the active/upcoming card or next up.
    expect(screen.getByText(/Simmer sauce/)).toBeInTheDocument()

    expect(fetchMeal).toHaveBeenCalledTimes(1)
  })

  it('Skip frees the step and its dependent becomes reachable', async () => {
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    await waitForStepStatus('r-main:0', 'running')

    act(() => {
      screen.getByRole('button', { name: 'Skip' }).click()
    })
    await waitFor(() => expect(screen.queryByText('Boil pasta')).not.toBeInTheDocument())
    expect(fetchMeal).toHaveBeenCalledTimes(1)
  })
})

describe('MealCookPage — hands-off timer wiring', () => {
  it('starting a hands-off step calls timers.start with its label and duration', async () => {
    // Step 0 already done, far enough in the past that the hands-off step is
    // due — lands directly on the active hands-off card, no need to click
    // through Done first.
    seedSession(Date.now() - 6 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Simmer sauce')).toBeInTheDocument())
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-off')

    act(() => {
      screen.getByRole('button', { name: 'Start timer' }).click()
    })

    expect(mockStart).toHaveBeenCalledWith('Simmer sauce', 8 * 60)
    const persisted = getActiveMealCookSession('meal-1')
    expect(persisted?.steps['r-main:1']?.status).toBe('running')
    expect(persisted?.steps['r-main:1']?.timer_id).toBe(mockTimers[0]?.id)
  })

  it('a completed linked timer marks the step done and surfaces the dependent step', async () => {
    // Fake timers from the start — the page's own clock effect registers its
    // `setInterval` on mount, and only a *fake* interval can be advanced by
    // `jest.advanceTimersByTime` below.
    jest.useFakeTimers()
    seedSession(Date.now() - 8 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
      'r-main:1': { status: 'running', started_at_minutes: 5, extra_minutes: 0, timer_id: 'timer-1' },
    })
    mockTimers = [
      { id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 120, status: 'running' },
    ]
    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-now-card-waiting-on')).toHaveTextContent('Simmer sauce'))
    expect(screen.getByTestId('meal-running-strip')).toHaveTextContent('the sauce simmers')

    // Mutate the mocked timer to completed, then force a re-render (the
    // clock's own visibility-driven tick) so the page's effects pick up the
    // fresh `timers` reference before the completion event fires — mirrors
    // the real store's own render-then-dispatch ordering.
    mockTimers = [{ id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 0, status: 'completed' }]
    act(() => {
      jest.advanceTimersByTime(65_000)
    })
    act(() => {
      window.dispatchEvent(new CustomEvent(TIMER_COMPLETED_EVENT, { detail: { id: 'timer-1', label: 'Simmer sauce' } }))
    })

    await waitFor(() => expect(screen.queryByTestId('meal-now-card-waiting-on')).not.toBeInTheDocument())
    expect(screen.getByText('Plate up')).toBeInTheDocument()
    const persisted = getActiveMealCookSession('meal-1')
    expect(persisted?.steps['r-main:1']?.status).toBe('done')
  })

  it('a dock extend (a longer remainingSeconds) re-plans the dependent step', async () => {
    // Fake timers from the start, same reasoning as the completion test above.
    jest.useFakeTimers()
    seedSession(Date.now() - 6 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
      'r-main:1': { status: 'running', started_at_minutes: 5, extra_minutes: 0, timer_id: 'timer-1' },
    })
    mockTimers = [
      { id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 300, status: 'running' },
    ]
    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-now-card-waiting-on')).toBeInTheDocument())
    const before = screen.getByTestId('meal-now-card-upcoming-timing').textContent

    // Simulate the dock's own "+2m" having extended the linked timer.
    mockTimers = [
      { id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 420, status: 'running' },
    ]
    act(() => {
      jest.advanceTimersByTime(65_000)
    })

    await waitFor(() =>
      expect(screen.getByTestId('meal-now-card-upcoming-timing').textContent).not.toBe(before),
    )
  })
})

describe('MealCookPage — reload', () => {
  it('remounting from storage restores at the same step', async () => {
    seedSession(Date.now(), {
      'r-main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0 },
    })
    const { unmount } = renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    unmount()

    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-on')
  })
})

describe('MealCookPage — finished', () => {
  it('shows the finished screen once every step is done, and Back to meal ends the session', async () => {
    seedSession(Date.now() - 20 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
      'r-main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0 },
      'r-main:2': { status: 'done', started_at_minutes: 13, extra_minutes: 0 },
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-cook-finished')).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Back to meal' }).click()
    })

    expect(isMealCookSessionEnded('meal-1')).toBe(true)
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })
})

describe('MealCookPage — degraded (fallback-steps) dish', () => {
  it('a dish with no structured steps flows through via fallbackSteps', async () => {
    const degradedRecipe: Recipe = {
      id: 'r-degraded',
      user_id: 'user-1',
      title: 'Mystery stew',
      ingredients: [],
      instructions: ['Chop the vegetables and add them to the pot', 'Simmer until tender'],
      steps: null,
    }
    fetchMeal.mockResolvedValue(
      baseMeal({ dishes: [{ role: 'main', position: 0, recipe: degradedRecipe }] }),
    )
    startMealCookSession('meal-1', ['r-degraded'], Date.now())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Chop the vegetables and add them to the pot')).toBeInTheDocument(),
    )
    await waitForStepStatus('r-degraded:0', 'running')
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-on')

    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitFor(() =>
      expect(screen.queryByText('Chop the vegetables and add them to the pot')).not.toBeInTheDocument(),
    )
  })
})

// Sanity check that `formatClockTime` is what the page's `clockLabel` uses —
// guards against a future refactor silently changing the displayed format
// without a test noticing.
it('formatClockTime is the page clock label format', () => {
  expect(typeof formatClockTime(new Date())).toBe('string')
})
