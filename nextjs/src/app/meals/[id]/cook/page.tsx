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
import { schedulerDishesForMeal } from '@/lib/meal-dishes'
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
import { useCookingTimers, TIMER_COMPLETED_EVENT } from '@/lib/useCookingTimers'

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
  // network request after the meal has loaded").
  const { data: meal, isLoading, isError } = useQuery({
    queryKey: ['meal', id],
    queryFn: () => fetchMeal(id),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
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
  const columns = useMemo(
    () => schedulerDishes.map((d) => ({ column: d.column, title: d.title })),
    [schedulerDishes],
  )

  // Restore (or redirect away from) the session once the meal has loaded —
  // staleness needs the meal's current dish ids, so this waits for `meal`
  // rather than reading storage immediately.
  useEffect(() => {
    if (restoredRef.current) return
    if (!meal) return
    restoredRef.current = true
    const active = getActiveMealCookSession(id)
    if (!active || isStaleMealCookSession(active, dishIds)) {
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
  }, [meal, dishIds, id, router])

  // The clock: recomputes `now_minutes` immediately, then every 15s, but
  // only while the tab is visible — a backgrounded tab doesn't need a live
  // countdown, and a throttled/suspended background timer would just read
  // stale anyway. Regaining visibility ticks immediately rather than waiting
  // for the next 15s boundary, so the screen doesn't show minutes-old state
  // right after switching back.
  useEffect(() => {
    if (!session) return
    const startedAtMs = session.started_at_ms
    function tick() {
      // `floor`, matching the contract's `now_minutes` definition exactly —
      // keeps `first.start <= now_minutes` activation checks from firing a
      // fraction of a minute early.
      setNowMinutes(Math.floor((Date.now() - startedAtMs) / 60_000))
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
  }, [session])

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

  // Timer wiring, part 1: on mount and on every `timers` change, re-derive
  // any running hands-off step's extra_minutes from its linked dock timer,
  // and mark done anything whose linked timer completed, was dismissed, or
  // is simply missing (a reload after it fired while the tab was closed).
  // `timers` is the external system this effect subscribes to.
  useEffect(() => {
    if (!session) return
    let next = applyTimerState(session, timers, schedulerDishes, nowMinutes)
    for (const key of findTimerCompletedSteps(next, timers)) {
      const step = stepByKey.get(key)
      if (step) next = recordDone(next, step, nowMinutes)
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next !== session) updateSession(next)
  }, [timers, session, schedulerDishes, nowMinutes, stepByKey, updateSession])

  // Timer wiring, part 2: react to the store's own completion event too,
  // rather than relying solely on the `timers`-array-changed path above —
  // the same explicit trigger `TimerDock` itself uses for its own
  // completion feedback.
  useEffect(() => {
    if (!session) return
    function handleTimerCompleted() {
      let next = session as MealCookSession
      for (const key of findTimerCompletedSteps(next, timers)) {
        const step = stepByKey.get(key)
        if (step) next = recordDone(next, step, nowMinutes)
      }
      if (next !== session) updateSession(next)
    }
    window.addEventListener(TIMER_COMPLETED_EVENT, handleTimerCompleted)
    return () => window.removeEventListener(TIMER_COMPLETED_EVENT, handleTimerCompleted)
  }, [session, timers, nowMinutes, stepByKey, updateSession])

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

  // Pills are not disabled here even though `MealNowCard` supports it — every
  // action below (a recorder call, or `timers.start`) is fully synchronous,
  // so there is no in-flight window a double tap could land in (the second
  // click can only ever be handled after the first has already produced a
  // fully-updated session). A `disabled`/"applying" flag would guard against
  // nothing real.
  function handleDone() {
    if (!session || !stream || stream.now.kind !== 'active') return
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
    updateSession(recordExtend(session, stream.now.step.key))
  }

  function handleSkip() {
    if (!session || !stream || stream.now.kind === 'finished') return
    updateSession(recordSkip(session, stream.now.step, nowMinutes))
  }

  function handleStartEarly() {
    if (!session || !stream || stream.now.kind !== 'upcoming') return
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
