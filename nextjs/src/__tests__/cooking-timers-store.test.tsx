/**
 * Issue #495 — Spec B.3 cooking timers. Covers the acceptance criterion
 * "unit tests for ... the store (two concurrent timers, completion fires
 * once)". Uses fake timers so completion is deterministic instead of racing
 * a real setInterval, and drives the store through the same public
 * `useCookingTimers()` hook the UI uses (no reaching into private state).
 */

import React from 'react'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import {
  CookingTimersProvider,
  useCookingTimers,
  TIMER_COMPLETED_EVENT,
} from '@/lib/useCookingTimers'

// Same persisted-storage key the store itself uses (not exported — these
// tests seed/inspect it the same way a real reload would).
const STORAGE_KEY = 'bubblychef:timers:v1'

function wrapper({ children }: { children: React.ReactNode }) {
  return <CookingTimersProvider>{children}</CookingTimersProvider>
}

describe('useCookingTimers store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('starts with no timers', () => {
    const { result } = renderHook(() => useCookingTimers(), { wrapper })
    expect(result.current.timers).toEqual([])
  })

  it('runs two concurrent timers independently', () => {
    const { result } = renderHook(() => useCookingTimers(), { wrapper })

    act(() => {
      result.current.start('Simmer sauce', 100)
      result.current.start('Boil pasta', 200)
    })

    expect(result.current.timers).toHaveLength(2)
    expect(result.current.timers.map((t) => t.status)).toEqual(['running', 'running'])

    act(() => {
      jest.advanceTimersByTime(10_000)
    })

    const [a, b] = result.current.timers
    expect(a.remainingSeconds).toBe(90)
    expect(b.remainingSeconds).toBe(190)
    expect(a.status).toBe('running')
    expect(b.status).toBe('running')
  })

  it('completes a timer exactly once when its time elapses, and fires the event once', async () => {
    const { result } = renderHook(() => useCookingTimers(), { wrapper })
    const onCompleted = jest.fn()
    window.addEventListener(TIMER_COMPLETED_EVENT, onCompleted)

    let id = ''
    act(() => {
      id = result.current.start('Boil egg', 5)
    })

    act(() => {
      jest.advanceTimersByTime(5_000)
    })
    await waitFor(() => {
      expect(result.current.timers.find((t) => t.id === id)?.status).toBe('completed')
    })

    // Advancing further must not re-fire completion or change remaining time.
    act(() => {
      jest.advanceTimersByTime(20_000)
    })
    expect(result.current.timers.find((t) => t.id === id)?.remainingSeconds).toBe(0)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect((onCompleted.mock.calls[0][0] as CustomEvent).detail).toEqual({
      id,
      label: 'Boil egg',
    })

    window.removeEventListener(TIMER_COMPLETED_EVENT, onCompleted)
  })

  it('a second concurrent timer completing does not double-fire the first', async () => {
    const { result } = renderHook(() => useCookingTimers(), { wrapper })
    const onCompleted = jest.fn()
    window.addEventListener(TIMER_COMPLETED_EVENT, onCompleted)

    act(() => {
      result.current.start('Quick timer', 5)
      result.current.start('Slow timer', 10)
    })

    act(() => {
      jest.advanceTimersByTime(5_000)
    })
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))

    act(() => {
      jest.advanceTimersByTime(5_000)
    })
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(2))

    window.removeEventListener(TIMER_COMPLETED_EVENT, onCompleted)
  })

  it('pause freezes remaining time and resume continues counting down', () => {
    const { result } = renderHook(() => useCookingTimers(), { wrapper })

    let id = ''
    act(() => {
      id = result.current.start('Rest dough', 100)
    })
    act(() => {
      jest.advanceTimersByTime(20_000)
    })
    act(() => {
      result.current.pause(id)
    })
    expect(result.current.timers.find((t) => t.id === id)).toMatchObject({
      status: 'paused',
      remainingSeconds: 80,
    })

    // Time passing while paused must not change the remaining count.
    act(() => {
      jest.advanceTimersByTime(30_000)
    })
    expect(result.current.timers.find((t) => t.id === id)?.remainingSeconds).toBe(80)

    act(() => {
      result.current.resume(id)
    })
    act(() => {
      jest.advanceTimersByTime(10_000)
    })
    expect(result.current.timers.find((t) => t.id === id)).toMatchObject({
      status: 'running',
      remainingSeconds: 70,
    })
  })

  it('dismiss removes a timer entirely', () => {
    const { result } = renderHook(() => useCookingTimers(), { wrapper })

    let id = ''
    act(() => {
      id = result.current.start('Toast bread', 60)
    })
    expect(result.current.timers).toHaveLength(1)

    act(() => {
      result.current.dismiss(id)
    })
    expect(result.current.timers).toHaveLength(0)
  })

  it('persists running timers to localStorage across a remount (survives reload)', () => {
    const { result, unmount } = renderHook(() => useCookingTimers(), { wrapper })

    act(() => {
      result.current.start('Simmer sauce', 100)
    })
    act(() => {
      jest.advanceTimersByTime(10_000)
    })
    unmount()

    // Simulate the passage of time while "reloaded" (no component mounted).
    jest.advanceTimersByTime(5_000)

    const { result: result2 } = renderHook(() => useCookingTimers(), { wrapper })
    expect(result2.current.timers).toHaveLength(1)
    expect(result2.current.timers[0].label).toBe('Simmer sauce')
    // 100s duration, 15s elapsed in total (10s + 5s while "reloaded").
    expect(result2.current.timers[0].remainingSeconds).toBe(85)
  })

  // ─── PR #619 review follow-ups (issue #495) ────────────────────────────

  it('renders with no timers on the very first render pass, even when a timer is already persisted (no hydration mismatch)', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: 'timer-1',
          label: 'Simmer sauce',
          durationSeconds: 100,
          endAt: Date.now() + 100_000,
          frozenRemaining: 100,
          status: 'running',
          eventFired: false,
        },
      ]),
    )

    const renderedLengths: number[] = []
    function Probe() {
      const { timers } = useCookingTimers()
      // Recorded during the render itself (not an effect) — this captures
      // exactly what the very first render pass produced, before any
      // post-mount effect has had a chance to run. A lazy `useState`
      // initialiser that reads localStorage would make this synchronously
      // non-empty; hydrating in an effect (matching `ThemeProvider.tsx`)
      // keeps the first pass empty so server and client agree.
      renderedLengths.push(timers.length)
      return null
    }

    render(
      <CookingTimersProvider>
        <Probe />
      </CookingTimersProvider>,
    )

    expect(renderedLengths[0]).toBe(0)
  })

  it('does not re-fire timerCompleted for an already-fired timer after a reload (remount)', async () => {
    const { result, unmount } = renderHook(() => useCookingTimers(), { wrapper })
    const onCompleted = jest.fn()
    window.addEventListener(TIMER_COMPLETED_EVENT, onCompleted)

    let id = ''
    act(() => {
      id = result.current.start('Boil egg', 5)
    })
    act(() => {
      jest.advanceTimersByTime(5_000)
    })
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1))
    expect((onCompleted.mock.calls[0][0] as CustomEvent).detail).toEqual({
      id,
      label: 'Boil egg',
    })

    unmount()
    window.removeEventListener(TIMER_COMPLETED_EVENT, onCompleted)

    // Simulate a reload: the completed-but-undismissed timer is still in
    // localStorage, a fresh component tree mounts (in-memory `firedRef` is
    // gone), and a fresh listener is attached.
    const onCompletedAfterReload = jest.fn()
    window.addEventListener(TIMER_COMPLETED_EVENT, onCompletedAfterReload)
    renderHook(() => useCookingTimers(), { wrapper })

    // Let any mount/hydration effects settle.
    await act(async () => {})

    expect(onCompletedAfterReload).not.toHaveBeenCalled()
    window.removeEventListener(TIMER_COMPLETED_EVENT, onCompletedAfterReload)
  })

  it('does not show phantom extra time when a timer starts after an idle period (stale tick)', () => {
    const { result } = renderHook(() => useCookingTimers(), { wrapper })

    // No timer is running yet, so the shared interval never starts and
    // `tick` is never refreshed — it would otherwise go stale while real
    // (faked) time keeps moving during this idle stretch.
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000)
    })

    let id = ''
    act(() => {
      id = result.current.start('Boil egg', 30)
    })

    const timer = result.current.timers.find((t) => t.id === id)
    expect(timer?.remainingSeconds).toBe(30)
  })

  it('falls back to an inert no-op store when used outside the provider', () => {
    // Components that render a timer chip (recipe page, guided cook flow)
    // shouldn't force every unrelated test to also wrap in this provider —
    // see the fallback note on `useCookingTimers` itself.
    const { result } = renderHook(() => useCookingTimers())
    expect(result.current.timers).toEqual([])
    expect(() => result.current.start('x', 10)).not.toThrow()
    expect(result.current.timers).toEqual([]) // no-op — nothing persisted
  })
})
