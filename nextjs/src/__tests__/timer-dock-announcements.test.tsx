/**
 * PR #619 review follow-up (issue #495) — the dock must not announce the
 * per-second countdown to screen readers. `role="status"` on a badge whose
 * label/text change every tick was firing one polite live-region
 * announcement per second per timer. Only meaningful events — a timer
 * starting, a timer finishing — should be announced, and only through a
 * dedicated visually-hidden live region, never the ticking badge itself.
 *
 * PR #620 follow-up (still issue #495) — the first cut of that live region
 * had two bugs of its own, both from the claude[bot] review on PR #620
 * (inline at TimerDock.tsx:202):
 *   1. It rendered inside the dock's `timers.length === 0` early return, so
 *      on the very first timer it was inserted into the DOM already holding
 *      its text — screen readers don't announce a live region that arrives
 *      pre-populated, only mutations to one already present and idle.
 *   2. Setting the same announcement text twice in a row (e.g. two
 *      "Prep timer started" from the quick-set's fixed labels) is a React
 *      no-op — nothing mutates, so nothing is announced the second time.
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

// The live region clears itself and re-sets the real text on the next tick
// (see TimerDock.tsx) so a repeated message still mutates the DOM. Tests
// that want the settled text advance fake time past that delay.
const ANNOUNCE_DELAY_MS = 60

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

  it('renders the live region even when the dock starts with no timers, so the first announcement is not lost on insertion', () => {
    render(
      <CookingTimersProvider>
        <StartButton />
        <TimerDock />
      </CookingTimersProvider>,
    )

    // Nothing has started yet — the dock itself renders nothing visible,
    // but the live region must already be in the DOM (idle, empty) so a
    // screen reader is already watching it before the first mutation.
    const liveRegion = screen.getByTestId('timer-live-region')
    expect(liveRegion).toBeInTheDocument()
    expect(liveRegion.textContent).toBe('')

    act(() => {
      screen.getByText('start').click()
    })
    act(() => {
      jest.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    })

    expect(liveRegion.textContent).toMatch(/boil egg.*started/i)
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
    act(() => {
      jest.advanceTimersByTime(ANNOUNCE_DELAY_MS)
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

  it('announces the same label twice as two real mutations, not a same-value no-op', () => {
    render(
      <CookingTimersProvider>
        <StartButton />
        <TimerDock />
      </CookingTimersProvider>,
    )
    const liveRegion = screen.getByTestId('timer-live-region')

    act(() => {
      screen.getByText('start').click()
    })
    act(() => {
      jest.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    })
    expect(liveRegion.textContent).toMatch(/boil egg.*started/i)

    // Starting a second timer with the exact same label immediately clears
    // the region — proof it's a real mutation cycle, not a no-op that would
    // leave the identical string sitting there unchanged.
    act(() => {
      screen.getByText('start').click()
    })
    expect(liveRegion.textContent).toBe('')

    act(() => {
      jest.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    })
    expect(liveRegion.textContent).toMatch(/boil egg.*started/i)
  })

  it('announces once when a timer finishes', async () => {
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
    // Let the store's completion effect (which dispatches
    // TIMER_COMPLETED_EVENT) and the dock's resulting announce-schedule
    // settle before advancing past the clear-then-set delay.
    await act(async () => {})
    act(() => {
      jest.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    })

    const liveRegion = screen.getByTestId('timer-live-region')
    expect(liveRegion.textContent).toMatch(/boil egg.*finished/i)
  })
})
