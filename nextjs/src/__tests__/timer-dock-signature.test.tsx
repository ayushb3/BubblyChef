/**
 * Issue #745 — the timer dock in the timeline's language: a paused timer is
 * hatched (dashed, "just waiting"), a running one is solid, a finished one is
 * solid primary with ink text (never white on a pastel), and the expanded
 * controls are keycaps that keep their 44px hit area. Behaviour is pinned by
 * the other timer-dock suites (PR #765's clear-on-tap stays green there).
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

describe('TimerDock signature look (issue #745)', () => {
  it('draws a paused timer hatched and dashed, a running one solid', () => {
    mockTimers([timer({ id: 'p', status: 'paused' }), timer({ id: 'r', status: 'running' })])
    render(<TimerDock />)
    expect(screen.getByTestId('timer-badge-p').className).toContain('border-dashed')
    expect(screen.getByTestId('timer-badge-r').className).toContain('border-solid')
    expect(screen.getByTestId('timer-badge-r').className).not.toContain('border-dashed')
  })

  it('draws a finished timer solid primary with ink text, no white-on-pastel', () => {
    mockTimers([timer({ status: 'completed', remainingSeconds: 0 })])
    render(<TimerDock />)
    const badge = screen.getByTestId('timer-badge-t1')
    expect(badge.className).toContain('bg-[var(--color-primary)]')
    expect(badge.className).toContain('text-[color:var(--color-text)]')
    expect(badge.innerHTML).not.toMatch(/#fff|text-white|color: ?white/i)
  })

  it('expanded controls are 44px keycap faces and still call their handlers', () => {
    const extend = jest.fn()
    mockedUseCookingTimers.mockReturnValue({
      timers: [timer({})],
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      dismiss: jest.fn(),
      extend,
    })
    render(<TimerDock />)
    fireEvent.click(screen.getByLabelText('Expand timers'))
    const plus = screen.getByTestId('timer-extend-t1')
    expect(plus.className).toContain('min-h-[44px]')
    expect(plus.className).toContain('min-w-[44px]')
    fireEvent.click(plus)
    expect(extend).toHaveBeenCalledWith('t1', 120)
  })
})
