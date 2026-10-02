/**
 * Issue #848 — the "Timer sound" toggle in Profile. Off by default; turning it on
 * stores the preference, unlocks audio and asks for notification permission (the
 * only place that is asked); turning it off stores off and asks for nothing.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import TimerSoundToggle from '@/components/profile/TimerSoundToggle'
import { isTimerSoundEnabled, TIMER_SOUND_KEY } from '@/lib/timer-alerts'

const win = window as unknown as Record<string, unknown>
type FakeNotification = jest.Mock & { permission: string; requestPermission: jest.Mock }

function installNotification(permission: NotificationPermission): FakeNotification {
  const ctor = jest.fn() as FakeNotification
  ctor.permission = permission
  ctor.requestPermission = jest.fn().mockResolvedValue('granted')
  win.Notification = ctor
  return ctor
}

describe('TimerSoundToggle (issue #848)', () => {
  let savedNotification: unknown
  let savedAudio: unknown

  beforeEach(() => {
    window.localStorage.clear()
    savedNotification = win.Notification
    savedAudio = win.AudioContext
  })
  afterEach(() => {
    win.Notification = savedNotification
    win.AudioContext = savedAudio
  })

  const toggle = () => screen.getByRole('switch', { name: /timer sound/i })

  it('is off by default', () => {
    installNotification('default')
    render(<TimerSoundToggle />)
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(isTimerSoundEnabled()).toBe(false)
  })

  it('reflects a saved preference on load', async () => {
    window.localStorage.setItem(TIMER_SOUND_KEY, 'on')
    render(<TimerSoundToggle />)
    expect(await screen.findByRole('switch', { checked: true })).toBeInTheDocument()
  })

  it('turning it on saves the preference and asks for notification permission once', () => {
    const N = installNotification('default')
    const audioCtor = jest.fn().mockImplementation(() => ({ state: 'running', resume: jest.fn() }))
    win.AudioContext = audioCtor
    render(<TimerSoundToggle />)

    fireEvent.click(toggle())

    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(isTimerSoundEnabled()).toBe(true)
    expect(N.requestPermission).toHaveBeenCalledTimes(1)
    expect(audioCtor).toHaveBeenCalled()
  })

  it('does not re-ask once the browser has already decided', () => {
    const N = installNotification('denied')
    render(<TimerSoundToggle />)

    fireEvent.click(toggle())

    expect(isTimerSoundEnabled()).toBe(true)
    expect(N.requestPermission).not.toHaveBeenCalled()
  })

  it('turning it off saves off and requests nothing', async () => {
    window.localStorage.setItem(TIMER_SOUND_KEY, 'on')
    const N = installNotification('default')
    render(<TimerSoundToggle />)

    fireEvent.click(await screen.findByRole('switch', { checked: true }))

    expect(isTimerSoundEnabled()).toBe(false)
    expect(N.requestPermission).not.toHaveBeenCalled()
  })

  it('works where Notification is unsupported', () => {
    delete win.Notification
    render(<TimerSoundToggle />)
    expect(() => fireEvent.click(toggle())).not.toThrow()
    expect(isTimerSoundEnabled()).toBe(true)
  })
})
