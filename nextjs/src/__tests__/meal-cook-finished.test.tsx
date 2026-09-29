/**
 * Issue #653 — component test for `MealCookFinished`: the meal title and
 * the single "Back to meal" action.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MealCookFinished from '@/components/meal/MealCookFinished'

describe('MealCookFinished', () => {
  it('shows the meal title and calls onBackToMeal', () => {
    const onBackToMeal = jest.fn()
    render(<MealCookFinished mealTitle="Pasta night" onBackToMeal={onBackToMeal} />)
    expect(screen.getByTestId('meal-cook-finished')).toHaveTextContent('Pasta night')
    fireEvent.click(screen.getByRole('button', { name: 'Back to meal' }))
    expect(onBackToMeal).toHaveBeenCalledTimes(1)
  })
})
