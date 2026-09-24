/**
 * PR #619 review follow-up (issue #495) — the dock must not announce the
 * per-second countdown to screen readers. `role="status"` on a badge whose
 * label/text change every tick was firing one polite live-region
 * announcement per second per timer. Only meaningful events — a timer
 * starting, a timer finishing — should be announced, and only through a
 * dedicated visually-hidden live region, never the ticking badge itself.
 */

import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { CookingTimersProvider, useCookingTimers } from '@/lib/useCookingTimers'
import TimerDock from '@/components/timers/TimerDock'

function StartButton() {
  const { start } = useCookingTimers()
  return (
    <button type="button" onClick={() => start('Boil egg', 5)}>
      start
    </button>
  )
}

describe('TimerDock live-region announcements', () => {
  beforeEach(() => {
    window.localStorage.clear()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('does not mark the ticking countdown badge as a live region', () => {
    render(
      <CookingTimersProvider>
        <StartButton />
        <TimerDock />
      </CookingTimersProvider>,
    )

    act(() => {
      screen.getByText('start').click()
    })

    const badge = screen.getByTestId(/timer-badge-/)
    expect(badge).not.toHaveAttribute('role', 'status')
  })

  it('announces once when a timer starts, and ticking does not touch the live region', () => {
    render(
      <CookingTimersProvider>
        <StartButton />
        <TimerDock />
      </CookingTimersProvider>,
    )

    act(() => {
      screen.getByText('start').click()
    })

    const liveRegion = screen.getByTestId('timer-live-region')
    expect(liveRegion.textContent).toMatch(/boil egg.*started/i)

    const afterStartText = liveRegion.textContent
    act(() => {
      jest.advanceTimersByTime(3_000)
    })

    // Three ticks have passed — the countdown badge text changed, but the
    // live region must not have been touched by that.
    expect(liveRegion.textContent).toBe(afterStartText)
  })

  it('announces once when a timer finishes', () => {
    render(
      <CookingTimersProvider>
        <StartButton />
        <TimerDock />
      </CookingTimersProvider>,
    )

    act(() => {
      screen.getByText('start').click()
    })
    act(() => {
      jest.advanceTimersByTime(5_000)
    })

    const liveRegion = screen.getByTestId('timer-live-region')
    expect(liveRegion.textContent).toMatch(/boil egg.*finished/i)
  })
})
