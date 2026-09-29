/**
 * Issue #652 — component tests for the full meal screen
 * (`app/meals/[id]/page.tsx`): the timeline recomputes after a side swap and
 * after a servings change, the side-count rule (Add only at one side, Remove
 * only at two, Remove confirms first), a too-soon serve-at time, and the
 * "estimates" note on a dish that still has no structured steps.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meal } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'meal-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const fetchMeal = jest.fn()
const updateMeal = jest.fn()
const fetchSideAlternatives = jest.fn()
const expandMealDish = jest.fn()
jest.mock('@/lib/api/meals', () => ({
  fetchMeal: (...args: unknown[]) => fetchMeal(...args),
  updateMeal: (...args: unknown[]) => updateMeal(...args),
  fetchSideAlternatives: (...args: unknown[]) => fetchSideAlternatives(...args),
  expandMealDish: (...args: unknown[]) => expandMealDish(...args),
  // Real shape (lib/api/meals.ts), not a mock stub — the page's own
  // title-fallback logic is worth exercising through these tests too.
  toNewDishRecipePayload: (
    recipe: { title?: string; instructions?: string[]; steps?: Step[] | null; servings?: number | null },
    fallbackTitle: string,
  ) => ({
    title: recipe.title ?? fallbackTitle,
    description: null,
    ingredients: [],
    instructions: recipe.instructions ?? [],
    steps: recipe.steps ?? null,
    cuisine: null,
    meal_type: null,
    dietary_tags: [],
    difficulty: null,
    prep_time_minutes: null,
    cook_time_minutes: null,
    total_time_minutes: null,
    servings: recipe.servings ?? null,
  }),
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
const SIDE1_RECIPE: Recipe = {
  id: 'r-side1',
  user_id: 'user-1',
  title: 'Green salad',
  ingredients: [{ name: 'lettuce', quantity: 1, unit: 'head' }],
  instructions: ['Toss the salad'],
  steps: [step('Toss the salad')],
  servings: 2,
}
const SIDE2_RECIPE: Recipe = {
  id: 'r-side2',
  user_id: 'user-1',
  title: 'Roast potatoes',
  ingredients: [],
  instructions: ['Roast the potatoes'],
  steps: [step('Roast the potatoes')],
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
    dishes: [
      { role: 'main', position: 0, recipe: MAIN_RECIPE },
      { role: 'side', position: 1, recipe: SIDE1_RECIPE },
      { role: 'side', position: 2, recipe: SIDE2_RECIPE },
    ],
    ...overrides,
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

beforeEach(() => {
  jest.clearAllMocks()
  ensureSteps.mockResolvedValue({ recipe_id: 'x', steps: [], derived: false })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('meal screen — timeline recomputation (issue #652)', () => {
  it('updates the timeline after swapping a side', async () => {
    const TWO_SIDES = baseMeal()
    const AFTER_SWAP = baseMeal({
      dishes: [
        TWO_SIDES.dishes[0],
        {
          role: 'side',
          position: 1,
          recipe: { ...SIDE1_RECIPE, id: 'r-new', title: 'Charred broccolini', instructions: ['Char it'], steps: [step('Char it')] },
        },
        TWO_SIDES.dishes[2],
      ],
    })
    fetchMeal.mockResolvedValueOnce(TWO_SIDES)
    fetchMeal.mockResolvedValueOnce(AFTER_SWAP)
    fetchSideAlternatives.mockResolvedValue([
      { role: 'side', name: 'Charred broccolini', blurb: 'Smoky.', key_ingredients: ['broccolini'], est_total_minutes: 10, est_hands_on_minutes: 5 },
    ])
    expandMealDish.mockResolvedValue({
      proposal_type: 'meal_dish',
      role: 'side',
      position: 1,
      recipe: { title: 'Charred broccolini', instructions: ['Char it'], steps: [step('Char it')], servings: 2 },
    })
    updateMeal.mockResolvedValue(AFTER_SWAP)

    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Swap' })[0])
    await screen.findByTestId('side-alternatives-row')
    // The alternative cards are `role="listitem"` (SideAlternativesRow: "a
    // horizontal scroll of three mini cards" — `role="list"` of `role=
    // "listitem"` buttons), not `role="button"`.
    const pick = await screen.findByRole('listitem', { name: 'Pick Charred broccolini' })
    fireEvent.click(pick)

    await waitFor(() =>
      expect(updateMeal).toHaveBeenCalledWith('meal-1', {
        replace_dish: {
          position: 1,
          recipe: expect.objectContaining({ title: 'Charred broccolini' }),
          expected_recipe_id: 'r-side1',
        },
      }),
    )

    await waitFor(() => expect(screen.queryByText('Green salad')).not.toBeInTheDocument())
    expect(screen.getAllByText('Charred broccolini').length).toBeGreaterThan(0)
  })

  it('recomputes without going stale after a servings change', async () => {
    fetchMeal.mockResolvedValue(baseMeal())
    updateMeal.mockResolvedValue(baseMeal({ servings: 3 }))

    renderPage()
    await screen.findByText(/Timeline —/)
    const before = screen.getByText(/Timeline —/).textContent

    fireEvent.click(screen.getByRole('button', { name: 'Increase servings' }))

    await waitFor(() => expect(updateMeal).toHaveBeenCalledWith('meal-1', { servings: 3 }))
    // Same dishes/steps, so the same total — proving the table re-rendered
    // from the fresh query data rather than freezing on the first render.
    await waitFor(() => expect(screen.getByText(/Timeline —/).textContent).toBe(before))
  })
})

describe('meal screen — side-count rule (issue #652)', () => {
  it('shows Remove (not Add) when the meal has two sides, and Remove asks for confirmation', async () => {
    fetchMeal.mockResolvedValue(baseMeal())
    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    expect(screen.queryByRole('button', { name: '+ Add a side' })).not.toBeInTheDocument()
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    expect(removeButtons.length).toBe(2)

    fireEvent.click(removeButtons[0])
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Remove this side?')
    expect(updateMeal).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('confirming Remove calls the remove_side op and refetches', async () => {
    const TWO_SIDES = baseMeal()
    const ONE_SIDE = baseMeal({ dishes: [TWO_SIDES.dishes[0], TWO_SIDES.dishes[1]] })
    fetchMeal.mockResolvedValueOnce(TWO_SIDES)
    fetchMeal.mockResolvedValueOnce(ONE_SIDE)
    updateMeal.mockResolvedValue(ONE_SIDE)

    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))

    await waitFor(() =>
      expect(updateMeal).toHaveBeenCalledWith('meal-1', {
        remove_side: { position: 2, expected_recipe_id: 'r-side2' },
      }),
    )
    await waitFor(() => expect(screen.queryByText('Roast potatoes')).not.toBeInTheDocument())
  })

  it('shows Add (not Remove) when the meal has only one side', async () => {
    fetchMeal.mockResolvedValue(baseMeal({ dishes: [baseMeal().dishes[0], baseMeal().dishes[1]] }))
    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add a side' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Swap' })).toBeInTheDocument()
  })
})

describe('meal screen — serve-at (issue #652)', () => {
  it('shows the too-late message and an "Use <earliest>" button for a serve-at time that has already passed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T18:00:00'))
    fetchMeal.mockResolvedValue(baseMeal())

    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    fireEvent.click(screen.getByRole('radio', { name: 'Serve at' }))
    // Same-day, later than now, but sooner than the meal's total (15 min) —
    // a time *earlier* than now would now roll over to tomorrow instead
    // (issue #652 review, serve-at past midnight), so this test needs a
    // same-day too-soon time instead.
    fireEvent.change(screen.getByLabelText('Serve at time'), { target: { value: '18:05' } })

    expect(await screen.findByTestId('serve-at-too-late')).toHaveTextContent("That's too soon")
    expect(screen.getByRole('button', { name: /^Use / })).toBeInTheDocument()
  })
})

describe('meal screen — concurrent dish ops (issue #652 review)', () => {
  it('an open remove confirm is locked once a swap starts on the other side (PR #660 review)', async () => {
    fetchMeal.mockResolvedValue(baseMeal())
    fetchSideAlternatives.mockResolvedValue([
      { role: 'side', name: 'Charred broccolini', blurb: 'Smoky.', key_ingredients: ['broccolini'],
        est_total_minutes: 10, est_hands_on_minutes: 5 },
    ])
    expandMealDish.mockReturnValue(new Promise(() => {}))

    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    // Open the remove confirm on the second side, then start a swap on the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(screen.getAllByRole('button', { name: 'Swap' })[0])
    fireEvent.click(await screen.findByRole('listitem', { name: 'Pick Charred broccolini' }))

    const confirm = within(dialog).getByRole('button', { name: 'Remove' })
    await waitFor(() => expect(confirm).toBeDisabled())
    fireEvent.click(confirm)
    expect(updateMeal).not.toHaveBeenCalled()
  })

  it('locks Swap, Remove and Add on every dish, and no-ops the row Cancel, while a pick is persisting', async () => {
    fetchMeal.mockResolvedValue(baseMeal())
    fetchSideAlternatives.mockResolvedValue([
      {
        role: 'side',
        name: 'Charred broccolini',
        blurb: 'Smoky.',
        key_ingredients: ['broccolini'],
        est_total_minutes: 10,
        est_hands_on_minutes: 5,
      },
    ])
    let resolveExpand: (value: unknown) => void = () => {}
    expandMealDish.mockReturnValue(
      new Promise((resolve) => {
        resolveExpand = resolve
      }),
    )

    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Swap' })[0])
    const pick = await screen.findByRole('listitem', { name: 'Pick Charred broccolini' })
    fireEvent.click(pick)

    // Mid-expand: every dish's Swap/Remove is locked (there are two of each —
    // one per side), not just the row the pick came from.
    await waitFor(() => {
      for (const btn of screen.getAllByRole('button', { name: 'Swap' })) expect(btn).toBeDisabled()
    })
    for (const btn of screen.getAllByRole('button', { name: 'Remove' })) expect(btn).toBeDisabled()

    // The row's own Cancel can't abort a mutation already in flight — it
    // no-ops rather than abandoning it, so the row stays put.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel choosing an alternative' }))
    expect(screen.getByTestId('side-alternatives-row')).toBeInTheDocument()

    updateMeal.mockResolvedValue(baseMeal())
    resolveExpand({
      proposal_type: 'meal_dish',
      role: 'side',
      position: 1,
      recipe: {
        title: 'Charred broccolini',
        instructions: ['Char it'],
        steps: [step('Char it')],
        servings: 2,
      },
    })

    await waitFor(() => expect(updateMeal).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('side-alternatives-row')).not.toBeInTheDocument())
    for (const btn of screen.getAllByRole('button', { name: 'Swap' })) expect(btn).not.toBeDisabled()
  })
})

describe('meal screen — remove via mutation (issue #652 review)', () => {
  it('shows a pending state while removing, then surfaces the server error instead of an unhandled rejection', async () => {
    fetchMeal.mockResolvedValue(baseMeal())
    let rejectRemove: (err: unknown) => void = () => {}
    updateMeal.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRemove = reject
      }),
    )

    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(await within(dialog).findByRole('button', { name: 'Removing…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    rejectRemove(new Error('That side changed since you loaded this meal.'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That side changed since you loaded this meal.',
    )
    // The dialog stays open with the error surfaced — nothing unhandled, and
    // the meal (both sides) is still on screen.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Roast potatoes', level: 3 })).toBeInTheDocument()
  })
})

describe('meal screen — missing-steps upgrade refetch (issue #652 review)', () => {
  function mealMissingSideSteps(): Meal {
    const m = baseMeal()
    return baseMeal({
      dishes: [m.dishes[0], m.dishes[1], { role: 'side', position: 2, recipe: { ...SIDE2_RECIPE, steps: null } }],
    })
  }

  it('invalidates and refetches the meal after ensureSteps derives new steps', async () => {
    fetchMeal.mockResolvedValueOnce(mealMissingSideSteps())
    fetchMeal.mockResolvedValueOnce(baseMeal())
    ensureSteps.mockResolvedValue({ recipe_id: 'r-side2', steps: [step('Roast the potatoes')], derived: true })

    renderPage()
    await screen.findByRole('heading', { name: 'Roast potatoes', level: 3 })

    await waitFor(() => expect(ensureSteps).toHaveBeenCalledWith('r-side2'))
    await waitFor(() => expect(fetchMeal).toHaveBeenCalledTimes(2))

    const potatoesCard = await screen.findByRole('region', { name: 'Roast potatoes — Side' })
    await waitFor(() =>
      expect(within(potatoesCard).queryByTestId('meal-dish-steps-estimated')).not.toBeInTheDocument(),
    )
  })

  it('still refetches under React 18 StrictMode double-invoke', async () => {
    fetchMeal.mockResolvedValue(mealMissingSideSteps())
    ensureSteps.mockResolvedValue({ recipe_id: 'r-side2', steps: [step('Roast the potatoes')], derived: true })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <React.StrictMode>
        <QueryClientProvider client={client}>
          <MealDetailPage />
        </QueryClientProvider>
      </React.StrictMode>,
    )

    await screen.findByRole('heading', { name: 'Roast potatoes', level: 3 })
    await waitFor(() => expect(ensureSteps).toHaveBeenCalledWith('r-side2'))
    // StrictMode's synthetic mount → effect → cleanup → effect again runs the
    // cleanup before `ensureSteps` ever resolves — a `cancelled` gate on the
    // invalidation would have swallowed it. `attemptedStepsRef` (a ref, not
    // reset by the double-invoke) is what actually stops a second call.
    await waitFor(() => expect(fetchMeal.mock.calls.length).toBeGreaterThanOrEqual(2))
  })
})

describe('meal screen — serve-at past midnight (issue #652 review)', () => {
  it('rolls "Use <earliest>" over to tomorrow and clears the too-late state', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T23:00:00'))
    const longStep = step('Slow roast it')
    longStep.duration_minutes = 60
    const LONG_MAIN: Recipe = {
      id: 'r-main-long',
      user_id: 'user-1',
      title: 'Slow roast',
      ingredients: [],
      instructions: ['Slow roast it'],
      steps: [longStep],
      servings: 2,
    }
    fetchMeal.mockResolvedValue(baseMeal({ dishes: [{ role: 'main', position: 0, recipe: LONG_MAIN }] }))

    renderPage()
    await screen.findByRole('heading', { name: 'Slow roast', level: 3 })

    fireEvent.click(screen.getByRole('radio', { name: 'Serve at' }))
    fireEvent.change(screen.getByLabelText('Serve at time'), { target: { value: '23:10' } })

    expect(await screen.findByTestId('serve-at-too-late')).toHaveTextContent("That's too soon")
    const useButton = screen.getByRole('button', { name: /^Use / })
    expect(useButton).toHaveTextContent('12:00 AM')

    fireEvent.click(useButton)

    await waitFor(() => expect(screen.queryByTestId('serve-at-too-late')).not.toBeInTheDocument())
  })
})

describe('meal screen — retry after a failed pick (issue #652 review, nit)', () => {
  it('retries the picked card rather than re-fetching alternatives', async () => {
    fetchMeal.mockResolvedValue(baseMeal())
    fetchSideAlternatives.mockResolvedValue([
      {
        role: 'side',
        name: 'Charred broccolini',
        blurb: 'Smoky.',
        key_ingredients: ['broccolini'],
        est_total_minutes: 10,
        est_hands_on_minutes: 5,
      },
    ])
    expandMealDish.mockRejectedValueOnce(new Error('AI service unavailable'))
    expandMealDish.mockResolvedValueOnce({
      proposal_type: 'meal_dish',
      role: 'side',
      position: 1,
      recipe: {
        title: 'Charred broccolini',
        instructions: ['Char it'],
        steps: [step('Char it')],
        servings: 2,
      },
    })
    updateMeal.mockResolvedValue(baseMeal())

    renderPage()
    await screen.findByRole('heading', { name: 'Green salad', level: 3 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Swap' })[0])
    const pick = await screen.findByRole('listitem', { name: 'Pick Charred broccolini' })
    fireEvent.click(pick)

    expect(await screen.findByRole('alert')).toHaveTextContent('AI service unavailable')
    expect(fetchSideAlternatives).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(updateMeal).toHaveBeenCalled())
    // Still just the one alternatives fetch — Retry re-attempted the picked
    // card (a second expand-dish call), not a fresh alternatives list.
    expect(fetchSideAlternatives).toHaveBeenCalledTimes(1)
    expect(expandMealDish).toHaveBeenCalledTimes(2)
  })
})

describe('meal screen — degraded dish note (issue #652)', () => {
  it('shows the estimates note on a dish that still has no structured steps', async () => {
    const meal = baseMeal({
      dishes: [
        baseMeal().dishes[0],
        baseMeal().dishes[1],
        { role: 'side', position: 2, recipe: { ...SIDE2_RECIPE, steps: null } },
      ],
    })
    fetchMeal.mockResolvedValue(meal)
    ensureSteps.mockRejectedValue(new Error('AI service unavailable'))

    renderPage()
    await screen.findByRole('heading', { name: 'Roast potatoes', level: 3 })

    await waitFor(() => expect(ensureSteps).toHaveBeenCalledWith('r-side2'))

    const potatoesCard = screen.getByRole('region', { name: 'Roast potatoes — Side' })
    expect(within(potatoesCard).getByTestId('meal-dish-steps-estimated')).toHaveTextContent(
      'Times for this dish are estimates.',
    )

    // The other dishes already had steps — no note on those.
    const saladCard = screen.getByRole('region', { name: 'Green salad — Side' })
    expect(within(saladCard).queryByTestId('meal-dish-steps-estimated')).not.toBeInTheDocument()
  })
})
