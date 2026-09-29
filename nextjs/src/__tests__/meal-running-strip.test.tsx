/**
 * Issue #653 — component tests for `MealRunningStrip`: the running-now list
 * and its empty state.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MealRunningStrip from '@/components/meal/MealRunningStrip'
import type { StreamStep } from '@/lib/meal-cook-stream'

const STEP: StreamStep = {
  key: 'recipe-1:1',
  dish_id: 'recipe-1',
  column: 'main',
  dish_title: 'Pasta with tomato sauce',
  step_index: 1,
  label: 'Simmer the sauce',
  ongoing_label: 'the sauce simmers',
  text: 'Let the sauce reduce.',
  duration_minutes: 12,
  hands_on: false,
  start: 10,
  end: 22,
}

describe('MealRunningStrip', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<MealRunningStrip steps={[]} clockLabel={(o) => `+${o}`} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the dish name, the ongoing clause, and the clock end time', () => {
    render(<MealRunningStrip steps={[STEP]} clockLabel={(offset) => `+${offset}`} />)
    const strip = screen.getByTestId('meal-running-strip')
    expect(strip).toHaveTextContent('Pasta with tomato sauce')
    expect(strip).toHaveTextContent('the sauce simmers')
    expect(strip).toHaveTextContent('until +22')
  })

  it('falls back to label when the step has no ongoing_label', () => {
    render(
      <MealRunningStrip steps={[{ ...STEP, ongoing_label: null }]} clockLabel={(o) => `+${o}`} />,
    )
    const strip = screen.getByTestId('meal-running-strip')
    expect(strip).toHaveTextContent('Simmer the sauce')
  })

  it('renders one row per running step', () => {
    const second: StreamStep = { ...STEP, key: 'recipe-2:0', dish_title: 'Green beans', column: 'side_1' }
    render(<MealRunningStrip steps={[STEP, second]} clockLabel={(o) => `+${o}`} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
