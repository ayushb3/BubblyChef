/**
 * Issue #654 PR A — component tests for the combined meal-cook deduction
 * sheet, `MealCookSheet`. Reuses `CookReviewBody`/`CookDeductionSummary`
 * (`components/recipes/CookReviewBody.tsx`), so most of the review-table
 * behaviour is already covered there and by `assumed-staples.test.tsx` /
 * `cook-flow-redesign.test.tsx` — these tests focus on what's new for a
 * meal: the merged-line source note, the shared-missing-item note, and the
 * sheet's own state machine (contract §5, §8).
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MealCookSheet from '@/components/meal/MealCookSheet'
import type { MealCookProposal, MealIngredientMatch } from '@/types/meals'

// Proxy-based passthrough so any `motion.<tag>` resolves to a real DOM
// element — the sheet's own backdrop/panel, and BubblesMascot's celebrate
// sparkle burst (`motion.span`) reached in the success state. Same pattern
// as `cook-flow-redesign.test.tsx`.
jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
      return React.createElement(Tag, rest, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) })
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  }
})

const garlicMatch = (): MealIngredientMatch => ({
  ingredient_name: 'garlic',
  ingredient_qty: null,
  ingredient_unit: null,
  pantry_item_id: 'garlic-1',
  pantry_item_name: 'garlic',
  pantry_qty_available: 10,
  deduct_qty: 3,
  base_unit: 'cloves',
  status: 'ready',
  shortfall: null,
  match_type: 'exact',
  substitution_note: null,
  sources: [
    {
      recipe_id: 'r1',
      dish_title: 'Pasta',
      ingredient_name: 'garlic',
      ingredient_qty: 2,
      ingredient_unit: 'cloves',
      required_base_qty: 2,
      status: 'ready',
      match_type: 'exact',
      substitution_note: null,
    },
    {
      recipe_id: 'r2',
      dish_title: 'Salad',
      ingredient_name: 'garlic',
      ingredient_qty: 1,
      ingredient_unit: 'clove',
      required_base_qty: 1,
      status: 'ready',
      match_type: 'exact',
      substitution_note: null,
    },
  ],
})

const pastaMatch = (): MealIngredientMatch => ({
  ingredient_name: 'pasta',
  ingredient_qty: 200,
  ingredient_unit: 'g',
  pantry_item_id: 'pasta-1',
  pantry_item_name: 'pasta',
  pantry_qty_available: 500,
  deduct_qty: 200,
  base_unit: 'g',
  status: 'ready',
  shortfall: null,
  match_type: 'exact',
  substitution_note: null,
  sources: [
    {
      recipe_id: 'r1',
      dish_title: 'Pasta',
      ingredient_name: 'pasta',
      ingredient_qty: 200,
      ingredient_unit: 'g',
      required_base_qty: 200,
      status: 'ready',
      match_type: 'exact',
      substitution_note: null,
    },
  ],
})

const saltMatch = (): MealIngredientMatch => ({
  ingredient_name: 'salt',
  ingredient_qty: null,
  ingredient_unit: null,
  pantry_item_id: null,
  pantry_item_name: null,
  pantry_qty_available: null,
  deduct_qty: null,
  base_unit: null,
  status: 'assumed',
  shortfall: null,
  match_type: 'none',
  substitution_note: null,
  sources: [
    {
      recipe_id: 'r1',
      dish_title: 'Pasta',
      ingredient_name: 'salt',
      ingredient_qty: null,
      ingredient_unit: null,
      required_base_qty: null,
      status: 'assumed',
      match_type: 'none',
      substitution_note: null,
    },
  ],
})

const unitConflictMatch = (): MealIngredientMatch => ({
  ingredient_name: 'butter',
  ingredient_qty: null,
  ingredient_unit: null,
  pantry_item_id: 'butter-1',
  pantry_item_name: 'butter',
  pantry_qty_available: 1,
  deduct_qty: null,
  base_unit: 'g',
  status: 'unit_conflict',
  shortfall: null,
  match_type: 'none',
  substitution_note: null,
  sources: [
    {
      recipe_id: 'r1',
      dish_title: 'Pasta',
      ingredient_name: 'butter',
      ingredient_qty: 1,
      ingredient_unit: 'tbsp',
      required_base_qty: null,
      status: 'unit_conflict',
      match_type: 'none',
      substitution_note: null,
    },
  ],
})

function baseProposal(overrides: Partial<MealCookProposal> = {}): MealCookProposal {
  return {
    proposal_type: 'meal_cook',
    meal_id: 'meal-1',
    meal_title: 'Pasta night',
    servings: 4,
    dishes: [
      { recipe_id: 'r1', title: 'Pasta', role: 'main', position: 0, ingredients_source: 'supplied' },
      { recipe_id: 'r2', title: 'Salad', role: 'side', position: 1, ingredients_source: 'supplied' },
    ],
    matches: [garlicMatch(), pastaMatch()],
    missing: [],
    missing_sources: {},
    missing_notes: {},
    unit_conflicts: [],
    compound_suggestions: [],
    expired_items: [],
    ...overrides,
  }
}

const noop = () => {}

describe('MealCookSheet — expired banner (PR #668 review)', () => {
  it('says "this meal", not "this recipe"', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal({
          expired_items: [{ ingredient_name: 'garlic', pantry_item_name: 'garlic', days_expired: 2 }],
        })}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByText('Expired ingredients in this meal')).toBeInTheDocument()
    expect(screen.queryByText('Expired ingredients in this recipe')).not.toBeInTheDocument()
  })
})

describe('MealCookSheet — merged-line source notes', () => {
  it('shows the source note on a line shared by two dishes', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByText(/From Pasta \(2 cloves\) \+ Salad \(1 clove\)/)).toBeInTheDocument()
  })

  it('shows no source note on a line only one dish uses', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    // "pasta" appears both as the ingredient name and the pantry match name
    // in its own row — the ingredient-name cell (first) has no "From …" note.
    const pastaNameCell = screen.getAllByText('pasta')[0].closest('td')
    expect(pastaNameCell?.textContent).not.toMatch(/From/)
  })
})

describe('MealCookSheet — shared missing items', () => {
  it('shows "Needed for …" when two dishes lack the same ingredient', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal({ missing: ['parmesan'], missing_sources: { parmesan: ['r1', 'r2'] } })}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByText(/Needed for Pasta \+ Salad/)).toBeInTheDocument()
  })

  it('shows no "Needed for" note when only one dish lacks it', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal({ missing: ['parmesan'], missing_sources: { parmesan: ['r1'] } })}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.queryByText(/Needed for/)).not.toBeInTheDocument()
  })

  // Code review, round 1: the gate must count DISTINCT recipe ids, not raw
  // list length — a repeated id (the backend already de-dupes, but this is
  // belt-and-braces) must not inflate a single dish into a shared note.
  it('shows no "Needed for" note when the same dish id is repeated in missing_sources', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal({ missing: ['parmesan'], missing_sources: { parmesan: ['r1', 'r1'] } })}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.queryByText(/Needed for/)).not.toBeInTheDocument()
  })
})

describe('MealCookSheet — assumed staples collapsed', () => {
  it('collapses assumed rows into the "Basics assumed:" line, same as CookModal', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal({ matches: [garlicMatch(), pastaMatch(), saltMatch()] })}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    const summary = screen.getByLabelText(/assumed culinary staples/i)
    expect(summary.textContent).toMatch(/salt/i)
    expect(screen.queryAllByText(/^Assumed$/)).toHaveLength(0)
  })
})

describe('MealCookSheet — unit_conflict feeds onConfirm', () => {
  it('sends the typed quantity in the confirm deductions', () => {
    const onConfirm = jest.fn()
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal({ matches: [unitConflictMatch()] })}
        onConfirm={onConfirm}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    const input = screen.getByLabelText(/deduct quantity for butter/i)
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: /update pantry/i }))
    expect(onConfirm).toHaveBeenCalledWith([{ pantry_item_id: 'butter-1', deduct_qty: 15, base_unit: 'g' }])
  })

  it('demotes the confirm button to "Update anyway" while the row is unresolved', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal({ matches: [unitConflictMatch()] })}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /update anyway/i })).toBeInTheDocument()
  })
})

describe('MealCookSheet — state machine', () => {
  it('shows a loading indicator in the loading state', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="loading"
        proposal={null}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows Retry with no errorKind, and calls onRetry', () => {
    const onRetry = jest.fn()
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="error"
        proposal={null}
        errorMessage="Network error"
        onConfirm={jest.fn()}
        onRetry={onRetry}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByText('Network error')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /back to meal/i })).not.toBeInTheDocument()
  })

  it('shows Back to meal and no Retry when errorKind is set, and calls onBackToMeal', () => {
    const onBackToMeal = jest.fn()
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="error"
        proposal={null}
        errorMessage="This meal changed while you were cooking."
        errorKind="dish_mismatch"
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={onBackToMeal}
        onClose={noop}
      />,
    )
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back to meal/i }))
    expect(onBackToMeal).toHaveBeenCalledTimes(1)
  })

  it('shows the success state', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="success"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByText(/pantry updated/i)).toBeInTheDocument()
  })

  it('disables the confirm button while confirming', () => {
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="confirming"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  // Code review, round 1: while a confirm is in flight, every dismiss path
  // (✕, backdrop, Escape) must be a no-op — otherwise closing and reopening
  // (or a second "Mark meal as cooked") could start a second request that
  // races the first.
  it('ignores the close (✕) button while confirming', () => {
    const onClose = jest.fn()
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="confirming"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores Escape while confirming', () => {
    const onClose = jest.fn()
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="confirming"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a backdrop click while confirming', () => {
    const onClose = jest.fn()
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="confirming"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still calls onClose via ✕ and Escape when not confirming', () => {
    const onClose = jest.fn()
    render(
      <MealCookSheet
        open
        mealTitle="Pasta night"
        state="review"
        proposal={baseProposal()}
        onConfirm={jest.fn()}
        onRetry={noop}
        onBackToMeal={noop}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
