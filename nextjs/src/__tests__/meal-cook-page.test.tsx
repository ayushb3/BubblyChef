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
import type { Meal, MealCookProposal } from '@/types/meals'
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
import { dishStepSignaturesForMeal } from '@/lib/meal-dishes'
import { TIMER_COMPLETED_EVENT, type CookingTimer } from '@/lib/useCookingTimers'
// The real class, re-exported from the mock factory below — `err instanceof
// MealCookError` in the page needs the real constructor.
import { MealCookError } from '@/lib/api/meals'

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
