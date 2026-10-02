'use client'

/**
 * Keep the screen awake while `active` (issue #848): a phone propped on the
 * counter must not go dark mid-recipe.
 *
 * Requests a screen Wake Lock while `active` and the caller is mounted. The
 * browser drops the lock whenever the page is hidden (another tab, the phone
 * locked), so it is requested again when the page becomes visible. The lock is
 * released on leave. Where the API is unsupported, or a request is refused
 * (low battery, no user activation), this is a silent no-op: the cook works
 * either way, the screen just may sleep.
 */
import { useEffect } from 'react'

interface WakeLockSentinelLike {
  released?: boolean
  release: () => Promise<void>
  addEventListener?: (type: 'release', listener: () => void) => void
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

export function useWakeLock(active: boolean = true): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    const wakeLock = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock
    if (!wakeLock) return

    let cancelled = false
    let sentinel: WakeLockSentinelLike | null = null
    let requesting = false

    const acquire = async () => {
      if (cancelled || requesting || (sentinel && !sentinel.released)) return
      if (document.visibilityState === 'hidden') return
      requesting = true
      try {
        const lock = await wakeLock.request('screen')
        if (cancelled) {
          // The page left while the request was in flight: do not leak the lock.
          await lock.release().catch(() => {})
          return
        }
        sentinel = lock
        lock.addEventListener?.('release', () => {
          if (sentinel === lock) sentinel = null
        })
      } catch {
        // Unsupported state, low battery, not allowed: a no-op by design.
      } finally {
        requesting = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const held = sentinel
      sentinel = null
      if (held && !held.released) void held.release().catch(() => {})
    }
  }, [active])
}
