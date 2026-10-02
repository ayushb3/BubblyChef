/**
 * Issue #653 — component tests for `MealNowCard`: the active hands-on and
 * hands-off pill sets, the upcoming preview (with and without `waiting_on`),
 * `finished` rendering nothing, and the disabled state.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MealNowCard, { type NowCard } from '@/components/meal/MealNowCard'
import type { StreamStep } from '@/lib/meal-cook-stream'

const HANDS_ON_STEP: StreamStep = {
  key: 'recipe-1:0',
  dish_id: 'recipe-1',
  column: 'main',
  dish_title: 'Pasta with tomato sauce',
  step_index: 0,
  label: 'Boil the pasta',
  ongoing_label: null,
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

  describe('with waiting_on (issue #890: never a hard lock)', () => {
    const waitingCard: NowCard = {
      kind: 'upcoming',
      step: HANDS_ON_STEP,
      starts_in_minutes: 6,
      waiting_on: HANDS_OFF_STEP,
    }

    it('explains the wait, offers Start now, and says the running step keeps going', () => {
      const onStartEarly = jest.fn()
      const onSkip = jest.fn()
      render(
        <MealNowCard
          card={waitingCard}
          clockLabel={clockLabel}
          onDone={jest.fn()}
          onExtend={jest.fn()}
          onSkip={onSkip}
          onStartEarly={onStartEarly}
        />,
      )
      expect(screen.getByTestId('meal-now-card-upcoming-timing')).toHaveTextContent('Next at +0 (in 6 min)')
      expect(screen.getByTestId('meal-now-card-waiting-on')).toHaveTextContent(
        'Waiting on Simmer the sauce (timer). You can start now.',
      )
      expect(screen.getByTestId('meal-now-card-keeps-running')).toHaveTextContent('Simmer the sauce keeps running.')

      fireEvent.click(screen.getByRole('button', { name: 'Start now' }))
      expect(onStartEarly).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
      expect(onSkip).toHaveBeenCalledTimes(1)
    })

    it('offers "<step> done early" for the running timer when the page wires it, and fires it with that step', () => {
      const onFinishRunning = jest.fn()
      render(
        <MealNowCard
          card={waitingCard}
          clockLabel={clockLabel}
          onDone={jest.fn()}
          onExtend={jest.fn()}
          onSkip={jest.fn()}
          onStartEarly={jest.fn()}
          onFinishRunning={onFinishRunning}
        />,
      )
      const key = screen.getByRole('button', { name: 'Simmer the sauce done early' })
      // The visible text names the step too, so the aria-label matches it.
      expect(key).toHaveTextContent('Simmer the sauce done early')
      fireEvent.click(key)
      expect(onFinishRunning).toHaveBeenCalledWith(HANDS_OFF_STEP)
    })

    it('omits the done-early key when no handler is wired', () => {
      render(
        <MealNowCard
          card={waitingCard}
          clockLabel={clockLabel}
          onDone={jest.fn()}
          onExtend={jest.fn()}
          onSkip={jest.fn()}
          onStartEarly={jest.fn()}
        />,
      )
      expect(screen.queryByRole('button', { name: /done early/i })).not.toBeInTheDocument()
    })
  })

  it('without waiting_on: Start now fires onStartEarly and Skip fires onSkip', () => {
    const onStartEarly = jest.fn()
    const onSkip = jest.fn()
    const card: NowCard = { kind: 'upcoming', step: HANDS_OFF_STEP, starts_in_minutes: 6 }
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
    expect(screen.queryByTestId('meal-now-card-keeps-running')).not.toBeInTheDocument()
  })

  it('waiting card: one "<step> done early" key per running step, soonest end first, each firing with its step (issue #890)', () => {
    const later: StreamStep = { ...HANDS_OFF_STEP, key: 'recipe-2:0', label: 'Roast the beans', end: 30 }
    const sooner: StreamStep = { ...HANDS_OFF_STEP, end: 18 }
    const onFinishRunning = jest.fn()
    render(
      <MealNowCard
        card={{ kind: 'waiting', running: [later, sooner] }}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
        onFinishRunning={onFinishRunning}
      />,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Simmer the sauce done early',
      'Roast the beans done early',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Roast the beans done early' }))
    expect(onFinishRunning).toHaveBeenCalledWith(later)
  })

  it('shows "Nothing to do right now" and the running steps, soonest end first, with no action pills', () => {
    const laterRunning: StreamStep = { ...HANDS_OFF_STEP, key: 'recipe-2:0', dish_title: 'Green beans', column: 'side_1', end: 30 }
    const soonerRunning: StreamStep = { ...HANDS_OFF_STEP, ongoing_label: 'the sauce simmers', end: 18 }
    const card: NowCard = { kind: 'waiting', running: [laterRunning, soonerRunning] }
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
    expect(screen.getByTestId('meal-now-card-waiting-copy')).toHaveTextContent('Nothing to do right now.')

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // Sooner-ending step (the sauce, ends +18) listed before the later one (+30).
    expect(rows[0]).toHaveTextContent('the sauce simmers')
    expect(rows[0]).toHaveTextContent('until +18')
    expect(rows[1]).toHaveTextContent('Green beans')
    expect(rows[1]).toHaveTextContent('until +30')

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('is a stable aria-live="polite" region across every card kind, so a screen reader hears each change', () => {
    const { rerender } = render(
      <MealNowCard
        card={{ kind: 'upcoming', step: HANDS_OFF_STEP, starts_in_minutes: 6 }}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    const region = screen.getByTestId('meal-now-card')
    expect(region).toHaveAttribute('aria-live', 'polite')

    rerender(
      <MealNowCard
        card={{ kind: 'active', step: HANDS_ON_STEP }}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    // Same DOM node — the live region never unmounted, so the mutation the
    // screen reader needs to see actually happened on an already-watched node.
    expect(screen.getByTestId('meal-now-card')).toBe(region)

    rerender(
      <MealNowCard
        card={{ kind: 'waiting', running: [HANDS_OFF_STEP] }}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    expect(screen.getByTestId('meal-now-card')).toBe(region)
    expect(screen.getByTestId('meal-now-card-waiting-copy')).toBeInTheDocument()
  })

  // ─── Ask Bubbles pill (issue #654 PR B) ────────────────────────────────────

  it('shows the Ask Bubbles pill on an active card when onAskBubbles is provided', () => {
    const onAskBubbles = jest.fn()
    const card: NowCard = { kind: 'active', step: HANDS_ON_STEP }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
        onAskBubbles={onAskBubbles}
      />,
    )
    const pill = screen.getByTestId('meal-now-card-ask-bubbles')
    expect(pill).toBeInTheDocument()
    fireEvent.click(pill)
    expect(onAskBubbles).toHaveBeenCalledTimes(1)
  })

  it('shows the Ask Bubbles pill on an upcoming card when onAskBubbles is provided', () => {
    const onAskBubbles = jest.fn()
    const card: NowCard = { kind: 'upcoming', step: HANDS_OFF_STEP, starts_in_minutes: 6 }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
        onAskBubbles={onAskBubbles}
      />,
    )
    expect(screen.getByTestId('meal-now-card-ask-bubbles')).toBeInTheDocument()
  })

  it('omits the Ask Bubbles pill on a waiting card even when onAskBubbles is provided', () => {
    const card: NowCard = { kind: 'waiting', running: [HANDS_OFF_STEP] }
    render(
      <MealNowCard
        card={card}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
        onAskBubbles={jest.fn()}
      />,
    )
    expect(screen.queryByTestId('meal-now-card-ask-bubbles')).not.toBeInTheDocument()
  })

  it('omits the Ask Bubbles pill on active/upcoming cards when onAskBubbles is not provided', () => {
    const activeCard: NowCard = { kind: 'active', step: HANDS_ON_STEP }
    const { rerender } = render(
      <MealNowCard
        card={activeCard}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    expect(screen.queryByTestId('meal-now-card-ask-bubbles')).not.toBeInTheDocument()

    const upcomingCard: NowCard = { kind: 'upcoming', step: HANDS_OFF_STEP, starts_in_minutes: 6 }
    rerender(
      <MealNowCard
        card={upcomingCard}
        clockLabel={clockLabel}
        onDone={jest.fn()}
        onExtend={jest.fn()}
        onSkip={jest.fn()}
        onStartEarly={jest.fn()}
      />,
    )
    expect(screen.queryByTestId('meal-now-card-ask-bubbles')).not.toBeInTheDocument()
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
