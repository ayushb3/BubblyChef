/**
 * Issue #654 — component tests for `MealCookFinished`. Superseded from
 * issue #653's single "Back to meal" action: with `canDeduct`, the primary
 * action is "Mark meal as cooked" and the secondary is "Skip pantry update";
 * `!canDeduct` (every dish skipped) offers only "Back to meal" — actually
 * `onFinishWithoutPantry` under that label (contract §5, §8).
 *
 * The `onBackToMeal` build-order shim (S6) is removed in build step 3 — the
 * page now always passes `onFinishWithoutPantry`.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MealCookFinished from '@/components/meal/MealCookFinished'

describe('MealCookFinished — canDeduct (both actions)', () => {
  it('shows Mark meal as cooked and Skip pantry update, and calls the right handler for each', () => {
    const onMarkCooked = jest.fn()
    const onFinishWithoutPantry = jest.fn()
    render(
      <MealCookFinished
        mealTitle="Pasta night"
        canDeduct
        onMarkCooked={onMarkCooked}
        onFinishWithoutPantry={onFinishWithoutPantry}
      />,
    )
    expect(screen.getByTestId('meal-cook-finished')).toHaveTextContent('Pasta night')

    fireEvent.click(screen.getByRole('button', { name: 'Mark meal as cooked' }))
    expect(onMarkCooked).toHaveBeenCalledTimes(1)
    expect(onFinishWithoutPantry).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Skip pantry update' }))
    expect(onFinishWithoutPantry).toHaveBeenCalledTimes(1)
  })

  it('names the skipped dish so it is clear why it will not be deducted', () => {
    render(
      <MealCookFinished
        mealTitle="Pasta night"
        canDeduct
        skippedDishTitles={['Garlic bread']}
        onMarkCooked={jest.fn()}
        onFinishWithoutPantry={jest.fn()}
      />,
    )
    expect(screen.getByTestId('meal-cook-finished-skipped-note')).toHaveTextContent(
      '‹Garlic bread› was skipped',
    )
  })

  it('renders no skipped-dish note when nothing was skipped', () => {
    render(
      <MealCookFinished
        mealTitle="Pasta night"
        canDeduct
        onMarkCooked={jest.fn()}
        onFinishWithoutPantry={jest.fn()}
      />,
    )
    expect(screen.queryByTestId('meal-cook-finished-skipped-note')).not.toBeInTheDocument()
  })
})

describe('MealCookFinished — !canDeduct (every dish skipped)', () => {
  it('offers only Back to meal, wired to onFinishWithoutPantry', () => {
    const onFinishWithoutPantry = jest.fn()
    render(
      <MealCookFinished
        mealTitle="Pasta night"
        canDeduct={false}
        onFinishWithoutPantry={onFinishWithoutPantry}
      />,
    )
    expect(screen.getByText(/nothing was cooked/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark meal as cooked/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to meal' }))
    expect(onFinishWithoutPantry).toHaveBeenCalledTimes(1)
  })
})

// Issue #812 — the finish screen speaks the cook flow's pixel language: the
// same PixelPanel + keycap (SpringButton) the Now card uses, plus Bubbles.
describe('MealCookFinished — cook-flow visual language (issue #812)', () => {
  it('is a pixel panel with a celebrating Bubbles', () => {
    const { container } = render(
      <MealCookFinished mealTitle="Pasta night" canDeduct onMarkCooked={jest.fn()} onFinishWithoutPantry={jest.fn()} />,
    )
    expect(screen.getByTestId('meal-cook-finished')).toHaveAttribute('data-pixel-panel')
    expect(container.querySelector('img[alt="Bubbles celebrate"]')).not.toBeNull()
  })

  it('renders Mark meal as cooked as the primary keycap and Skip pantry update as a secondary keycap', () => {
    render(
      <MealCookFinished mealTitle="Pasta night" canDeduct onMarkCooked={jest.fn()} onFinishWithoutPantry={jest.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Mark meal as cooked' })).toHaveAttribute('data-keycap', 'primary')
    const skip = screen.getByRole('button', { name: 'Skip pantry update' })
    expect(skip).toHaveAttribute('data-keycap', 'secondary')
    expect(skip.className).not.toMatch(/underline/)
  })

  it('renders Back to meal as a primary keycap when nothing can be deducted', () => {
    render(<MealCookFinished mealTitle="Pasta night" canDeduct={false} onFinishWithoutPantry={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Back to meal' })).toHaveAttribute('data-keycap', 'primary')
  })
})
