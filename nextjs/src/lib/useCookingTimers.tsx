'use client'

/**
 * Issue #495 — Spec B.3 cooking timers: client-side store for multiple
 * concurrent named timers, shared across every route via a layout-level
 * provider (mirrors the "context at the layout level" call in the spec).
 *
 * Deliberately independent of `lib/cook-session.ts` (issues #440/#441/#490):
 * that module tracks *guided-cook step position*, this one tracks *timers*.
 * Different localStorage key, different lifecycle, no shared state — so this
 * feature and the #490 cook-session-resume fix can land without touching the
 * same storage record or racing each other.
 *
 * Persistence: each running timer stores an absolute `endAt` epoch-ms
 * timestamp, not a countdown. That's what makes survival-across-reload
 * "cheap" (per the issue): on rehydrate, remaining time is `endAt - now`,
 * so a closed tab or a slow reload doesn't lose elapsed time the way a
 * persisted "seconds remaining" counter would.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type CookingTimerStatus = 'running' | 'paused' | 'completed'

export interface CookingTimer {
  id: string
  label: string
  durationSeconds: number
  /** Seconds remaining right now. Recomputed each tick while running. */
  remainingSeconds: number
  status: CookingTimerStatus
}

/** The shape actually persisted — running timers keep an absolute end time. */
interface StoredTimer {
  id: string
  label: string
  durationSeconds: number
  /** epoch ms this timer ends at, or null while paused/completed. */
  endAt: number | null
  /** Frozen remaining seconds while paused, or the final 0 once completed. */
  frozenRemaining: number
  status: CookingTimerStatus
}

const STORAGE_KEY = 'bubblychef:timers:v1'
const TICK_MS = 1000

/** The DOM event fired once per timer the instant it completes (issue #495,
 * §6 — "a `timerCompleted` event/callback the Spec B.4 inbox can subscribe
 * to"). Listen with `window.addEventListener('timerCompleted', handler)`;
 * `event.detail` is `{ id, label }`.
 */
export const TIMER_COMPLETED_EVENT = 'timerCompleted'

function nowMs(): number {
  return Date.now()
}

function makeId(): string {
  return `timer-${nowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

function readStored(): StoredTimer[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is StoredTimer =>
        t &&
        typeof t === 'object' &&
        typeof (t as StoredTimer).id === 'string' &&
        typeof (t as StoredTimer).label === 'string' &&
        typeof (t as StoredTimer).durationSeconds === 'number' &&
        typeof (t as StoredTimer).frozenRemaining === 'number' &&
        typeof (t as StoredTimer).status === 'string',
    )
  } catch {
    // Storage unavailable or corrupt — start with no timers, same as a
    // fresh session. Not a new failure mode.
    return []
  }
}

function writeStored(timers: StoredTimer[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timers))
  } catch {
    // Best effort — worst case a reload loses in-flight timers.
  }
}

/** Derives the live, render-ready view of a stored timer at time `at`. */
function toLiveTimer(t: StoredTimer, at: number): CookingTimer {
  if (t.status === 'running' && t.endAt !== null) {
    const remainingSeconds = Math.max(0, Math.round((t.endAt - at) / 1000))
    return {
      id: t.id,
      label: t.label,
      durationSeconds: t.durationSeconds,
      remainingSeconds,
      status: remainingSeconds <= 0 ? 'completed' : 'running',
    }
  }
  return {
    id: t.id,
    label: t.label,
    durationSeconds: t.durationSeconds,
    remainingSeconds: t.frozenRemaining,
    status: t.status,
  }
}

export interface CookingTimersContextValue {
  /** All timers (running, paused, and completed-but-not-dismissed). */
  timers: CookingTimer[]
  /** Starts a new running timer and returns its id. */
  start: (label: string, seconds: number) => string
  pause: (id: string) => void
  resume: (id: string) => void
  /** Removes a timer entirely — used for both "dismiss" and cancel. */
  dismiss: (id: string) => void
}

/**
 * Inert fallback used any time `useCookingTimers()` is read outside a
 * mounted `CookingTimersProvider` — e.g. a component test for something
 * else entirely (a recipe card, the guided-cook flow) that doesn't wrap
 * itself in every provider the real app tree happens to nest under. `start`
 * still returns an id so a caller that doesn't check it won't crash, but
 * nothing is persisted or rendered anywhere; the real app always has the
 * provider mounted at the layout level, so this path is never hit in
 * production.
 */
const NOOP_CONTEXT_VALUE: CookingTimersContextValue = {
  timers: [],
  start: () => 'noop-timer',
  pause: () => {},
  resume: () => {},
  dismiss: () => {},
}

const CookingTimersContext = createContext<CookingTimersContextValue>(NOOP_CONTEXT_VALUE)

export function CookingTimersProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredTimer[]>(() => readStored())
  const [tick, setTick] = useState(() => nowMs())
  // Tracks which ids have already fired the completion event, so a re-render
  // (or a timer that stays completed-but-undismissed across many ticks)
  // never fires it twice.
  const firedRef = useRef<Set<string>>(new Set())

  // Persist on every change.
  useEffect(() => {
    writeStored(stored)
  }, [stored])

  // The live, render-ready view. Completion is derived here from `endAt` vs
  // `tick` rather than written back into `stored` — a running timer whose
  // time has passed still reads as `status: 'completed'` from `toLiveTimer`
  // even though its persisted record still says "running". That keeps
  // completion detection a pure read (no setState from inside an effect —
  // see below) and still survives a reload: `toLiveTimer` recomputes from
  // the persisted `endAt` against the *new* `now`, whatever the literal
  // persisted status string says.
  const timers = useMemo(() => stored.map((t) => toLiveTimer(t, tick)), [stored, tick])

  // One shared interval, only while at least one timer is actually still
  // counting down — no point ticking a page with nothing but paused/
  // completed timers. Uses `timers` (the live view), not `stored`, so the
  // interval actually stops once everything has finished.
  const hasRunning = timers.some((t) => t.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const interval = setInterval(() => setTick(nowMs()), TICK_MS)
    return () => clearInterval(interval)
  }, [hasRunning])

  // Fire the completion event exactly once per timer. This only dispatches
  // a DOM event — it never calls setState — so doing it as a side effect of
  // `timers` changing is safe (unlike mutating `stored` here would be).
  useEffect(() => {
    for (const t of timers) {
      if (t.status === 'completed' && !firedRef.current.has(t.id)) {
        firedRef.current.add(t.id)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(TIMER_COMPLETED_EVENT, { detail: { id: t.id, label: t.label } }),
          )
        }
      }
    }
  }, [timers])

  const start = useCallback((label: string, seconds: number): string => {
    const id = makeId()
    const duration = Math.max(1, Math.round(seconds))
    setStored((prev) => [
      ...prev,
      {
        id,
        label,
        durationSeconds: duration,
        endAt: nowMs() + duration * 1000,
        frozenRemaining: duration,
        status: 'running',
      },
    ])
    return id
  }, [])

  const pause = useCallback((id: string) => {
    setStored((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.status !== 'running' || t.endAt === null) return t
        const remaining = Math.max(0, Math.round((t.endAt - nowMs()) / 1000))
        return { ...t, status: 'paused', endAt: null, frozenRemaining: remaining }
      }),
    )
  }, [])

  const resume = useCallback((id: string) => {
    setStored((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.status !== 'paused') return t
        return { ...t, status: 'running', endAt: nowMs() + t.frozenRemaining * 1000 }
      }),
    )
  }, [])

  const dismiss = useCallback((id: string) => {
    firedRef.current.delete(id)
    setStored((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const value = useMemo<CookingTimersContextValue>(
    () => ({ timers, start, pause, resume, dismiss }),
    [timers, start, pause, resume, dismiss],
  )

  return <CookingTimersContext.Provider value={value}>{children}</CookingTimersContext.Provider>
}

/**
 * Reads the shared timer store. Normally used under `CookingTimersProvider`
 * (mounted once at the layout level in `app/layout.tsx`); falls back to an
 * inert no-op store when read outside one, so a component that renders a
 * timer chip (recipe page, guided cook flow) doesn't force every test or
 * embedding of it to also wrap in this provider.
 */
export function useCookingTimers(): CookingTimersContextValue {
  return useContext(CookingTimersContext)
}
