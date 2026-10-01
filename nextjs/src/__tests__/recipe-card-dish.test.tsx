/**
 * Issue #652 / #744 — component tests for the `dish` variant of the one recipe
 * card (formerly `MealDishCard`): the role tag and its pastel, the already-scaled
 * ingredient quantities (formatted, not re-scaled), the "times are estimates"
 * note, the collapsed side, and the "N to buy" line.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import RecipeCard, { type DishCardProps } from '@/components/recipes/RecipeCard'
import type { Step } from '@/types/recipes'

function MealDishCard(props: DishCardProps) {
  return <RecipeCard variant="dish" {...props} />
}

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

  it('offers Open recipe to the dish recipe page when href is given, and not otherwise', () => {
    // Was: the title linked to the recipe page. The board has a plain title and an
    // Open recipe key, and two links to one page is a worse screen-reader list.
    const { rerender } = render(
      <MealDishCard role="side" title="Green salad" ingredients={[]} instructions={[]} href="/recipes/r2" />,
    )
    expect(screen.getByRole('link', { name: 'Open recipe' })).toHaveAttribute('href', '/recipes/r2')
    rerender(<MealDishCard role="side" title="Green salad" ingredients={[]} instructions={[]} />)
    expect(screen.queryByRole('link', { name: 'Open recipe' })).not.toBeInTheDocument()
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
    // Was one "400 g pasta" string; quantity and name are separate columns, as on the board.
    expect(screen.getByText('400 g')).toBeInTheDocument()
    expect(screen.getByText('pasta')).toBeInTheDocument()
    expect(screen.getByText('3 cloves')).toBeInTheDocument()
    expect(screen.getByText(/garlic/)).toBeInTheDocument()
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

  describe('pastel and minutes (issue #744)', () => {
    const bandOf = () => screen.getByTestId('meal-dish-band')

    it('colours the header band with the dish pastel: main pink, side 1 mint, side 2 peach', () => {
      const { rerender } = render(
        <MealDishCard role="main" position={0} title="Pasta" ingredients={[]} instructions={[]} />,
      )
      expect(bandOf()).toHaveStyle({ background: 'var(--color-dish-main)' })
      rerender(<MealDishCard role="side" position={1} title="Salad" ingredients={[]} instructions={[]} />)
      expect(bandOf()).toHaveStyle({ background: 'var(--color-dish-side-1)' })
      rerender(<MealDishCard role="side" position={2} title="Beans" ingredients={[]} instructions={[]} />)
      expect(bandOf()).toHaveStyle({ background: 'var(--color-dish-side-2)' })
    })

    it('shows the minutes in the band, and nothing when they are unknown', () => {
      const { rerender } = render(
        <MealDishCard role="main" title="Pasta" minutes={22} ingredients={[]} instructions={[]} />,
      )
      expect(bandOf()).toHaveTextContent('22 min')
      rerender(<MealDishCard role="main" title="Pasta" minutes={null} ingredients={[]} instructions={[]} />)
      expect(bandOf()).not.toHaveTextContent('min')
    })
  })

  describe('expanded main, collapsed side (issue #744)', () => {
    const INGREDIENTS = ['pasta', 'garlic', 'butter', 'lemon', 'parsley', 'salt'].map((name) => ({ name }))

    it('starts a main expanded: every ingredient row and the method are visible', () => {
      render(
        <MealDishCard role="main" title="Pasta" ingredients={INGREDIENTS} instructions={['Boil the pasta']} />,
      )
      expect(screen.getByText('parsley')).toBeInTheDocument()
      expect(screen.getByText('Boil the pasta')).toBeInTheDocument()
      expect(screen.queryByTestId('meal-dish-key-ingredients')).not.toBeInTheDocument()
    })

    it('starts a side collapsed to a key-ingredients line, and Show details expands it', () => {
      render(
        <MealDishCard role="side" position={1} title="Salad" ingredients={INGREDIENTS} instructions={['Toss it']} />,
      )
      expect(screen.getByTestId('meal-dish-key-ingredients')).toHaveTextContent('pasta, garlic, butter, lemon +2')
      expect(screen.queryByText('Toss it')).not.toBeInTheDocument()

      const toggle = screen.getByRole('button', { name: 'Show details for Salad' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(toggle)
      expect(screen.getByText('Toss it')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Hide details for Salad' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })
  })

  describe('the "N to buy" line (issue #744)', () => {
    it('lists what is missing and adds it to the grocery list, then confirms with the count', async () => {
      const onAddToGrocery = jest.fn().mockResolvedValue(undefined)
      render(
        <MealDishCard
          role="main"
          title="Pasta"
          ingredients={[]}
          instructions={[]}
          toBuy={['parsley', 'lemon']}
          onAddToGrocery={onAddToGrocery}
        />,
      )
      expect(screen.getByText('2 to buy:')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Add to grocery list' }))
      expect(onAddToGrocery).toHaveBeenCalledWith(['parsley', 'lemon'])
      expect(await screen.findByRole('status')).toHaveTextContent('2 on your grocery list')
      expect(screen.queryByRole('button', { name: 'Add to grocery list' })).not.toBeInTheDocument()
    })

    it('says nothing is missing instead of showing 0', () => {
      render(<MealDishCard role="side" title="Orzo" ingredients={[]} instructions={[]} toBuy={[]} />)
      expect(screen.getByText(/Nothing to buy/)).toBeInTheDocument()
      expect(screen.queryByText(/0 to buy/)).not.toBeInTheDocument()
    })

    it('hides the line when what is missing is not known, rather than claiming nothing is', () => {
      render(<MealDishCard role="main" title="Pasta" ingredients={[]} instructions={[]} />)
      expect(screen.queryByText(/to buy/i)).not.toBeInTheDocument()
    })

    it('keeps the key and says so when adding fails, so the user can try again', async () => {
      const onAddToGrocery = jest.fn().mockRejectedValue(new Error('nope'))
      render(
        <MealDishCard
          role="main"
          title="Pasta"
          ingredients={[]}
          instructions={[]}
          toBuy={['parsley']}
          onAddToGrocery={onAddToGrocery}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Add to grocery list' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn.t add/)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Add to grocery list' })).toBeEnabled())
    })
  })

  it('shows the expiring badge only when the dish uses expiring food', () => {
    const { rerender } = render(
      <MealDishCard role="side" title="Salad" ingredients={[]} instructions={[]} expiring={['romaine']} />,
    )
    expect(screen.getByText(/Uses your romaine/)).toBeInTheDocument()
    rerender(<MealDishCard role="side" title="Salad" ingredients={[]} instructions={[]} />)
    expect(screen.queryByText(/Uses your/)).not.toBeInTheDocument()
  })
})
