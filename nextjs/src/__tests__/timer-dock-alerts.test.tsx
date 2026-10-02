/**
 * Issue #848 — timer sound is OPT-IN (Profile > Timer sound; the signature PRD's
 * "no sound in v1" stays the default, see `timer-dock-no-sound.test.tsx`). With
 * the toggle on, a finished timer plays a short WebAudio chime (repeated up to 3
 * times until dismissed) and shows a system Notification when permission is
 * granted. With it off, neither happens and no permission is ever requested.
 * Vibration is unchanged either way. The dock never asks for permission itself.
 */

import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CookingTimersProvider, useCookingTimers } from '@/lib/useCookingTimers'
import TimerDock from '@/components/timers/TimerDock'
import { TIMER_SOUND_KEY } from '@/lib/timer-alerts'

function soundOn() {
  window.localStorage.setItem(TIMER_SOUND_KEY, 'on')
}

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

describe('TimerDock finish feedback with Timer sound on (issue #848)', () => {
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
    soundOn()
    installNotification('denied')
    mountDock()
    await startAndFinish()

    expect(oscillatorStart).toHaveBeenCalled()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('repeats the chime up to 3 times while the timer is not dismissed, then stops', async () => {
    soundOn()
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
    soundOn()
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
    soundOn()
    installNotification('denied')
    delete win.AudioContext
    delete win.webkitAudioContext
    mountDock()
    await startAndFinish()

    expect(screen.getByTestId(/timer-badge-/)).toHaveAttribute('data-status', 'completed')
  })

  it('shows a system notification on finish when permission is granted', async () => {
    soundOn()
    const N = installNotification('granted')
    mountDock()
    await startAndFinish()

    expect(N).toHaveBeenCalledTimes(1)
    expect(N.mock.calls[0][0]).toMatch(/boil egg/i)
  })

  it('shows no notification when permission is not granted', async () => {
    soundOn()
    const N = installNotification('default')
    mountDock()
    await startAndFinish()

    expect(N).not.toHaveBeenCalled()
  })

  it('finishes cleanly where Notification is unsupported', async () => {
    soundOn()
    delete win.Notification
    mountDock()
    await startAndFinish()

    expect(screen.getByTestId(/timer-badge-/)).toHaveAttribute('data-status', 'completed')
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
  })
})

describe('TimerDock finish feedback with Timer sound off (issue #848)', () => {
  let savedAudio: unknown
  let savedNotification: unknown
  let audioCtor: jest.Mock
  let vibrate: jest.Mock

  beforeEach(() => {
    window.localStorage.clear()
    jest.useFakeTimers()
    savedAudio = win.AudioContext
    savedNotification = win.Notification
    audioCtor = jest.fn()
    win.AudioContext = audioCtor
    vibrate = jest.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
  })
  afterEach(() => {
    jest.useRealTimers()
    win.AudioContext = savedAudio
    win.Notification = savedNotification
    delete (navigator as unknown as { vibrate?: unknown }).vibrate
  })

  it('plays no chime, shows no notification and requests no permission, even when permission is granted', async () => {
    const N = installNotification('granted')
    mountDock()
    await startAndFinish()

    expect(audioCtor).not.toHaveBeenCalled()
    expect(N).not.toHaveBeenCalled()
    expect(N.requestPermission).not.toHaveBeenCalled()
  })

  it('does not ask for notification permission when a timer starts', () => {
    const N = installNotification('default')
    mountDock()
    act(() => {
      screen.getByText('start').click()
    })

    expect(N.requestPermission).not.toHaveBeenCalled()
    expect(screen.queryByTestId('timer-notify-ask')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /allow/i })).not.toBeInTheDocument()
  })

  it('still vibrates and shows the finished chip', async () => {
    installNotification('default')
    mountDock()
    await startAndFinish()

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId(/timer-badge-/)).toHaveAttribute('data-status', 'completed')
  })

  it('a stored value other than "on" counts as off', async () => {
    window.localStorage.setItem(TIMER_SOUND_KEY, 'off')
    const N = installNotification('granted')
    mountDock()
    await startAndFinish()

    expect(audioCtor).not.toHaveBeenCalled()
    expect(N).not.toHaveBeenCalled()
  })
})
