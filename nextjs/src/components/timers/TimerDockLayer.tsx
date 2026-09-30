'use client'

/**
 * Issue #657 — lets a full-screen layer (guided cook) ask the global timer
 * dock to rise above it.
 *
 * The dock is mounted once in `Providers` at `z-40`, so every `z-[60]` sheet
 * and modal covers it, which is right. Guided cook is `z-[9990]` and used to
 * cover it too, which hid a timer the cook had just started. Rather than bump
 * the dock's z-index everywhere, a layer that wants the dock visible holds a
 * "raise" while it is mounted. Ref-counted, so two overlapping holders (or a
 * StrictMode double-mount) can't leave the dock stuck raised or dropped early.
 *
 * With no provider (isolated renders in tests) the dock is simply "not
 * raised" and `useRaiseTimerDock` is a no-op.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

interface TimerDockLayerValue {
  raised: boolean
  acquire: () => void
  release: () => void
}

const TimerDockLayerContext = createContext<TimerDockLayerValue | null>(null)

export function TimerDockLayerProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0)
  const acquire = useCallback(() => setCount((c) => c + 1), [])
  const release = useCallback(() => setCount((c) => Math.max(0, c - 1)), [])
  const value = useMemo(
    () => ({ raised: count > 0, acquire, release }),
    [count, acquire, release],
  )
  return <TimerDockLayerContext.Provider value={value}>{children}</TimerDockLayerContext.Provider>
}

/**
 * Hold the dock raised while `active` is true and the caller is mounted.
 * The count changes inside the effect's subscribe/cleanup pair (an external
 * store-style registration), never synchronously in render.
 */
export function useRaiseTimerDock(active: boolean): void {
  const ctx = useContext(TimerDockLayerContext)
  const acquire = ctx?.acquire
  const release = ctx?.release
  useEffect(() => {
    if (!active || !acquire || !release) return
    acquire()
    return release
  }, [active, acquire, release])
}

/** True while any layer holds the dock raised. False with no provider. */
export function useTimerDockRaised(): boolean {
  return useContext(TimerDockLayerContext)?.raised ?? false
}
