/**
 * Issue #783 — the signature PRD (Goal 3) says "No sound in v1", but the
 * timer dock played a WebAudio chime when a timer finished. A finished timer
 * is signalled by the finished chip, the live-region announcement and (where
 * supported) a vibration, and never by audio.
 *
 * Issue #848: sound is opt-in (Profile > Timer sound), so this stays the
 * default; `timer-dock-alerts.test.tsx` covers it switched on.
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

const ANNOUNCE_DELAY_MS = 60

type AudioGlobals = {
  AudioContext?: unknown
  webkitAudioContext?: unknown
  Audio?: unknown
}

async function finishATimer() {
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
  await act(async () => {})
  act(() => {
    jest.advanceTimersByTime(ANNOUNCE_DELAY_MS)
  })
}

describe('TimerDock finish feedback has no sound (issue #783)', () => {
  const win = window as unknown as AudioGlobals
  let saved: AudioGlobals
  let audioContextCtor: jest.Mock
  let webkitAudioContextCtor: jest.Mock
  let audioCtor: jest.Mock
  let vibrate: jest.Mock

  beforeEach(() => {
    window.localStorage.clear()
    jest.useFakeTimers()
    saved = {
      AudioContext: win.AudioContext,
      webkitAudioContext: win.webkitAudioContext,
      Audio: win.Audio,
    }
    audioContextCtor = jest.fn()
    webkitAudioContextCtor = jest.fn()
    audioCtor = jest.fn()
    win.AudioContext = audioContextCtor
    win.webkitAudioContext = webkitAudioContextCtor
    win.Audio = audioCtor
    vibrate = jest.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
  })

  afterEach(() => {
    jest.useRealTimers()
    win.AudioContext = saved.AudioContext
    win.webkitAudioContext = saved.webkitAudioContext
    win.Audio = saved.Audio
    delete (navigator as unknown as { vibrate?: unknown }).vibrate
  })

  it('never constructs any audio when a timer finishes', async () => {
    await finishATimer()

    expect(audioContextCtor).not.toHaveBeenCalled()
    expect(webkitAudioContextCtor).not.toHaveBeenCalled()
    expect(audioCtor).not.toHaveBeenCalled()
    expect(document.querySelector('audio')).toBeNull()
  })

  it('still shows the finished chip, announces it, and vibrates once', async () => {
    await finishATimer()

    expect(screen.getByTestId(/timer-badge-/)).toHaveAttribute('data-status', 'completed')
    expect(screen.getByTestId('timer-live-region').textContent).toMatch(/boil egg.*finished/i)
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('finishes cleanly where navigator.vibrate is unsupported', async () => {
    delete (navigator as unknown as { vibrate?: unknown }).vibrate

    await finishATimer()

    expect(screen.getByTestId(/timer-badge-/)).toHaveAttribute('data-status', 'completed')
  })
})
