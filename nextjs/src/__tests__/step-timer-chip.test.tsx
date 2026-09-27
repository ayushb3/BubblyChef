/**
 * Issue #495 — Spec B.3 cooking timers. Component-level acceptance
 * criterion: "component test that the chip renders only for parseable
 * steps." Also covers that tapping a chip starts a timer named after the
 * step, which is the behaviour the recipe-page and guided-cook-flow chips
 * both depend on.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import StepTimerChips from '@/components/timers/StepTimerChip'
import { CookingTimersProvider, useCookingTimers } from '@/lib/useCookingTimers'

function TimerList() {
  const { timers } = useCookingTimers()
  return (
    <ul>
      {timers.map((t) => (
        <li key={t.id}>{t.label}</li>
      ))}
    </ul>
  )
}

function renderWithProvider(ui: React.ReactNode) {
  return render(<CookingTimersProvider>{ui}</CookingTimersProvider>)
}

describe('StepTimerChips', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders a chip for a step with a parseable duration', () => {
    renderWithProvider(<StepTimerChips stepText="Simmer sauce for 15 minutes." />)
    expect(screen.getByTestId('step-timer-chip')).toBeInTheDocument()
    expect(screen.getByText(/15 min/)).toBeInTheDocument()
  })

  it('renders nothing for a step with no parseable duration', () => {
    const { container } = renderWithProvider(
      <StepTimerChips stepText="Season with salt and pepper to taste." />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one chip per duration when a step mentions more than one', () => {
    renderWithProvider(
      <StepTimerChips stepText="Simmer for 10 minutes, then rest for 5 minutes." />,
    )
    expect(screen.getAllByTestId('step-timer-chip')).toHaveLength(2)
  })

  it('tapping the chip starts a timer named after the step', () => {
    renderWithProvider(
      <>
        <StepTimerChips stepText="Simmer sauce, stirring occasionally for 15 minutes." />
        <TimerList />
      </>,
    )
    fireEvent.click(screen.getByTestId('step-timer-chip'))
    expect(screen.getByText(/Simmer sauce/)).toBeInTheDocument()
  })

  it('a range chip carries the "low end of" note into the started timer, not just the chip', () => {
    renderWithProvider(
      <>
        <StepTimerChips stepText="Marinate for 1-2 hours in the fridge." />
        <TimerList />
      </>,
    )
    fireEvent.click(screen.getByTestId('step-timer-chip'))
    const timerListItems = screen.getAllByText(/of 1–2 hr/)
    // Both the chip's own label and the started timer's name carry the note.
    expect(timerListItems.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('listitem')).toHaveTextContent('of 1–2 hr')
  })
})
