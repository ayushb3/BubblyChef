'use client'

/**
 * Profile's "Timer sound" preference (issue #848): a chime (and a system
 * notification, when the browser allows) when a cooking timer finishes. Off by
 * default: the signature PRD says no sound in v1, so it is opt-in.
 *
 * Stored in localStorage with the other client-side preferences (the theme), via
 * `lib/timer-alerts.ts`. Turning it on is the one place notification permission
 * is asked for (a tap, as browsers require) and the moment the audio context is
 * unlocked so the chime can play later with no gesture. A denied permission is
 * not asked again and does not block the chime.
 *
 * The server render and hydration say off; the saved value follows on the client
 * (`useSyncExternalStore`), and other tabs' changes are picked up.
 */
import { useSyncExternalStore } from 'react'
import {
  isTimerSoundEnabled,
  subscribeTimerSound,
  requestNotificationPermission,
  setTimerSoundEnabled,
  unlockAudio,
} from '@/lib/timer-alerts'

export default function TimerSoundToggle() {
  // The server render and hydration say off; the saved choice follows on the client.
  const enabled = useSyncExternalStore(subscribeTimerSound, isTimerSoundEnabled, () => false)

  const toggle = () => {
    const next = !enabled
    setTimerSoundEnabled(next)
    if (next) {
      unlockAudio()
      void requestNotificationPermission()
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] px-4 py-3">
      <div className="min-w-0">
        <p id="timer-sound-label" className="text-sm text-[var(--color-text)]">
          Timer sound
        </p>
        <p className="text-xs text-[var(--color-muted)]">
          A chime and a notification when a timer finishes.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby="timer-sound-label"
        onClick={toggle}
        className="relative inline-flex min-h-[44px] min-w-[52px] flex-shrink-0 items-center justify-center"
      >
        <span
          aria-hidden="true"
          className="relative inline-block h-7 w-12 rounded-full border-2 border-[color:var(--color-text)] transition-colors motion-reduce:transition-none"
          style={{ background: enabled ? 'var(--color-primary)' : 'var(--color-surface)' }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full border-2 border-[color:var(--color-text)] bg-[var(--color-bg)] transition-all motion-reduce:transition-none"
            style={{ left: enabled ? '1.25rem' : '0.125rem' }}
          />
        </span>
      </button>
    </div>
  )
}
