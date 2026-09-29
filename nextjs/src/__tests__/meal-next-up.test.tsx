/**
 * Issue #653 — component tests for `MealNextUp`: the preview row and the
 * "That's the last step" empty state.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MealNextUp from '@/components/meal/MealNextUp'
import type { StreamStep } from '@/lib/meal-cook-stream'

const STEP: StreamStep = {
  key: 'recipe-2:0',
  dish_id: 'recipe-2',
  column: 'side_1',
  dish_title: 'Green salad',
  step_index: 0,
  label: 'Toss the salad',
  ongoing_label: null,
  text: 'Toss everything together.',
  duration_minutes: 3,
  hands_on: true,
  start: 15,
  end: 18,
}

describe('MealNextUp', () => {
  it('shows the dish name, the step label, and the clock time', () => {
    render(<MealNextUp step={STEP} clockLabel={(offset) => `+${offset}`} />)
    const row = screen.getByTestId('meal-next-up')
    expect(row).toHaveTextContent('Green salad')
    expect(row).toHaveTextContent('Toss the salad')
    expect(row).toHaveTextContent('+15')
  })

  it('says "That\'s the last step" when there is no next step', () => {
    render(<MealNextUp step={null} clockLabel={(offset) => `+${offset}`} />)
    expect(screen.getByTestId('meal-next-up')).toHaveTextContent("That's the last step.")
  })
})
