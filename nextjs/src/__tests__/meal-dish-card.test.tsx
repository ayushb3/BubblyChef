/**
 * Issue #652 — component tests for `MealDishCard`: the role label, the
 * already-scaled ingredient quantities (formatted, not re-scaled), and the
 * "times are estimates" note.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import MealDishCard from '@/components/meal/MealDishCard'
import type { Step } from '@/types/recipes'

const STEPS: Step[] = [
  {
    text: 'Boil the pasta',
    label: 'Boil pasta',
    ongoing_label: 'the pasta boils',
    duration_minutes: 10,
    duration_estimated: false,
    hands_on: false,
    depends_on: [],
    exclusive: [],
  },
  {
    text: 'Toss with sauce',
    label: 'Toss',
    ongoing_label: null,
    duration_minutes: 3,
    duration_estimated: false,
    hands_on: true,
    depends_on: [0],
    exclusive: [],
  },
]

describe('MealDishCard', () => {
  it('shows the role label', () => {
    render(
      <MealDishCard
        role="main"
        title="Pasta with tomato sauce"
        ingredients={[]}
        instructions={[]}
      />,
    )
    expect(screen.getByTestId('meal-dish-role')).toHaveTextContent('Main')
  })

  it('shows the side role label', () => {
    render(<MealDishCard role="side" title="Green salad" ingredients={[]} instructions={[]} />)
    expect(screen.getByTestId('meal-dish-role')).toHaveTextContent('Side')
  })

  it('formats already-scaled ingredient quantities without re-scaling them', () => {
    render(
      <MealDishCard
        role="main"
        title="Pasta with tomato sauce"
        ingredients={[
          { name: 'pasta', quantity: 400, unit: 'g' },
          { name: 'garlic', quantity: 3, unit: 'cloves', preparation: 'minced' },
        ]}
        instructions={[]}
      />,
    )
    expect(screen.getByText('400 g pasta')).toBeInTheDocument()
    expect(screen.getByText('3 cloves garlic')).toBeInTheDocument()
  })

  it('renders instructions in order, tagging each with its structured duration and hands-on marker', () => {
    render(
      <MealDishCard
        role="main"
        title="Pasta with tomato sauce"
        ingredients={[]}
        instructions={['Boil the pasta', 'Toss with sauce']}
        steps={STEPS}
      />,
    )
    const meta = screen.getAllByTestId('meal-dish-step-meta')
    expect(meta).toHaveLength(2)
    expect(meta[0]).toHaveTextContent('⏳')
    expect(meta[0]).toHaveTextContent('10 min')
    expect(meta[1]).toHaveTextContent('✋')
    expect(meta[1]).toHaveTextContent('3 min')
    expect(screen.getByText(/Boil the pasta/)).toBeInTheDocument()
    expect(screen.getByText(/Toss with sauce/)).toBeInTheDocument()
  })

  it('renders instructions without duration chips when steps is absent', () => {
    render(
      <MealDishCard
        role="main"
        title="Pasta with tomato sauce"
        ingredients={[]}
        instructions={['Boil the pasta']}
      />,
    )
    expect(screen.queryByTestId('meal-dish-step-meta')).not.toBeInTheDocument()
    expect(screen.getByText('Boil the pasta')).toBeInTheDocument()
  })

  it('shows the estimates note only when stepsEstimated is true', () => {
    const { rerender } = render(
      <MealDishCard role="main" title="Pasta" ingredients={[]} instructions={['Boil the pasta']} />,
    )
    expect(screen.queryByTestId('meal-dish-steps-estimated')).not.toBeInTheDocument()

    rerender(
      <MealDishCard
        role="main"
        title="Pasta"
        ingredients={[]}
        instructions={['Boil the pasta']}
        stepsEstimated
      />,
    )
    expect(screen.getByTestId('meal-dish-steps-estimated')).toHaveTextContent(
      'Times for this dish are estimates.',
    )
  })

  it('renders the actions slot', () => {
    render(
      <MealDishCard
        role="side"
        title="Green salad"
        ingredients={[]}
        instructions={[]}
        actions={<button>Swap</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Swap' })).toBeInTheDocument()
  })
})
