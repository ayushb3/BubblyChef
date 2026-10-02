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

describe('MealCookPage — restore / redirect', () => {
  it('redirects to the meal screen when there is no active session', async () => {
    renderPage()
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/meals/meal-1'))
  })

  it('redirects when the session is stale (dish ids no longer match)', async () => {
    startMealCookSession('meal-1', ['some-other-recipe'], Date.now(), ['1:x'])
    renderPage()
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/meals/meal-1'))
  })

  it('redirects when the session was already ended', async () => {
    startMealCookSession('meal-1', ['r-main'], Date.now(), MAIN_STEP_SIGNATURES)
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
  it('Done advances the Now card; +2 min shifts the dependent step by exactly 2 minutes; no extra fetch', async () => {
    const startedAtMs = Date.now()
    seedSession(startedAtMs)
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    await waitForStepStatus('r-main:0', 'running')
    expect(fetchMeal).toHaveBeenCalledTimes(1)

    // Boil pasta (0-5) -> Simmer sauce, a strictly sequential single-dish
    // chain with nothing else to align with, so Simmer's live-plan start is
    // exactly Boil pasta's nominal end: 5.
    const beforeLabel = formatClockTime(new Date(startedAtMs + 5 * 60_000))
    expect(screen.getByTestId('meal-next-up')).toHaveTextContent(beforeLabel)

    act(() => {
      screen.getByRole('button', { name: 'Add 2 minutes' }).click()
    })
    // +2 min pushes Boil pasta's nominal end to 7 — the dependent hands-off
    // step's start shifts by exactly 2 minutes, not merely "some amount".
    const afterLabel = formatClockTime(new Date(startedAtMs + 7 * 60_000))
    await waitFor(() => expect(screen.getByTestId('meal-next-up')).toHaveTextContent(afterLabel))
    expect(afterLabel).not.toBe(beforeLabel)

    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitFor(() => expect(screen.queryByText('Boil pasta')).not.toBeInTheDocument())
    // Now the sauce (hands-off) is the topic — either as the active/upcoming card or next up.
    expect(screen.getByText(/Simmer sauce/)).toBeInTheDocument()

    expect(fetchMeal).toHaveBeenCalledTimes(1)
  })

  it('Skip frees the step — its dependent is no longer shown waiting on a running step', async () => {
    const startedAtMs = Date.now()
    seedSession(startedAtMs)
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    await waitForStepStatus('r-main:0', 'running')

    act(() => {
      screen.getByRole('button', { name: 'Skip' }).click()
    })
    await waitFor(() => expect(screen.queryByText('Boil pasta')).not.toBeInTheDocument())
    // Simmer sauce is now the topic, and — because a skipped step holds no
    // resources and isn't `running` — it's no longer shown "waiting on"
    // anything (a still-running Boil pasta would have surfaced a
    // `waiting_on` line here instead). `hold_to_plan` still keeps its start
    // at the baseline's 5 rather than rushing it forward to 0, so it reads
    // as the upcoming card, not yet active.
    expect(screen.getByText('Simmer sauce')).toBeInTheDocument()
    expect(screen.queryByTestId('meal-now-card-waiting-on')).not.toBeInTheDocument()
    const label = formatClockTime(new Date(startedAtMs + 5 * 60_000))
    expect(screen.getByTestId('meal-now-card-upcoming-timing')).toHaveTextContent(label)
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

  it('a running step whose linked timer is already completed on mount is marked done with no event needed', async () => {
    seedSession(Date.now() - 8 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
      'r-main:1': { status: 'running', started_at_minutes: 5, extra_minutes: 0, timer_id: 'timer-1' },
    })
    // The linked timer had already completed by the time the page mounts (it
    // finished while the tab was closed) — no TIMER_COMPLETED_EVENT is ever
    // dispatched here; the mount-time run of the timers-array-reactive
    // effect is the only thing that can catch this.
    mockTimers = [
      { id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 0, status: 'completed' },
    ]
    renderPage()

    await waitForStepStatus('r-main:1', 'done')
    expect(screen.getByText('Plate up')).toBeInTheDocument()
  })

  it('a running step whose linked timer is simply missing on mount (dismissed while closed) is also marked done', async () => {
    seedSession(Date.now() - 8 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
      'r-main:1': { status: 'running', started_at_minutes: 5, extra_minutes: 0, timer_id: 'timer-1' },
    })
    mockTimers = [] // no timer at all — dismissed while the tab was closed
    renderPage()

    await waitForStepStatus('r-main:1', 'done')
    expect(screen.getByText('Plate up')).toBeInTheDocument()
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

describe('MealCookPage — finished timer chips (issue #757)', () => {
  // Boil pasta and Simmer sauce are done (Simmer's 8-minute timer finished), and
  // the session is old enough that Plate up is the active hands-on card.
  function seedFinishedSimmer(status: CookingTimer['status'] = 'completed') {
    seedSession(Date.now() - 20 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 5 },
      'r-main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0, ended_at_minutes: 13, timer_id: 'timer-1' },
    })
    mockTimers = [
      {
        id: 'timer-1',
        label: 'Simmer sauce',
        durationSeconds: 480,
        remainingSeconds: status === 'completed' ? 0 : 60,
        status,
      },
    ]
  }

  async function renderOnPlateUp() {
    renderPage()
    await waitFor(() => expect(screen.getByText('Plate up')).toBeInTheDocument())
    await waitForStepStatus('r-main:2', 'running')
  }

  it('keeps the finished chip while the cook is still on the step after it', async () => {
    seedFinishedSimmer()
    await renderOnPlateUp()
    expect(mockDismiss).not.toHaveBeenCalled()
  })

  it('clears the finished chip once the cook finishes the next step', async () => {
    seedFinishedSimmer()
    await renderOnPlateUp()
    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    expect(mockDismiss).toHaveBeenCalledWith('timer-1')
  })

  it('clears the finished chip when the cook skips the next step', async () => {
    seedFinishedSimmer()
    await renderOnPlateUp()
    act(() => {
      screen.getByRole('button', { name: 'Skip' }).click()
    })
    expect(mockDismiss).toHaveBeenCalledWith('timer-1')
  })

  it('does not clear a timer that is still running when the cook moves on', async () => {
    seedFinishedSimmer('running')
    await renderOnPlateUp()
    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    expect(mockDismiss).not.toHaveBeenCalled()
  })
})

describe('MealCookPage — timeline sheet', () => {
  it('opens showing clock times and progress markers for done and current steps', async () => {
    // Session started 5 minutes ago — Boil pasta done on time at 5, and
    // Simmer sauce (hands-off) is due now, so it's the *active* Now card
    // (not merely upcoming), which is what puts a "Now" marker on its cell.
    const startedAtMs = Date.now() - 5 * 60_000
    seedSession(startedAtMs, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 5 },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Simmer sauce')).toBeInTheDocument())
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-off')

    expect(screen.queryByTestId('meal-timeline-sheet')).not.toBeInTheDocument()
    act(() => {
      screen.getByRole('button', { name: 'Open timeline' }).click()
    })
    expect(screen.getByTestId('meal-timeline-sheet')).toBeInTheDocument()

    // Clock times, anchored at the session's own start — the "0" row shows
    // the moment cooking started.
    const startLabel = formatClockTime(new Date(startedAtMs))
    expect(screen.getAllByText(startLabel).length).toBeGreaterThan(0)

    // Boil pasta's cell is marked done (sr-only "done", not colour-only —
    // review round 1, S5), and Simmer sauce's cell carries the "Now" marker.
    expect(screen.getByTestId('meal-timeline-cell-done-marker')).toBeInTheDocument()
    expect(screen.getByTestId('meal-timeline-cell-now-marker')).toBeInTheDocument()
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

// A second dish (a side) with a single step — used by the tests below that
// need "one dish cooked, one dish entirely skipped" (S9's exclusion rule).
const SIDE_RECIPE: Recipe = {
  id: 'r-side',
  user_id: 'user-1',
  title: 'Garlic bread',
  ingredients: [],
  instructions: ['Toast the bread'],
  steps: [
    step({ text: 'Toast the bread', label: 'Toast bread', duration_minutes: 2, hands_on: true, depends_on: [] }),
  ],
  servings: 2,
}

function mealWithSide(): Meal {
  return baseMeal({
    dishes: [
      { role: 'main', position: 0, recipe: MAIN_RECIPE },
      { role: 'side', position: 1, recipe: SIDE_RECIPE },
    ],
  })
}

/** A minimal `MealCookProposal` — one ready match, so `summariseDeductions` has exactly one deduction to confirm. */
function baseProposal(overrides: Partial<MealCookProposal> = {}): MealCookProposal {
  return {
    proposal_type: 'meal_cook',
    meal_id: 'meal-1',
    meal_title: 'Weeknight dinner',
    servings: 2,
    dishes: [{ recipe_id: 'r-main', title: 'Pasta dinner', role: 'main', position: 0, ingredients_source: 'recipe' }],
    matches: [
      {
        ingredient_name: 'Pasta',
        ingredient_qty: 200,
        ingredient_unit: 'g',
        pantry_item_id: 'pantry-1',
        pantry_item_name: 'Pasta',
        pantry_qty_available: 500,
        deduct_qty: 200,
        base_unit: 'g',
        status: 'ready',
        shortfall: null,
        match_type: 'exact',
        substitution_note: null,
        sources: [
          {
            recipe_id: 'r-main',
            dish_title: 'Pasta dinner',
            ingredient_name: 'Pasta',
            ingredient_qty: 200,
            ingredient_unit: 'g',
            required_base_qty: 200,
            status: 'ready',
            match_type: 'exact',
            substitution_note: null,
          },
        ],
      },
    ],
    missing: [],
    missing_sources: {},
    missing_notes: {},
    unit_conflicts: [],
    compound_suggestions: [],
    expired_items: [],
    ...overrides,
  }
}

const CONFIRM_RESPONSE = {
  success: true as const,
  already_confirmed: false,
  deductions_applied: 1,
  deductions_requested: 1,
  deductions_skipped: [],
  recipes_marked_cooked: ['r-main'],
  meal_times_cooked: 1,
  cooked_on: '2026-09-29',
}

/** Seeds a session with the last (hands-on) step still pending, renders, and taps Done to finish it live on this mount. */
async function renderFinishedLive(startedAtMs: number, client?: QueryClient) {
  seedSession(startedAtMs, {
    'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
    'r-main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0 },
  })
  const result = renderPage(client)
  await waitFor(() => expect(screen.getByText('Plate up')).toBeInTheDocument())
  act(() => {
    screen.getByRole('button', { name: 'Done' }).click()
  })
  await waitFor(() => expect(screen.getByTestId('meal-cook-finished')).toBeInTheDocument())
  return result
}

describe('MealCookPage — finished: Mark meal as cooked (proposal request)', () => {
  it('requests a proposal with each cooked dish, and without an all-skipped dish', async () => {
    const meal = mealWithSide()
    fetchMeal.mockResolvedValue(meal)
    const signatures = dishStepSignaturesForMeal(meal)
    const session = startMealCookSession('meal-1', ['r-main', 'r-side'], Date.now() - 20 * 60_000, signatures)
    saveMealCookProgress({
      ...session,
      steps: {
        'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
        'r-main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0 },
        'r-side:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 0 },
      },
    })
    requestMealCookProposal.mockResolvedValue(baseProposal())
    renderPage()
    await waitFor(() => expect(screen.getByText('Plate up')).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('meal-cook-finished')).toBeInTheDocument())
    expect(screen.getByTestId('meal-cook-finished-skipped-note')).toHaveTextContent('Garlic bread')

    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })

    await waitFor(() =>
      expect(requestMealCookProposal).toHaveBeenCalledWith({
        meal_id: 'meal-1',
        servings: 2,
        dishes: [{ recipe_id: 'r-main', ingredients: [], string_scale: 1 }],
      }),
    )
  })

  it('sanitizes a malformed ingredient list before sending it (S5): a nameless object dropped, a NaN quantity as null, and a 120-element list capped at 100', async () => {
    const malformedIngredients: unknown[] = [
      { quantity: 5 },
      { name: 'Salt', quantity: Number.NaN },
      ...Array.from({ length: 120 }, (_, i) => `Item ${i}`),
    ]
    const malformedRecipe: Recipe = {
      id: 'r-malformed',
      user_id: 'user-1',
      title: 'Malformed dish',
      ingredients: malformedIngredients as Recipe['ingredients'],
      instructions: ['Do the thing'],
      steps: [step({ text: 'Do the thing', label: 'Do the thing', duration_minutes: 3, hands_on: true, depends_on: [] })],
      servings: 2,
    }
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: malformedRecipe }] })
    fetchMeal.mockResolvedValue(meal)
    requestMealCookProposal.mockResolvedValue(baseProposal())
    startMealCookSession('meal-1', ['r-malformed'], Date.now(), dishStepSignaturesForMeal(meal))
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument())
    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('meal-cook-finished')).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })

    await waitFor(() => expect(requestMealCookProposal).toHaveBeenCalledTimes(1))
    const req = requestMealCookProposal.mock.calls[0][0] as { dishes: Array<{ ingredients: unknown[] }> }
    const ingredients = req.dishes[0].ingredients
    expect(ingredients).toHaveLength(100)
    expect(ingredients[0]).toEqual({ name: 'Salt', quantity: null, unit: null })
    expect(ingredients).not.toContainEqual(expect.objectContaining({ quantity: 5 }))
    expect(ingredients[99]).toBe('Item 98')
  })
})

describe('MealCookPage — finished: confirm', () => {
  it('ends the session, invalidates the query keys, navigates after 1200ms, and a remount then redirects', async () => {
    jest.useFakeTimers()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries')
    requestMealCookProposal.mockResolvedValue(baseProposal())
    confirmMealCook.mockResolvedValue(CONFIRM_RESPONSE)

    const { unmount } = await renderFinishedLive(Date.now() - 20 * 60_000, client)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Update pantry' }).click()
    })

    await waitFor(() => expect(confirmMealCook).toHaveBeenCalledTimes(1))
    expect(isMealCookSessionEnded('meal-1')).toBe(true)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bubbles'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pantry'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['meal', 'meal-1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['meals'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['inbox-entries'] })
    expect(pushMock).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')

    unmount()
    renderPage(client)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/meals/meal-1'))
  })

  it('a double tap on Update pantry sends exactly one confirm (confirmingRef)', async () => {
    requestMealCookProposal.mockResolvedValue(baseProposal())
    let resolveConfirm: (v: typeof CONFIRM_RESPONSE) => void = () => {}
    confirmMealCook.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve
        }),
    )

    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())

    act(() => {
      const btn = screen.getByRole('button', { name: 'Update pantry' })
      btn.click()
      btn.click()
    })

    await waitFor(() => expect(confirmMealCook).toHaveBeenCalledTimes(1))

    act(() => {
      resolveConfirm(CONFIRM_RESPONSE)
    })
    await waitFor(() => expect(screen.getByText('Pantry updated!')).toBeInTheDocument())
    expect(confirmMealCook).toHaveBeenCalledTimes(1)
  })

  it('the two-tab checkpoint closes the sheet when the meal was ended elsewhere', async () => {
    requestMealCookProposal.mockResolvedValue(baseProposal())

    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())

    // Another tab already confirmed (and ended) this same cook while the sheet was open here.
    endMealCookSession('meal-1')

    act(() => {
      screen.getByRole('button', { name: 'Update pantry' }).click()
    })

    expect(confirmMealCook).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
    await waitFor(() => expect(screen.queryByTestId('meal-cook-sheet')).not.toBeInTheDocument())
  })

  it('a different cook of the same meal (mismatched cook_id) is also treated as ended elsewhere (review S1)', async () => {
    requestMealCookProposal.mockResolvedValue(baseProposal())

    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())

    // Another tab ended THIS cook and started a fresh one for the same meal
    // (a different `cook_id`) — this tab's held session is now stale, even
    // though a session for meal-1 is active again by the time it confirms.
    const before = getActiveMealCookSession('meal-1')
    endMealCookSession('meal-1')
    startMealCookSession('meal-1', ['r-main'], Date.now(), MAIN_STEP_SIGNATURES)
    const after = getActiveMealCookSession('meal-1')
    expect(after?.cook_id).not.toBe(before?.cook_id)

    act(() => {
      screen.getByRole('button', { name: 'Update pantry' }).click()
    })

    expect(confirmMealCook).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
    await waitFor(() => expect(screen.queryByTestId('meal-cook-sheet')).not.toBeInTheDocument())
    // The fresh cook (the other tab's) must survive untouched — this tab's
    // stale confirm must not have ended it.
    expect(getActiveMealCookSession('meal-1')?.cook_id).toBe(after?.cook_id)
  })
})

describe('MealCookPage — finished: confirm_in_progress', () => {
  it('waits 2s and retries once with the same cook_ref, then succeeds', async () => {
    jest.useFakeTimers()
    requestMealCookProposal.mockResolvedValue(baseProposal())
    confirmMealCook
      .mockRejectedValueOnce(new MealCookError('still saving', 'confirm_in_progress'))
      .mockResolvedValueOnce(CONFIRM_RESPONSE)

    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Update pantry' }).click()
    })

    await waitFor(() => expect(confirmMealCook).toHaveBeenCalledTimes(1))
    // Still waiting on the automatic retry — no error surfaced, so no Retry/Back to meal yet.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to meal' })).not.toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(2000)
    })
    await waitFor(() => expect(confirmMealCook).toHaveBeenCalledTimes(2))

    const calls = confirmMealCook.mock.calls as Array<[{ cook_ref: string }]>
    expect(calls[0][0].cook_ref).toBe(calls[1][0].cook_ref)

    await waitFor(() => expect(screen.getByText('Pantry updated!')).toBeInTheDocument())
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })

  it('twice in a row surfaces confirm_incomplete: Back to meal with no Retry, and exactly two confirm calls total', async () => {
    jest.useFakeTimers()
    requestMealCookProposal.mockResolvedValue(baseProposal())
    confirmMealCook.mockRejectedValue(new MealCookError('still saving', 'confirm_in_progress'))

    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Update pantry' }).click()
    })

    await waitFor(() => expect(confirmMealCook).toHaveBeenCalledTimes(1))
    act(() => {
      jest.advanceTimersByTime(2000)
    })
    await waitFor(() => expect(confirmMealCook).toHaveBeenCalledTimes(2))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to meal' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: 'Back to meal' }).click()
    })

    expect(confirmMealCook).toHaveBeenCalledTimes(2)
    expect(isMealCookSessionEnded('meal-1')).toBe(true)
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })
})

describe('MealCookPage — finished: sheet error kinds', () => {
  it('dish_mismatch shows Back to meal, which does not end the session', async () => {
    requestMealCookProposal.mockRejectedValue(new MealCookError('This meal changed', 'dish_mismatch'))

    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to meal' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: 'Back to meal' }).click()
    })

    expect(isMealCookSessionEnded('meal-1')).toBe(false)
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })
})

describe('MealCookPage — finished: closing without acting', () => {
  it('X Close on the finished screen does not end the session', async () => {
    await renderFinishedLive(Date.now() - 20 * 60_000)

    act(() => {
      screen.getByRole('button', { name: 'Close cook-along' }).click()
    })

    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
    expect(isMealCookSessionEnded('meal-1')).toBe(false)
  })

  it('Skip pantry update ends the session with no network call', async () => {
    await renderFinishedLive(Date.now() - 20 * 60_000)

    act(() => {
      screen.getByRole('button', { name: 'Skip pantry update' }).click()
    })

    expect(isMealCookSessionEnded('meal-1')).toBe(true)
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
    expect(requestMealCookProposal).not.toHaveBeenCalled()
    expect(confirmMealCook).not.toHaveBeenCalled()
  })
})

describe('MealCookPage — finished: auto-open on restore vs live finish (Nit 6)', () => {
  it('restoring an already-finished session shows the finished screen with the sheet auto-opened, and no Now card', async () => {
    requestMealCookProposal.mockResolvedValue(baseProposal())
    seedSession(Date.now() - 20 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
      'r-main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0 },
      'r-main:2': { status: 'done', started_at_minutes: 13, extra_minutes: 0 },
    })
    renderPage()

    await waitFor(() => expect(screen.getByTestId('meal-cook-finished')).toBeInTheDocument())
    expect(screen.queryByTestId('meal-now-card-badge')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('meal-cook-sheet')).toBeInTheDocument())
    await waitFor(() => expect(requestMealCookProposal).toHaveBeenCalledTimes(1))
  })

  it('finishing live on this mount shows the finished screen with the sheet closed', async () => {
    await renderFinishedLive(Date.now() - 20 * 60_000)

    expect(screen.queryByTestId('meal-cook-sheet')).not.toBeInTheDocument()
    expect(requestMealCookProposal).not.toHaveBeenCalled()
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
    const degradedMeal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: degradedRecipe }] })
    fetchMeal.mockResolvedValue(degradedMeal)
    startMealCookSession('meal-1', ['r-degraded'], Date.now(), dishStepSignaturesForMeal(degradedMeal))
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

describe('MealCookPage — waiting card (PR #661 review)', () => {
  it('renders the running strip once and no next-up line while only a hands-off step cooks', async () => {
    // Last step is hands-off: once it's started there's nothing pending, so
    // the stream falls to `waiting`. The card already lists what's running.
    const endsOnSimmer: Recipe = { ...MAIN_RECIPE, steps: MAIN_RECIPE.steps!.slice(0, 2) }
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: endsOnSimmer }] })
    fetchMeal.mockResolvedValue(meal)
    mockTimers = [
      { id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 400, status: 'running' },
    ]
    const startedAt = Date.now() - 6 * 60_000
    const session = startMealCookSession('meal-1', ['r-main'], startedAt, dishStepSignaturesForMeal(meal))
    saveMealCookProgress({
      ...session,
      steps: {
        'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0, ended_at_minutes: 5 },
        'r-main:1': { status: 'running', started_at_minutes: 5, extra_minutes: 0, timer_id: 'timer-1' },
      },
    })

    renderPage()

    await waitFor(() => expect(screen.getByTestId('meal-now-card-waiting-copy')).toBeInTheDocument())
    expect(screen.getAllByTestId('meal-running-strip')).toHaveLength(1)
    expect(screen.queryByTestId('meal-next-up')).not.toBeInTheDocument()
    expect(screen.queryByText("That's the last step")).not.toBeInTheDocument()
  })
})

describe('MealCookPage — Ask Bubbly (issue #654 PR B, §3/§6)', () => {
  const PASTA_WITH_INGREDIENTS: Recipe = {
    ...MAIN_RECIPE,
    ingredients: [{ name: 'Cream', quantity: 150, unit: 'ml' }],
  }

  function baseChatResponse(overrides: Partial<ChatResponse> = {}): ChatResponse {
    return {
      request_id: 'req-1',
      workflow_id: 'wf-1',
      conversation_id: 'conv-1',
      intent: 'cooking_help',
      assistant_message: 'Sure!',
      proposal: null,
      confidence: { overall: 0.9 },
      requires_review: false,
      next_action: 'none',
      ...overrides,
    }
  }

  const AMENDMENT_PROPOSAL = {
    proposal_type: 'recipe_amendment' as const,
    is_amendment: true,
    amended_ingredients: [
      { name: 'Greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null },
    ],
    change_summary: 'Swapped the cream for yoghurt',
    recipe_id: 'r-main',
    recipe_title: 'Pasta dinner',
  }

  /** Queues the next `streamChatMessage` call to resolve immediately via `onDone`. */
  function queueChatResponse(response: ChatResponse) {
    streamChatMessageMock.mockImplementationOnce(
      async (_req: unknown, _onToken: unknown, onDone: (r: ChatResponse) => void) => {
        onDone(response)
      },
    )
  }

  function sendOverlayMessage(text: string) {
    const input = screen.getByPlaceholderText(/ask about this step/i)
    fireEvent.change(input, { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: /send question/i }))
  }

  it('the pill on an active card opens the overlay pinned to that card\'s dish', async () => {
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }] })
    fetchMeal.mockResolvedValue(meal)
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())

    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })

    expect(screen.getByText('Asking about Pasta dinner')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Ask Bubbly about step 1' })).toBeInTheDocument()
  })

  it('the first turn sends context.cooking_recipe at recipe scale, and later turns reuse the same conversation_id', async () => {
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }] })
    fetchMeal.mockResolvedValue(meal)
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })

    queueChatResponse(baseChatResponse())
    act(() => {
      sendOverlayMessage('can I use yoghurt instead of cream?')
    })
    expect(streamChatMessageMock).toHaveBeenCalledTimes(1)
    const firstRequest = streamChatMessageMock.mock.calls[0][0]
    expect(firstRequest.context).toEqual({
      cooking_recipe: {
        id: 'r-main',
        title: 'Pasta dinner',
        ingredients: [{ name: 'Cream', quantity: 150, unit: 'ml' }],
      },
    })
    const conversationId = firstRequest.conversation_id
    expect(typeof conversationId).toBe('string')

    queueChatResponse(baseChatResponse())
    act(() => {
      sendOverlayMessage('and something else?')
    })
    expect(streamChatMessageMock).toHaveBeenCalledTimes(2)
    expect(streamChatMessageMock.mock.calls[1][0].conversation_id).toBe(conversationId)
  })

  it('sends the stored planning constraints of the meal as context.meal_constraints (#814)', async () => {
    const constraints = {
      kitchen_limits: ['one pan'],
      exclusive_tags: ['pan'],
      recipe_constraints: { dietary: ['dairy-free'], excluded_ingredients: ['peanuts'] },
    }
    const meal = baseMeal({
      constraints,
      dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }],
    })
    fetchMeal.mockResolvedValue(meal)
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })

    queueChatResponse(baseChatResponse())
    act(() => {
      sendOverlayMessage('can I use butter?')
    })
    const request = streamChatMessageMock.mock.calls[0][0]
    expect(request.context.meal_constraints).toEqual(constraints)
    // The cook's own conversation: never the meal's planning conversation id.
    expect(request.conversation_id).not.toBe(meal.id)
  })

  it('applying an amendment then asking again sends the amended list', async () => {
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }] })
    fetchMeal.mockResolvedValue(meal)
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })

    queueChatResponse(
      baseChatResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }),
    )
    act(() => {
      sendOverlayMessage('can I use yoghurt instead of cream?')
    })
    expect(screen.getByTestId('ask-bubbles-amendment-card')).toBeInTheDocument()

    act(() => {
      screen.getByTestId('ask-bubbles-amendment-use').click()
    })

    queueChatResponse(baseChatResponse())
    act(() => {
      sendOverlayMessage('anything else to change?')
    })

    const secondRequest = streamChatMessageMock.mock.calls[1][0]
    // pinnedIngredientsForDish passes an amendment's objects through as-is
    // (only `quantity` may be rescaled) — `notes` survives here, unlike
    // cookedIngredientsForDish's sanitize step for the actual cook request.
    expect(secondRequest.context.cooking_recipe.ingredients).toEqual([
      { name: 'Greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null },
    ])
  })

  it('an applied amendment survives a remount and reaches the next requestMealCookProposal call, scaled to the meal', async () => {
    const meal = baseMeal({ servings: 4, dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }] })
    fetchMeal.mockResolvedValue(meal)
    requestMealCookProposal.mockResolvedValue(baseProposal())
    seedSession(Date.now())
    const { unmount } = renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())

    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    queueChatResponse(
      baseChatResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }),
    )
    act(() => {
      sendOverlayMessage('can I use yoghurt instead of cream?')
    })
    act(() => {
      screen.getByTestId('ask-bubbles-amendment-use').click()
    })

    // Stored at the recipe's own effective servings (2), not the meal's (4).
    const persisted = getActiveMealCookSession('meal-1')
    expect(persisted?.ingredient_amendments['r-main']).toMatchObject({ servings: 2 })

    unmount()

    // Simulate finishing the cook (all steps done) without going through the
    // UI — the amendment applied above, already persisted, is the only thing
    // under test here.
    const afterAmendment = getActiveMealCookSession('meal-1')!
    saveMealCookProgress({
      ...afterAmendment,
      steps: {
        'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
        'r-main:1': { status: 'done', started_at_minutes: 5, extra_minutes: 0 },
        'r-main:2': { status: 'done', started_at_minutes: 13, extra_minutes: 0 },
      },
    })

    renderPage()
    await waitFor(() => expect(requestMealCookProposal).toHaveBeenCalledTimes(1))
    const req = requestMealCookProposal.mock.calls[0][0] as { dishes: Array<{ ingredients: unknown[] }> }
    // mealServings 4 / amendment.servings 2 = factor 2 → 150 -> 300
    expect(req.dishes[0].ingredients).toEqual([
      { name: 'Greek yoghurt', quantity: 300, unit: 'ml', optional: false },
    ])
  })

  it('drops a blank-named ingredient line before applying, keeping the rest (issue #654 review, S1)', async () => {
    // The overlay itself now also filters a blank-named line before it ever
    // calls `onApplyAmendment` (its own S1 fix) — this is still worth
    // covering end to end, since the page's own filter in `handleApplyAmendment`
    // is a defence-in-depth backstop that must produce the same result.
    // `meal-cook-page-apply-guards.test.tsx` exercises the page's filter in
    // isolation, bypassing the overlay, for the case the overlay can't cover
    // (all lines blank — no card is ever rendered to click).
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }] })
    fetchMeal.mockResolvedValue(meal)
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })

    const mixedProposal = {
      ...AMENDMENT_PROPOSAL,
      amended_ingredients: [
        { name: '  ', quantity: 1, unit: 'g', optional: false, notes: null },
        { name: 'Greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null },
      ],
    }
    queueChatResponse(baseChatResponse({ proposal: mixedProposal, requires_review: true, next_action: 'review_proposal' }))
    act(() => {
      sendOverlayMessage('can I use yoghurt instead of cream?')
    })
    act(() => {
      screen.getByTestId('ask-bubbles-amendment-use').click()
    })

    const persisted = getActiveMealCookSession('meal-1')
    expect(persisted?.ingredient_amendments['r-main']).toMatchObject({
      ingredients: [{ name: 'Greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null }],
    })
  })

  it('an amendment for another dish is ignored — no card, no session mutation', async () => {
    const SIDE_WITH_INGREDIENTS: Recipe = { ...SIDE_RECIPE, ingredients: [{ name: 'Garlic', quantity: 1, unit: 'clove' }] }
    const meal = mealWithSide()
    meal.dishes = [
      { role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS },
      { role: 'side', position: 1, recipe: SIDE_WITH_INGREDIENTS },
    ]
    fetchMeal.mockResolvedValue(meal)
    const signatures = dishStepSignaturesForMeal(meal)
    startMealCookSession('meal-1', ['r-main', 'r-side'], Date.now(), signatures)
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())

    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    expect(screen.getByText('Asking about Pasta dinner')).toBeInTheDocument()

    // The model's reply names the OTHER dish (r-side) — the overlay is
    // pinned to r-main, so this never becomes an actionable card, and
    // nothing is ever applied to the session.
    queueChatResponse(
      baseChatResponse({
        proposal: { ...AMENDMENT_PROPOSAL, recipe_id: 'r-side', recipe_title: 'Garlic bread' },
        requires_review: true,
        next_action: 'review_proposal',
      }),
    )
    act(() => {
      sendOverlayMessage('what about the bread?')
    })

    expect(screen.queryByTestId('ask-bubbles-amendment-card')).not.toBeInTheDocument()
    const persisted = getActiveMealCookSession('meal-1')
    expect(persisted?.ingredient_amendments).toEqual({})
  })

  it("the Now card advancing while the overlay is open doesn't change the pin", async () => {
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }] })
    fetchMeal.mockResolvedValue(meal)
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())

    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    expect(screen.getByRole('dialog', { name: 'Ask Bubbly about step 1' })).toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitFor(() => expect(screen.queryByText('Boil pasta')).not.toBeInTheDocument())

    // The overlay is still pinned to the original step (1), not whatever the
    // Now card moved on to.
    expect(screen.getByRole('dialog', { name: 'Ask Bubbly about step 1' })).toBeInTheDocument()
    expect(screen.getByText('Asking about Pasta dinner')).toBeInTheDocument()
  })

  it('no request other than the chat stream is made on apply — the saved recipe is untouched', async () => {
    const meal = baseMeal({ dishes: [{ role: 'main', position: 0, recipe: PASTA_WITH_INGREDIENTS }] })
    fetchMeal.mockResolvedValue(meal)
    seedSession(Date.now())
    renderPage()
    await waitFor(() => expect(screen.getByText('Boil pasta')).toBeInTheDocument())
    expect(fetchMeal).toHaveBeenCalledTimes(1)

    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    queueChatResponse(
      baseChatResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }),
    )
    act(() => {
      sendOverlayMessage('can I use yoghurt instead of cream?')
    })

    // Review N2 — `streamChatMessage` is mocked above the API layer, so this
    // also spies on `fetch` itself: applying the amendment must not reach the
    // network through any path other than that mocked chat call (in
    // particular, never a direct write to the saved recipe).
    const fetchSpy = jest.spyOn(global, 'fetch')
    act(() => {
      screen.getByTestId('ask-bubbles-amendment-use').click()
    })
    const nonChatFetches = fetchSpy.mock.calls.filter(
      ([input]) => !String(input).includes('/v1/chat'),
    )
    expect(nonChatFetches).toEqual([])
    fetchSpy.mockRestore()

    expect(fetchMeal).toHaveBeenCalledTimes(1)
    expect(requestMealCookProposal).not.toHaveBeenCalled()
    expect(confirmMealCook).not.toHaveBeenCalled()
    expect(streamChatMessageMock).toHaveBeenCalledTimes(1)
  })
})

describe('MealCookPage — Start now is never locked behind a running timer (issues #663, #890)', () => {
  // The :312-style fixture: Simmer sauce runs on timer-1, and Plate up (its
  // dependent) is the upcoming card, "after Simmer sauce".
  function seedSimmerRunning() {
    seedSession(Date.now() - 8 * 60_000, {
      'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 },
      'r-main:1': { status: 'running', started_at_minutes: 5, extra_minutes: 0, timer_id: 'timer-1' },
    })
    mockTimers = [
      { id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 120, status: 'running' },
    ]
  }

  it('explains the wait and still offers Start now, Skip and Done early while the dependency runs', async () => {
    seedSimmerRunning()
    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-now-card-waiting-on')).toHaveTextContent('Simmer sauce'))

    expect(screen.getByTestId('meal-now-card-waiting-on')).toHaveTextContent('You can start now')
    expect(screen.getByTestId('meal-now-card-keeps-running')).toHaveTextContent('Simmer sauce keeps running')
    expect(screen.getByRole('button', { name: 'Start now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simmer sauce done early' })).toBeInTheDocument()
  })

  it('Start now makes the step active while the running timer keeps running; Done, then the timer finishing, ends the cook', async () => {
    jest.useFakeTimers()
    seedSimmerRunning()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start now' })).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Start now' }).click()
    })
    await waitForStepStatus('r-main:2', 'running')

    // The timer is untouched: not dismissed, not restarted, step still running.
    expect(mockDismiss).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
    const afterStart = getActiveMealCookSession('meal-1')
    expect(afterStart?.steps['r-main:1']).toMatchObject({ status: 'running', timer_id: 'timer-1' })
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-on')
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.getByTestId('meal-running-strip')).toHaveTextContent('the sauce simmers')

    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitForStepStatus('r-main:2', 'done')
    // Only the simmer is left, still running in the dock: not finished yet.
    expect(screen.getByTestId('meal-now-card-waiting-copy')).toBeInTheDocument()
    expect(getActiveMealCookSession('meal-1')?.steps['r-main:1']?.status).toBe('running')

    // The timer finishing later completes the cook, nothing regresses.
    mockTimers = [{ id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 0, status: 'completed' }]
    act(() => {
      jest.advanceTimersByTime(65_000)
    })
    act(() => {
      window.dispatchEvent(new CustomEvent(TIMER_COMPLETED_EVENT, { detail: { id: 'timer-1', label: 'Simmer sauce' } }))
    })
    await waitForStepStatus('r-main:1', 'done')
    expect(screen.queryByTestId('meal-now-card')).not.toBeInTheDocument()
  })

  it('Done early dismisses the running timer, marks its step done and unblocks the dependent', async () => {
    seedSimmerRunning()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simmer sauce done early' })).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Simmer sauce done early' }).click()
    })

    expect(mockDismiss).toHaveBeenCalledWith('timer-1')
    await waitForStepStatus('r-main:1', 'done')
    await waitFor(() => expect(screen.queryByTestId('meal-now-card-waiting-on')).not.toBeInTheDocument())
    expect(screen.getByText('Plate up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start now' })).toBeInTheDocument()
  })

  it('a second tap right after Done early does not land on Start now (tap guard, issue #890)', async () => {
    seedSimmerRunning()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simmer sauce done early' })).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Simmer sauce done early' }).click()
    })
    await waitForStepStatus('r-main:1', 'done')
    // Same step stays the card (upcoming, no longer waiting): Start now now sits
    // where the finger just was. A double tap must not start Plate up.
    act(() => {
      screen.getByRole('button', { name: 'Start now' }).click()
    })
    expect(getActiveMealCookSession('meal-1')?.steps['r-main:2']).toBeUndefined()
  })

  it('the waiting card (nothing to do) offers "<step> done early" for the running timer (issue #890)', async () => {
    jest.useFakeTimers()
    seedSimmerRunning()
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start now' })).toBeInTheDocument())
    act(() => {
      screen.getByRole('button', { name: 'Start now' }).click()
    })
    await waitForStepStatus('r-main:2', 'running')
    act(() => {
      screen.getByRole('button', { name: 'Done' }).click()
    })
    await waitForStepStatus('r-main:2', 'done')
    expect(screen.getByTestId('meal-now-card-waiting-copy')).toBeInTheDocument()

    // Clear the card-change tap guard, as a real second elapses.
    act(() => {
      jest.advanceTimersByTime(500)
    })
    act(() => {
      screen.getByRole('button', { name: 'Simmer sauce done early' }).click()
    })

    expect(mockDismiss).toHaveBeenCalledWith('timer-1')
    await waitForStepStatus('r-main:1', 'done')
    // Everything is done: the cook is finished without ever reaching the dock x.
    expect(screen.queryByTestId('meal-now-card')).not.toBeInTheDocument()
  })

  it('once the dependency completes, the waiting-on line is gone and Start now is offered', async () => {
    jest.useFakeTimers()
    seedSimmerRunning()
    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-now-card-waiting-on')).toBeInTheDocument())

    mockTimers = [{ id: 'timer-1', label: 'Simmer sauce', durationSeconds: 480, remainingSeconds: 0, status: 'completed' }]
    act(() => {
      jest.advanceTimersByTime(65_000)
    })
    act(() => {
      window.dispatchEvent(new CustomEvent(TIMER_COMPLETED_EVENT, { detail: { id: 'timer-1', label: 'Simmer sauce' } }))
    })

    await waitFor(() => expect(screen.queryByTestId('meal-now-card-waiting-on')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Start now' })).toBeInTheDocument()
  })
})

describe('MealCookPage — deductions the server skipped (issue #621)', () => {
  async function openSheetAndConfirm() {
    requestMealCookProposal.mockResolvedValue(baseProposal())
    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())
    act(() => {
      screen.getByRole('button', { name: 'Update pantry' }).click()
    })
    await waitFor(() => expect(confirmMealCook).toHaveBeenCalledTimes(1))
  }

  it('shows the notice with the skipped item name and does not redirect after 1200ms', async () => {
    jest.useFakeTimers()
    confirmMealCook.mockResolvedValue({ ...CONFIRM_RESPONSE, deductions_skipped: ['pantry-1'] })
    await openSheetAndConfirm()

    await waitFor(() => expect(screen.getByTestId('skipped-deductions-notice')).toHaveTextContent('Pasta'))
    expect(isMealCookSessionEnded('meal-1')).toBe(true)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('two refused rows that are both named Butter read as 2 items, naming Butter once', async () => {
    jest.useFakeTimers()
    const [pasta] = baseProposal().matches
    const butter = (id: string) => ({ ...pasta, ingredient_name: 'Butter', pantry_item_id: id, pantry_item_name: 'Butter' })
    requestMealCookProposal.mockResolvedValue(baseProposal({ matches: [butter('pantry-b1'), butter('pantry-b2')] }))
    confirmMealCook.mockResolvedValue({ ...CONFIRM_RESPONSE, deductions_skipped: ['pantry-b1', 'pantry-b2'] })

    await renderFinishedLive(Date.now() - 20 * 60_000)
    act(() => {
      screen.getByRole('button', { name: 'Mark meal as cooked' }).click()
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update pantry' })).toBeInTheDocument())
    act(() => {
      screen.getByRole('button', { name: 'Update pantry' }).click()
    })

    await waitFor(() =>
      expect(screen.getByTestId('skipped-deductions-notice')).toHaveTextContent(
        "Couldn't update 2 items: Butter. Check your pantry.",
      ),
    )
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('an id the proposal cannot name still shows the notice', async () => {
    jest.useFakeTimers()
    confirmMealCook.mockResolvedValue({ ...CONFIRM_RESPONSE, deductions_skipped: ['pantry-ghost'] })
    await openSheetAndConfirm()

    await waitFor(() => expect(screen.getByTestId('skipped-deductions-notice')).toBeInTheDocument())
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('Back to meal pushes /meals/meal-1', async () => {
    confirmMealCook.mockResolvedValue({ ...CONFIRM_RESPONSE, deductions_skipped: ['pantry-1'] })
    await openSheetAndConfirm()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to meal' })).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Back to meal' }).click()
    })
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })

  it('the sheet X leaves the same way', async () => {
    confirmMealCook.mockResolvedValue({ ...CONFIRM_RESPONSE, deductions_skipped: ['pantry-1'] })
    await openSheetAndConfirm()
    await waitFor(() => expect(screen.getByTestId('skipped-deductions-notice')).toBeInTheDocument())

    act(() => {
      screen.getByRole('button', { name: 'Close' }).click()
    })
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })

  it('Escape leaves the same way', async () => {
    confirmMealCook.mockResolvedValue({ ...CONFIRM_RESPONSE, deductions_skipped: ['pantry-1'] })
    await openSheetAndConfirm()
    await waitFor(() => expect(screen.getByTestId('skipped-deductions-notice')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })

  it('an empty list keeps the redirect and shows no notice', async () => {
    jest.useFakeTimers()
    confirmMealCook.mockResolvedValue({ ...CONFIRM_RESPONSE, deductions_skipped: [] })
    await openSheetAndConfirm()

    await waitFor(() => expect(isMealCookSessionEnded('meal-1')).toBe(true))
    expect(screen.queryByTestId('skipped-deductions-notice')).not.toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(pushMock).toHaveBeenCalledWith('/meals/meal-1')
  })
})
