/**
 * Issue #653 — component tests for `TimerDock`'s "+2 min" control. `extend`
 * isn't on the real `CookingTimersContextValue` yet (frontend is adding it
 * in this same ticket, in parallel) — `useCookingTimers` is mocked here so
 * these tests can drive the button directly rather than wait on that lib
 * change; the guard itself (`extend?.(...)`, no throw with no `extend`) is
 * also covered so this survives being merged either before or after that
 * field lands.
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

describe('TimerDock +2 min', () => {
  it('calls extend(id, 120) when tapped on a running timer', () => {
    const extend = jest.fn()
    mockedUseCookingTimers.mockReturnValue({
      timers: [timer({ status: 'running' })],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss: jest.fn(),
      extend,
    })
    render(<TimerDock />)
    fireEvent.click(screen.getByLabelText('Expand timers'))
    fireEvent.click(screen.getByLabelText('Add 2 minutes to Simmer sauce timer'))
    expect(extend).toHaveBeenCalledWith('t1', 120)
  })

  it('also shows the control on a paused timer', () => {
    const extend = jest.fn()
    mockedUseCookingTimers.mockReturnValue({
      timers: [timer({ status: 'paused' })],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss: jest.fn(),
      extend,
    })
    render(<TimerDock />)
    fireEvent.click(screen.getByLabelText('Expand timers'))
    fireEvent.click(screen.getByLabelText('Add 2 minutes to Simmer sauce timer'))
    expect(extend).toHaveBeenCalledWith('t1', 120)
  })

  it('hides the control on a completed timer', () => {
    mockedUseCookingTimers.mockReturnValue({
      timers: [timer({ status: 'completed', remainingSeconds: 0 })],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss: jest.fn(),
      extend: jest.fn(),
    })
    render(<TimerDock />)
    fireEvent.click(screen.getByLabelText('Expand timers'))
    expect(screen.queryByLabelText(/Add 2 minutes/)).not.toBeInTheDocument()
  })

  it('does not throw when extend is not yet on the context', () => {
    mockedUseCookingTimers.mockReturnValue({
      timers: [timer({ status: 'running' })],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss: jest.fn(),
      // no `extend` — mirrors the real context's current (pre-#653) shape.
    })
    render(<TimerDock />)
    fireEvent.click(screen.getByLabelText('Expand timers'))
    expect(() =>
      fireEvent.click(screen.getByLabelText('Add 2 minutes to Simmer sauce timer')),
    ).not.toThrow()
  })
})
