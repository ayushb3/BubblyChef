'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import BubblesMascot from '@/components/ui/BubblesMascot'
import MealNowCard from '@/components/meal/MealNowCard'
import MealNextUp from '@/components/meal/MealNextUp'
import MealRunningStrip from '@/components/meal/MealRunningStrip'
import MealCookFinished from '@/components/meal/MealCookFinished'
import MealTimelineSheet from '@/components/meal/MealTimelineSheet'
import MealTimelineTable from '@/components/meal/MealTimelineTable'
import { fetchMeal } from '@/lib/api/meals'
import { dishStepSignaturesForMeal, schedulerDishesForMeal } from '@/lib/meal-dishes'
import { formatClockTime } from '@/lib/meal-anchor'
import type { Column } from '@/lib/meal-scheduler'
import {
  deriveStream,
  buildStreamSteps,
  recordBecomingActive,
  recordStartEarly,
  recordStartTimer,
  recordDone,
  recordExtend,
  recordSkip,
  applyOverdueRunningSteps,
  applyTimerState,
  findTimerCompletedSteps,
} from '@/lib/meal-cook-stream'
import {
  getActiveMealCookSession,
  saveMealCookProgress,
  endMealCookSession,
  isStaleMealCookSession,
  type MealCookSession,
} from '@/lib/meal-cook-session'
import { useCookingTimers } from '@/lib/useCookingTimers'

/**
 * Issue #653 — the full-screen cook-along (contract §5). Schedules the same
 * dishes the meal screen does, restores (or refuses to restore — no session,
 * ended, or stale) the persisted `MealCookSession`, and from then on runs
 * entirely off that session plus a slow local clock: no further network
 * request once the meal itself has loaded.
 *
 * The session is held in component state and saved (via `updateSession`) on
 * every recorder call; `deriveStream` is re-run in a `useMemo` from
 * `[schedulerDishes, meal, session, nowMinutes]`, so every render reflects
 * the live plan without the page itself carrying any scheduling logic.
 */
export default function MealCookPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : ''

  // `refetchOnWindowFocus: false` — the visibility-driven clock tick below
  // means this page's tab regularly transitions hidden -> visible while
  // cooking; the default focus-refetch would otherwise turn that into a
  // network request every single time, which the contract rules out ("no
  // network request after the meal has loaded"). `refetchOnReconnect: false`
  // (review round 1) for the same reason — a phone in the kitchen dropping
  // and regaining wifi mid-cook shouldn't trigger one either.
  const { data: meal, isLoading, isError } = useQuery({
    queryKey: ['meal', id],
    queryFn: () => fetchMeal(id),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const { timers, start: startTimer } = useCookingTimers()

  const [session, setSession] = useState<MealCookSession | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [nowMinutes, setNowMinutes] = useState(0)
  const [timelineOpen, setTimelineOpen] = useState(false)
  // Guards the restore effect against React 18 StrictMode's synthetic
  // double-invoke in dev — same discipline as the meal screen's
  // `attemptedStepsRef` (issue #652): a ref persists across that remount,
  // where a `useState` guard or a `cancelled` flag set in cleanup would not.
  const restoredRef = useRef(false)

  const schedulerDishes = useMemo(() => (meal ? schedulerDishesForMeal(meal) : []), [meal])
  const dishIds = useMemo(() => schedulerDishes.map((d) => d.dish_id), [schedulerDishes])
  // Issue #653 review round 1 (S4) — see the meal screen's identical memo.
  const dishStepSignatures = useMemo(() => (meal ? dishStepSignaturesForMeal(meal) : []), [meal])
  const columns = useMemo(
    () => schedulerDishes.map((d) => ({ column: d.column, title: d.title })),
    [schedulerDishes],
  )

  // Restore (once — `restoredRef`) or redirect away from the session once the
  // meal has loaded, and — issue #653 review round 1 (S4) — re-check
  // staleness on every later change to `meal` too, not only at that first
  // restore: an `ensureSteps` upgrade or an edited recipe can land *after*
  // the cook-along is already open (the meal query can refetch/invalidate
  // independently of this page's own actions), and a session that was fine
  // at restore time can turn stale under it.
  useEffect(() => {
    if (!meal) return
    if (!restoredRef.current) {
      restoredRef.current = true
      const active = getActiveMealCookSession(id)
      if (!active || isStaleMealCookSession(active, dishIds, dishStepSignatures)) {
        // Restoring from localStorage (an external system) on mount, exactly
        // the "subscribe to an external system" case the rule carves out —
        // same as `useCookingTimers.tsx`'s own restore-on-mount effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRedirecting(true)
        router.replace(`/meals/${id}`)
        return
      }
      setSession(active)
      setNowMinutes(Math.floor((Date.now() - active.started_at_ms) / 60_000))
      return
    }
    // Already restored: re-check the *current* session (not necessarily
    // `active` above, which only ran once) against the now-current meal.
    if (session && isStaleMealCookSession(session, dishIds, dishStepSignatures)) {
      setRedirecting(true)
      router.replace(`/meals/${id}`)
    }
  }, [meal, dishIds, dishStepSignatures, id, router, session])

  // Issue #653 review round 1 (nit) — depends on `startedAtMs` (a primitive,
  // fixed for the life of the session), not `session` itself: `session`
  // changes on every recorder call while cooking, which would otherwise tear
  // down and recreate this interval on every single tap for no reason (the
  // clock doesn't need to know about step progress, only when cooking
  // started).
  const startedAtMs = session?.started_at_ms

  // The clock: recomputes `now_minutes` immediately, then every 15s, but
  // only while the tab is visible — a backgrounded tab doesn't need a live
  // countdown, and a throttled/suspended background timer would just read
  // stale anyway. Regaining visibility ticks immediately rather than waiting
  // for the next 15s boundary, so the screen doesn't show minutes-old state
  // right after switching back.
  useEffect(() => {
    if (startedAtMs === undefined) return
    const startAt = startedAtMs
    function tick() {
      // `floor`, matching the contract's `now_minutes` definition exactly —
      // keeps `first.start <= now_minutes` activation checks from firing a
      // fraction of a minute early.
      setNowMinutes(Math.floor((Date.now() - startAt) / 60_000))
    }
    let interval: ReturnType<typeof setInterval> | null = null
    function startInterval() {
      if (interval !== null) return
      interval = setInterval(tick, 15_000)
    }
    function stopInterval() {
      if (interval !== null) {
        clearInterval(interval)
        interval = null
      }
    }
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        tick()
        startInterval()
      } else {
        stopInterval()
      }
    }
    if (document.visibilityState === 'visible') startInterval()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stopInterval()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [startedAtMs])

  // Persists `updated` (after locking in any overdue-running bump) and
  // updates state in one call — every recorder call in this page goes
  // through this, so every actual write also re-locks the overdue bump
  // (contract: "persisted only when something else is saved").
  const updateSession = useCallback(
    (updated: MealCookSession) => {
      const withOverdue = applyOverdueRunningSteps(updated, schedulerDishes, nowMinutes)
      setSession(withOverdue)
      saveMealCookProgress(withOverdue)
    },
    [schedulerDishes, nowMinutes],
  )

  const stream = useMemo(() => {
    if (!session) return null
    return deriveStream({
      dishes: schedulerDishes,
      exclusive_tags: meal?.constraints.exclusive_tags ?? [],
      session,
      now_minutes: nowMinutes,
    })
  }, [schedulerDishes, meal, session, nowMinutes])

  const allStreamSteps = useMemo(
    () => (stream ? buildStreamSteps(schedulerDishes, stream.timeline) : []),
    [stream, schedulerDishes],
  )
  const stepByKey = useMemo(() => new Map(allStreamSteps.map((s) => [s.key, s])), [allStreamSteps])

  // A hands-on step becoming the active Now card records it as running, the
  // instant it becomes current — a no-op (via `recordBecomingActive` itself)
  // for a hands-off step or one already recorded.
  useEffect(() => {
    if (!session || !stream) return
    if (stream.now.kind !== 'active') return
    const step = stream.now.step
    if (!step.hands_on) return
    if (session.steps[step.key]) return
    // Materializing a derived transition (the Now card advancing to a new
    // hands-on step) into persisted session state — not something `useMemo`
    // can do, since it's a one-time recording, not a pure recomputation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateSession(recordBecomingActive(session, step, nowMinutes))
  }, [stream, session, nowMinutes, updateSession])

  // Timer wiring: on mount and on every `timers` change, re-derive any
  // running hands-off step's extra_minutes from its linked dock timer, and
  // mark done anything whose linked timer completed, was dismissed, or is
  // simply missing (a reload after it fired while the tab was closed).
  // `timers` is the external system this effect subscribes to — including
  // the store's own `TIMER_COMPLETED_EVENT` (`useCookingTimers` updates its
  // returned `timers` array in the same tick it dispatches that event, so a
  // second explicit listener here would just be the same transition handled
  // twice; issue #653 review round 1 removed it as redundant).
  useEffect(() => {
    if (!session) return
    // Issue #653 review round 1 (S2) — real elapsed ms, not the floored
    // `nowMinutes` state; see `applyTimerState`'s doc comment.
    let next = applyTimerState(session, timers, schedulerDishes, Date.now())
    for (const key of findTimerCompletedSteps(next, timers)) {
      const step = stepByKey.get(key)
      if (step) next = recordDone(next, step, nowMinutes)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next !== session) updateSession(next)
  }, [timers, session, schedulerDishes, nowMinutes, stepByKey, updateSession])

  const timelineProgress = useMemo(() => {
    if (!session) return undefined
    const statuses: Record<string, 'done' | 'skipped' | 'running'> = {}
    for (const step of allStreamSteps) {
      const rec = session.steps[step.key]
      if (rec) statuses[`${step.column}:${step.step_index}`] = rec.status
    }
    const current: { column: Column; step_index: number } | undefined =
      stream && stream.now.kind === 'active'
        ? { column: stream.now.step.column, step_index: stream.now.step.step_index }
        : undefined
    return { statuses, current }
  }, [session, allStreamSteps, stream])

  function clockLabel(offsetMinutes: number): string {
    if (!session) return ''
    return formatClockTime(new Date(session.started_at_ms + offsetMinutes * 60_000))
  }

  // Issue #653 review round 1 (nit) — double-tap guard: once the Now card's
  // step key changes (a new step becomes current, or the card moves to
  // upcoming/waiting/finished), taps are ignored for ~400ms. Every action
  // below is otherwise fully synchronous (a recorder call, or
  // `timers.start`) — there's no in-flight window a *stale* double tap could
  // land in, which is why pills aren't `disabled` while "applying" — but a
  // fast double tap can still land on the *next* card's primary button, in
  // the same screen position, right after the first tap advances the Now
  // card out from under the second one.
  const tapGuardUntilRef = useRef(0)
  const nowCardKeyRef = useRef<string | undefined>(undefined)
  const nowCardInitializedRef = useRef(false)
  useEffect(() => {
    const key =
      stream && (stream.now.kind === 'active' || stream.now.kind === 'upcoming')
        ? stream.now.step.key
        : stream?.now.kind
    if (key !== nowCardKeyRef.current) {
      // The very first assignment (mount restoring the session) isn't a
      // "change" to guard against — only a later transition, where a stray
      // tap could land on whatever button is now in the spot the previous
      // card's primary action used to occupy.
      if (nowCardInitializedRef.current) {
        tapGuardUntilRef.current = Date.now() + 400
      }
      nowCardKeyRef.current = key
      nowCardInitializedRef.current = true
    }
  }, [stream])
  function tapGuarded(): boolean {
    return Date.now() < tapGuardUntilRef.current
  }

  function handleDone() {
    if (!session || !stream || stream.now.kind !== 'active') return
    if (tapGuarded()) return
    const step = stream.now.step
    if (step.hands_on) {
      updateSession(recordDone(session, step, nowMinutes))
    } else {
      const timerId = startTimer(step.label, step.duration_minutes * 60)
      updateSession(recordStartTimer(session, step, nowMinutes, timerId))
    }
  }

  function handleExtend() {
    if (!session || !stream || stream.now.kind !== 'active') return
    if (tapGuarded()) return
    updateSession(recordExtend(session, stream.now.step.key))
  }

  function handleSkip() {
    if (!session || !stream) return
    if (stream.now.kind !== 'active' && stream.now.kind !== 'upcoming') return
    if (tapGuarded()) return
    updateSession(recordSkip(session, stream.now.step, nowMinutes))
  }

  function handleStartEarly() {
    if (!session || !stream || stream.now.kind !== 'upcoming') return
    if (tapGuarded()) return
    const step = stream.now.step
    if (step.hands_on) {
      updateSession(recordStartEarly(session, step, nowMinutes))
    } else {
      const timerId = startTimer(step.label, step.duration_minutes * 60)
      updateSession(recordStartTimer(session, step, nowMinutes, timerId))
    }
  }

  // Leaves the session active — the meal screen's banner then offers Resume.
  function handleClose() {
    router.push(`/meals/${id}`)
  }

  function handleBackToMeal() {
    endMealCookSession(id)
    router.push(`/meals/${id}`)
  }

  // ── Loading / redirecting states ────────────────────────────────────────
  if (isLoading || redirecting || (meal && !session)) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-4 py-16 gap-6"
        style={{ background: 'var(--color-bg)' }}
      >
        <BubblesMascot state="thinking" size={80} />
        <p
          className="text-sm font-semibold"
          style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
        >
          Loading...
        </p>
      </main>
    )
  }

  if (isError || !meal || !session || !stream) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-4 py-16 gap-4"
        style={{ background: 'var(--color-bg)' }}
      >
        <BubblesMascot state="surprised" size={90} />
        <h1
          className="text-xl font-extrabold text-center"
          style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
        >
          Meal not found
        </h1>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen pb-24"
      style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}
    >
      <div className="max-w-2xl mx-auto px-4 pt-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close cook-along"
            className="min-h-[44px] px-2 text-sm font-semibold flex items-center gap-1"
            style={{ color: 'var(--color-muted)' }}
          >
            <span aria-hidden="true">✕</span>
            <span>Close</span>
          </button>
          <h1
            className="text-lg font-extrabold truncate text-center flex-1"
            style={{ color: 'var(--color-text)' }}
          >
            {meal.title}
          </h1>
          <button
            type="button"
            onClick={() => setTimelineOpen(true)}
            aria-label="Open timeline"
            className="min-h-[44px] px-3 rounded-full text-sm font-bold"
            style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            Timeline
          </button>
        </div>

        {stream.now.kind === 'finished' ? (
          <MealCookFinished mealTitle={meal.title} onBackToMeal={handleBackToMeal} />
        ) : (
          <div className="flex flex-col gap-4">
            <MealNowCard
              card={stream.now}
              clockLabel={clockLabel}
              onDone={handleDone}
              onExtend={handleExtend}
              onSkip={handleSkip}
              onStartEarly={handleStartEarly}
            />
            <MealRunningStrip steps={stream.running} clockLabel={clockLabel} />
            <MealNextUp step={stream.next_up} clockLabel={clockLabel} />
          </div>
        )}
      </div>

      <MealTimelineSheet open={timelineOpen} onClose={() => setTimelineOpen(false)}>
        <MealTimelineTable
          timeline={stream.timeline}
          columns={columns}
          anchor={{ status: 'clock', start_at: new Date(session.started_at_ms) }}
          progress={timelineProgress}
        />
      </MealTimelineSheet>
    </main>
  )
}
