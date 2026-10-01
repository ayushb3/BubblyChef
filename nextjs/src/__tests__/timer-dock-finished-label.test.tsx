/**
 * Issue #802 — a finished timer chip keeps its label ("Rice · done"), in the
 * collapsed row as well as the expanded stack, so two finished timers can be
 * told apart. And the dock sits clear of the bottom nav so its hard shadow
 * shows in full. jsdom can't measure layout, so the clearance is asserted on
 * the dock's inline offset; the real fit is proven by the PR's 390px verify.
 */

import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import TimerDock from '@/components/timers/TimerDock'
import { useCookingTimers, type CookingTimer } from '@/lib/useCookingTimers'

jest.mock('@/lib/useCookingTimers', () => {
  const actual = jest.requireActual('@/lib/useCookingTimers')
  return { ...actual, useCookingTimers: jest.fn() }
})

const mockedUseCookingTimers = useCookingTimers as unknown as jest.Mock

function timer(overrides: Partial<CookingTimer>): CookingTimer {
  return {
    id: 't1',
    label: 'Rice',
    durationSeconds: 300,
    remainingSeconds: 0,
    status: 'completed',
    ...overrides,
  }
}

function mockTimers(timers: CookingTimer[]) {
  mockedUseCookingTimers.mockReturnValue({
    timers,
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    dismiss: jest.fn(),
    extend: jest.fn(),
  })
}

describe('TimerDock finished chip label (issue #802)', () => {
  it('a finished chip in the collapsed dock reads "<label> · done"', () => {
    mockTimers([timer({})])
    render(<TimerDock />)
    expect(within(screen.getByTestId('timer-badge-t1')).getByText('Rice · done')).toBeInTheDocument()
  })

  it('two finished chips are told apart by their labels', () => {
    mockTimers([timer({ id: 't1', label: 'Rice' }), timer({ id: 't2', label: 'Sauce' })])
    render(<TimerDock />)
    expect(within(screen.getByTestId('timer-badge-t1')).getByText('Rice · done')).toBeInTheDocument()
    expect(within(screen.getByTestId('timer-badge-t2')).getByText('Sauce · done')).toBeInTheDocument()
    expect(screen.queryByText('Done!')).not.toBeInTheDocument()
  })

  it('a finished chip in the expanded dock shows its label once, with "done"', () => {
    mockTimers([timer({ id: 't1', label: 'Rice' }), timer({ id: 't2', label: 'Sauce' })])
    render(<TimerDock />)
    fireEvent.click(screen.getByLabelText('Expand timers'))
    expect(within(screen.getByTestId('timer-badge-t1')).getAllByText(/Rice/)).toHaveLength(1)
    expect(within(screen.getByTestId('timer-badge-t1')).getByText('Rice · done')).toBeInTheDocument()
    expect(within(screen.getByTestId('timer-badge-t2')).getByText('Sauce · done')).toBeInTheDocument()
  })

  it('a long finished label truncates instead of widening the chip without bound', () => {
    mockTimers([timer({ label: 'Simmer the tomato sauce until thick and glossy' })])
    render(<TimerDock />)
    const label = screen.getByText('Simmer the tomato sauce until thick and glossy · done')
    expect(label.className).toContain('truncate')
    expect(label.className).toMatch(/max-w-/)
  })

  it('running chips still show the countdown, not "done"', () => {
    mockTimers([timer({ status: 'running', remainingSeconds: 65, label: 'Rice' })])
    render(<TimerDock />)
    expect(screen.queryByText(/done/i)).not.toBeInTheDocument()
    expect(within(screen.getByTestId('timer-badge-t1')).getByText('1:05')).toBeInTheDocument()
  })

  it('a finished chip is still tappable to dismiss (issue #757)', () => {
    const dismiss = jest.fn()
    mockedUseCookingTimers.mockReturnValue({
      timers: [timer({})],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss,
      extend: jest.fn(),
    })
    render(<TimerDock />)
    fireEvent.click(screen.getByTestId('timer-badge-t1'))
    expect(dismiss).toHaveBeenCalledWith('t1')
  })
})

describe('TimerDock clears the bottom nav (issue #802)', () => {
  it('sits above the nav plus room for its 3px hard shadow, safe-area aware', () => {
    mockTimers([timer({})])
    render(<TimerDock />)
    const bottom = screen.getByTestId('timer-dock').style.bottom
    expect(bottom).toContain('safe-area-inset-bottom')
    const px = Number(/calc\((\d+)px/.exec(bottom)?.[1])
    // The nav is 79px tall (measured at 390px: 3px border + 8px top pad + 56px key + 12px bottom pad);
    // the dock's offset shadow adds 3px below its own edge.
    expect(px).toBeGreaterThanOrEqual(88)
  })
})
