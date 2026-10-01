/**
 * Issue #848 — a finished timer is heard, not just seen: a short WebAudio chime
 * (repeated up to 3 times until dismissed), vibration where supported, and a
 * system Notification when permission is already granted. Notification
 * permission is asked for once, the first time a timer starts, and never again
 * after that. (Replaces the issue #783 "no sound" test: iOS Safari has no
 * vibration, so a finished timer was otherwise silent.)
 */

import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

function mountDock() {
  return render(
    <CookingTimersProvider>
      <StartButton />
      <TimerDock />
    </CookingTimersProvider>,
  )
}

async function startAndFinish() {
  act(() => {
    screen.getByText('start').click()
  })
  act(() => {
    jest.advanceTimersByTime(5_000)
  })
  await act(async () => {})
  act(() => {
    jest.advanceTimersByTime(60)
  })
}

const win = window as unknown as Record<string, unknown>

type FakeNotification = jest.Mock & { permission: string; requestPermission: jest.Mock }

function installNotification(permission: NotificationPermission): FakeNotification {
  const ctor = jest.fn() as FakeNotification
  ctor.permission = permission
  ctor.requestPermission = jest.fn().mockResolvedValue('granted')
  win.Notification = ctor
  return ctor
}

describe('TimerDock finish feedback (issue #848)', () => {
  let savedAudio: unknown
  let savedWebkitAudio: unknown
  let savedNotification: unknown
  let oscillatorStart: jest.Mock
  let vibrate: jest.Mock

  beforeEach(() => {
    window.localStorage.clear()
    jest.useFakeTimers()
    savedAudio = win.AudioContext
    savedWebkitAudio = win.webkitAudioContext
    savedNotification = win.Notification
    oscillatorStart = jest.fn()
    win.AudioContext = jest.fn().mockImplementation(() => ({
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: jest.fn().mockResolvedValue(undefined),
      createOscillator: () => ({
        type: 'sine',
        frequency: { setValueAtTime: jest.fn(), value: 0 },
        connect: jest.fn(),
        start: oscillatorStart,
        stop: jest.fn(),
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: jest.fn(),
          linearRampToValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
          value: 0,
        },
        connect: jest.fn(),
      }),
    }))
    vibrate = jest.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
  })

  afterEach(() => {
    jest.useRealTimers()
    win.AudioContext = savedAudio
    win.webkitAudioContext = savedWebkitAudio
    win.Notification = savedNotification
    delete (navigator as unknown as { vibrate?: unknown }).vibrate
  })

  it('plays a chime and vibrates when a timer finishes', async () => {
    installNotification('denied')
    mountDock()
    await startAndFinish()

    expect(oscillatorStart).toHaveBeenCalled()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('repeats the chime up to 3 times while the timer is not dismissed, then stops', async () => {
    installNotification('denied')
    mountDock()
    await startAndFinish()
    const perChime = oscillatorStart.mock.calls.length
    expect(perChime).toBeGreaterThan(0)

    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(oscillatorStart.mock.calls.length).toBe(perChime * 3)
  })

  it('stops chiming as soon as the finished timer is dismissed', async () => {
    installNotification('denied')
    mountDock()
    await startAndFinish()
    const afterFirst = oscillatorStart.mock.calls.length

    fireEvent.click(screen.getByTestId(/timer-badge-/))
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(oscillatorStart.mock.calls.length).toBe(afterFirst)
  })

  it('still finishes cleanly where WebAudio is unsupported', async () => {
    installNotification('denied')
    delete win.AudioContext
    delete win.webkitAudioContext
    mountDock()
    await startAndFinish()

    expect(screen.getByTestId(/timer-badge-/)).toHaveAttribute('data-status', 'completed')
  })

  it('shows a system notification on finish when permission is already granted', async () => {
    const N = installNotification('granted')
    mountDock()
    await startAndFinish()

    expect(N).toHaveBeenCalledTimes(1)
    expect(N.mock.calls[0][0]).toMatch(/boil egg/i)
  })

  it('shows no notification when permission is not granted', async () => {
    const N = installNotification('default')
    mountDock()
    await startAndFinish()

    expect(N).not.toHaveBeenCalled()
  })

  it('finishes cleanly where Notification is unsupported', async () => {
    delete win.Notification
    mountDock()
    await startAndFinish()

    expect(screen.getByTestId(/timer-badge-/)).toHaveAttribute('data-status', 'completed')
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
  })
})

describe('notification permission ask (issue #848)', () => {
  let savedNotification: unknown

  beforeEach(() => {
    window.localStorage.clear()
    savedNotification = win.Notification
  })
  afterEach(() => {
    win.Notification = savedNotification
  })

  it('asks once, with a one-line reason, the first time a timer starts', () => {
    const N = installNotification('default')
    mountDock()
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()

    act(() => {
      screen.getByText('start').click()
    })
    expect(screen.getByTestId('timer-notify-ask')).toHaveTextContent(/finish/i)
    expect(N.requestPermission).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /allow/i }))
    expect(N.requestPermission).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
  })

  it('never asks again after a decline, on a later timer or a fresh load', () => {
    installNotification('default')
    const first = mountDock()
    act(() => {
      screen.getByText('start').click()
    })
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()

    act(() => {
      screen.getByText('start').click()
    })
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()

    first.unmount()
    mountDock()
    act(() => {
      screen.getByText('start').click()
    })
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
  })

  it('does not ask again after an ignored ask either (asked means asked once)', () => {
    installNotification('default')
    const first = mountDock()
    act(() => {
      screen.getByText('start').click()
    })
    expect(screen.getByTestId('timer-notify-ask')).toBeInTheDocument()
    first.unmount()

    mountDock()
    act(() => {
      screen.getByText('start').click()
    })
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
  })

  it('does not ask once the browser has already decided (denied or granted)', () => {
    installNotification('denied')
    const a = mountDock()
    act(() => {
      screen.getByText('start').click()
    })
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
    a.unmount()

    window.localStorage.clear()
    installNotification('granted')
    mountDock()
    act(() => {
      screen.getByText('start').click()
    })
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
  })
})
