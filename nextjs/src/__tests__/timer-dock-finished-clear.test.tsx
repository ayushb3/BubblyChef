/**
 * Issue #757 — a finished timer chip clears when tapped. (The other half of
 * the decision — clearing when the cook moves past the owning step — lives
 * with each cook flow: see guided-cook-flow.test.tsx and meal-cook-page.test.tsx.)
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import TimerDock from '@/components/timers/TimerDock'
import { useCookingTimers, type CookingTimer } from '@/lib/useCookingTimers'

jest.mock('@/lib/useCookingTimers', () => {
  const actual = jest.requireActual('@/lib/useCookingTimers')
  return { ...actual, useCookingTimers: jest.fn() }
})

const mockedUseCookingTimers = useCookingTimers as unknown as jest.Mock

function timer(overrides: Partial<CookingTimer>): CookingTimer {
  return { id: 't1', label: 'Simmer sauce', durationSeconds: 300, remainingSeconds: 200, status: 'running', ...overrides }
}

function mockTimers(timers: CookingTimer[], dismiss = jest.fn()) {
  mockedUseCookingTimers.mockReturnValue({
    timers,
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    dismiss,
    extend: jest.fn(),
  })
  return dismiss
}

describe('TimerDock finished chips (issue #757)', () => {
  it('tapping a finished chip in the collapsed dock dismisses it', () => {
    const dismiss = mockTimers([timer({ status: 'completed', remainingSeconds: 0 })])
    render(<TimerDock />)
    fireEvent.click(screen.getByTestId('timer-badge-t1'))
    expect(dismiss).toHaveBeenCalledWith('t1')
  })

  it('tapping a finished chip in the expanded dock dismisses it', () => {
    const dismiss = mockTimers([timer({ status: 'completed', remainingSeconds: 0 })])
    render(<TimerDock />)
    fireEvent.click(screen.getByLabelText('Expand timers'))
    fireEvent.click(screen.getByTestId('timer-badge-t1'))
    expect(dismiss).toHaveBeenCalledWith('t1')
  })

  it('tapping a running chip does not dismiss it', () => {
    const dismiss = mockTimers([timer({ status: 'running' })])
    render(<TimerDock />)
    fireEvent.click(screen.getByTestId('timer-badge-t1'))
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('tapping a paused chip does not dismiss it', () => {
    const dismiss = mockTimers([timer({ status: 'paused' })])
    render(<TimerDock />)
    fireEvent.click(screen.getByTestId('timer-badge-t1'))
    expect(dismiss).not.toHaveBeenCalled()
  })
})
