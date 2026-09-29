/**
 * Issue #653 — component tests for `MealNowCard`: the active hands-on and
 * hands-off pill sets, the upcoming preview (with and without `waiting_on`),
 * `finished` rendering nothing, and the disabled state.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MealNowCard from '@/components/meal/MealNowCard'
import type { NowCard, StreamStep } from '@/components/meal/streamTypes'

const HANDS_ON_STEP: StreamStep = {
  key: 'recipe-1:0',
  dish_id: 'recipe-1',
  column: 'main',
  dish_title: 'Pasta with tomato sauce',
  step_index: 0,
  label: 'Boil the pasta',
  text: 'Bring a large pot of salted water to a boil, add the pasta.',
  duration_minutes: 10,
  hands_on: true,
  start: 0,
  end: 10,
}

const HANDS_OFF_STEP: StreamStep = {
  ...HANDS_ON_STEP,
  key: 'recipe-1:1',
  step_index: 1,
  label: 'Simmer the sauce',
  hands_on: false,
  start: 10,
  end: 22,
}

const clockLabel = (offset: number) => `+${offset}`

describe('MealNowCard', () => {
  it('renders nothing for a finished card', () => {
    const { container } = render(
      <MealNowCard
        card={{ kind: 'finished' }}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the dish name, the Hands-on badge, and Done/+2 min/Skip for an active hands-on step', () => {
    const onDone = jest.fn()
    const onExtend = jest.fn()
    const onSkip = jest.fn()
    const card: NowCard = { kind: 'active', step: HANDS_ON_STEP }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={onDone}
        onExtend={onExtend}
        onSkip={onSkip}
        onStartEarly={jest.fn()}
      />,
    )
    expect(screen.getByText('Pasta with tomato sauce')).toBeInTheDocument()
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-on')
    expect(screen.getByText('Boil the pasta')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 minutes' }))
    expect(onExtend).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSkip).toHaveBeenCalledTimes(1)

    expect(screen.queryByRole('button', { name: 'Start timer' })).not.toBeInTheDocument()
  })

  it('shows the Hands-off badge and Start timer/Skip for an active hands-off step, Start timer calling onDone', () => {
    const onDone = jest.fn()
    const card: NowCard = { kind: 'active', step: HANDS_OFF_STEP }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={onDone}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    expect(screen.getByTestId('meal-now-card-badge')).toHaveTextContent('Hands-off')
    expect(screen.queryByRole('button', { name: 'Add 2 minutes' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the upcoming preview with timing, waiting_on, and Start now/Skip', () => {
    const onStartEarly = jest.fn()
    const onSkip = jest.fn()
    const card: NowCard = {
      kind: 'upcoming',
      step: HANDS_OFF_STEP,
      starts_in_minutes: 6,
      waiting_on: HANDS_ON_STEP,
    }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={onSkip}
        onStartEarly={onStartEarly}
      />,
    )
    expect(screen.getByTestId('meal-now-card-upcoming-timing')).toHaveTextContent('Next at +10 (in 6 min)')
    expect(screen.getByTestId('meal-now-card-waiting-on')).toHaveTextContent('after Boil the pasta')

    fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(onStartEarly).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('omits the waiting_on line when there is none', () => {
    const card: NowCard = { kind: 'upcoming', step: HANDS_OFF_STEP, starts_in_minutes: 6 }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    expect(screen.queryByTestId('meal-now-card-waiting-on')).not.toBeInTheDocument()
  })

  it('disables every pill when disabled', () => {
    const card: NowCard = { kind: 'active', step: HANDS_ON_STEP }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
        disabled
      />,
    )
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add 2 minutes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled()
  })
})
