/**
 * Issue #654 PR B code review follow-ups (S1, N3) — `MealCookPage`'s own
 * defensive checks in `handleApplyAmendment` are unreachable through the real
 * `AskBubblesOverlay`, which already gates both cases before any actionable
 * button exists:
 *  - a mismatched `recipe_id` never renders a card at all (see
 *    `ask-bubbles-overlay.test.tsx`'s "renders no card for a proposal whose
 *    recipe_id does not match the pin", and `meal-cook-page.test.tsx`'s "an
 *    amendment for another dish is ignored", which exercises that same
 *    overlay-level gate end to end);
 *  - a blank-named ingredient line is filtered by the overlay itself before
 *    `onApplyAmendment` is ever called, and the card doesn't render at all if
 *    nothing survives that filter.
 *
 * This file isolates the page's OWN defence-in-depth guards by replacing the
 * overlay with a stub that calls `onApplyAmendment` directly with shapes the
 * real overlay would never produce, but the page must still refuse (or clean
 * up) on its own. Kept out of `meal-cook-page.test.tsx` because mocking the
 * overlay module there would corrupt every other test in that file, which
 * exercises the real overlay's chat/amendment flow.
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meal } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'
import { startMealCookSession, saveMealCookProgress, getActiveMealCookSession } from '@/lib/meal-cook-session'
import { dishStepSignaturesForMeal } from '@/lib/meal-dishes'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meal-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const fetchMeal = jest.fn()
jest.mock('@/lib/api/meals', () => {
  const actual = jest.requireActual('@/lib/api/meals')
  return {
    fetchMeal: (...args: unknown[]) => fetchMeal(...args),
    requestMealCookProposal: jest.fn(),
    confirmMealCook: jest.fn(),
    MealCookError: actual.MealCookError,
  }
})

type StubAmendment = {
  recipe_id: string
  ingredients: Array<{ name: string; quantity: number; unit: string; optional: boolean; notes: string | null }>
  change_summary: string | null
}

// A minimal stand-in for the real overlay: it ignores everything except
// `pinned`, and exposes two buttons, each calling `onApplyAmendment` with a
// shape the real overlay's own gates would never let through:
//  - "apply wrong dish": a recipe_id that isn't `pinned.recipe_id`;
//  - "apply blank line": ingredients including a blank-named line, mixed
//    with a valid one, and one that is ALL blank lines (the case the real
//    overlay can't produce a card for at all).
jest.mock('@/components/cook/AskBubblesOverlay', () => {
  return function MockAskBubblesOverlay(props: {
    pinned?: { recipe_id: string }
    onApplyAmendment?: (a: StubAmendment) => void
  }) {
    const wrongDishId = props.pinned?.recipe_id === 'r-main' ? 'r-side' : 'r-main'
    const pinnedId = props.pinned?.recipe_id ?? 'r-main'
    return (
      <>
        <button
          data-testid="apply-wrong-dish-amendment"
          onClick={() =>
            props.onApplyAmendment?.({
              recipe_id: wrongDishId,
              ingredients: [{ name: 'Garlic', quantity: 1, unit: 'clove', optional: false, notes: null }],
              change_summary: 'Wrong dish',
            })
          }
        >
          apply wrong dish
        </button>
        <button
          data-testid="apply-mixed-blank-amendment"
          onClick={() =>
            props.onApplyAmendment?.({
              recipe_id: pinnedId,
              ingredients: [
                { name: '  ', quantity: 1, unit: 'g', optional: false, notes: null },
                { name: 'Greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null },
              ],
              change_summary: 'Mixed blank + valid',
            })
          }
        >
          apply mixed blank
        </button>
        <button
          data-testid="apply-all-blank-amendment"
          onClick={() =>
            props.onApplyAmendment?.({
              recipe_id: pinnedId,
              ingredients: [{ name: '   ', quantity: 1, unit: 'g', optional: false, notes: null }],
              change_summary: 'All blank',
            })
          }
        >
          apply all blank
        </button>
      </>
    )
  }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MealCookPage = require('@/app/meals/[id]/cook/page').default as () => React.JSX.Element

function step(overrides: Partial<Step> & { text: string; label: string; duration_minutes: number; hands_on: boolean }): Step {
  return { ongoing_label: null, duration_estimated: false, depends_on: [], exclusive: [], ...overrides }
}

const MAIN_RECIPE: Recipe = {
  id: 'r-main',
  user_id: 'user-1',
  title: 'Pasta dinner',
  ingredients: [],
  instructions: ['Boil the pasta'],
  steps: [step({ text: 'Boil the pasta', label: 'Boil pasta', duration_minutes: 5, hands_on: true, depends_on: [] })],
  servings: 2,
}

const SIDE_RECIPE: Recipe = {
  id: 'r-side',
  user_id: 'user-1',
  title: 'Garlic bread',
  ingredients: [{ name: 'Garlic', quantity: 1, unit: 'clove' }],
  instructions: ['Toast the bread'],
  steps: [step({ text: 'Toast the bread', label: 'Toast bread', duration_minutes: 2, hands_on: true, depends_on: [] })],
  servings: 2,
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
      { role: 'main', position: 0, recipe: MAIN_RECIPE },
      { role: 'side', position: 1, recipe: SIDE_RECIPE },
    ],
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

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  fetchMeal.mockResolvedValue(baseMeal())
})

describe('MealCookPage — handleApplyAmendment wrong-dish guard (issue #654 review, N3)', () => {
  it("ignores an amendment naming a dish other than the one it's pinned to", async () => {
    const meal = baseMeal()
    const signatures = dishStepSignaturesForMeal(meal)
    const session = startMealCookSession('meal-1', ['r-main', 'r-side'], Date.now(), signatures)
    saveMealCookProgress(session)

    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-now-card-ask-bubbles')).toBeInTheDocument())

    // Pins the overlay to whichever dish is currently active/upcoming.
    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    await waitFor(() => expect(screen.getByTestId('apply-wrong-dish-amendment')).toBeInTheDocument())

    // The stub overlay calls onApplyAmendment with the OTHER dish's id — the
    // page's own guard must refuse it regardless of which dish got pinned.
    act(() => {
      screen.getByTestId('apply-wrong-dish-amendment').click()
    })

    const persisted = getActiveMealCookSession('meal-1')
    expect(persisted?.ingredient_amendments).toEqual({})
  })
})

describe('MealCookPage — handleApplyAmendment blank-name guard (issue #654 review, S1)', () => {
  it('drops a blank-named line and keeps the rest', async () => {
    const meal = baseMeal()
    const signatures = dishStepSignaturesForMeal(meal)
    const session = startMealCookSession('meal-1', ['r-main', 'r-side'], Date.now(), signatures)
    saveMealCookProgress(session)

    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-now-card-ask-bubbles')).toBeInTheDocument())
    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    await waitFor(() => expect(screen.getByTestId('apply-mixed-blank-amendment')).toBeInTheDocument())

    act(() => {
      screen.getByTestId('apply-mixed-blank-amendment').click()
    })

    const persisted = getActiveMealCookSession('meal-1')
    const dishId = Object.keys(persisted?.ingredient_amendments ?? {})[0]
    expect(persisted?.ingredient_amendments[dishId]).toMatchObject({
      ingredients: [{ name: 'Greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null }],
    })
  })

  it('applies nothing when every line has a blank name', async () => {
    const meal = baseMeal()
    const signatures = dishStepSignaturesForMeal(meal)
    const session = startMealCookSession('meal-1', ['r-main', 'r-side'], Date.now(), signatures)
    saveMealCookProgress(session)

    renderPage()
    await waitFor(() => expect(screen.getByTestId('meal-now-card-ask-bubbles')).toBeInTheDocument())
    act(() => {
      screen.getByTestId('meal-now-card-ask-bubbles').click()
    })
    await waitFor(() => expect(screen.getByTestId('apply-all-blank-amendment')).toBeInTheDocument())

    act(() => {
      screen.getByTestId('apply-all-blank-amendment').click()
    })

    const persisted = getActiveMealCookSession('meal-1')
    expect(persisted?.ingredient_amendments).toEqual({})
  })
})
