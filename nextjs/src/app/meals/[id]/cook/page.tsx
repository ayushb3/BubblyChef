'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import MealNowCard from '@/components/meal/MealNowCard'
import MealNextUp from '@/components/meal/MealNextUp'
import MealRunningStrip from '@/components/meal/MealRunningStrip'
import MealCookFinished from '@/components/meal/MealCookFinished'
import MealCookSheet, { type MealCookSheetState } from '@/components/meal/MealCookSheet'
import MealTimelineSheet from '@/components/meal/MealTimelineSheet'
import MealTimelineTable from '@/components/meal/MealTimelineTable'
import AskBubblesOverlay, { type AskBubblesAmendment } from '@/components/cook/AskBubblesOverlay'
import { fetchMeal, requestMealCookProposal, confirmMealCook, MealCookError } from '@/lib/api/meals'
import { dishStepSignaturesForMeal, schedulerDishesForMeal } from '@/lib/meal-dishes'
import { formatClockTime } from '@/lib/meal-anchor'
import { localDateString } from '@/lib/date'
import {
  cookedDishIds,
  buildMealCookRequest,
  recipeServingsFor,
  pinnedIngredientsForDish,
} from '@/lib/meal-cook-deduction'
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
  timerIdsToDismiss,
  isMealCookFinished,
  canStartEarly,
} from '@/lib/meal-cook-stream'
import {
  getActiveMealCookSession,
  saveMealCookProgress,
  endMealCookSession,
  isStaleMealCookSession,
  ensureCookId,
  withDishAmendment,
  type MealCookSession,
} from '@/lib/meal-cook-session'
import { skippedDeductionNames } from '@/lib/cook-skipped'
import { useCookingTimers } from '@/lib/useCookingTimers'
import type { MealCookErrorKind, MealCookProposal, MealDishFull } from '@/types/meals'
import type { DeductionItem } from '@/types/recipes'

/** The dish the Ask Bubbles overlay is pinned to (issue #654 PR B, §3). */
interface AskPin {
  dishId: string
  dishTitle: string
  stepN: number
  stepText: string
}

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
  const queryClient = useQueryClient()
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

  const { timers, start: startTimer, dismiss: dismissTimer } = useCookingTimers()

  const [session, setSession] = useState<MealCookSession | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [nowMinutes, setNowMinutes] = useState(0)
  const [timelineOpen, setTimelineOpen] = useState(false)
  // Issue #654 PR B (§3) — the dish (and step) the Ask Bubbles overlay is
  // pinned to. Captured once, at the tap that opens it, from the Now card's
  // step at that instant: the Now card advancing while the overlay is open
  // (a timer completing) must not move the pin onto a different dish.
  const [askPin, setAskPin] = useState<AskPin | null>(null)
  // Guards the restore effect against React 18 StrictMode's synthetic
  // double-invoke in dev — same discipline as the meal screen's
  // `attemptedStepsRef` (issue #652): a ref persists across that remount,
  // where a `useState` guard or a `cancelled` flag set in cleanup would not.
  const restoredRef = useRef(false)

  // Issue #654 §5 — the combined deduction sheet's own state, entirely
  // separate from the cook-along session/stream above. `errorStage`
  // disambiguates what Retry means: a proposal fetch failure retries the
  // fetch, a confirm failure resends the same confirm.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetState, setSheetState] = useState<MealCookSheetState>('loading')
  const [proposal, setProposal] = useState<MealCookProposal | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
  const [errorKind, setErrorKind] = useState<MealCookErrorKind | undefined>(undefined)
  const [errorStage, setErrorStage] = useState<'load' | 'confirm'>('load')
  // Issue #621 — pantry items the server refused to deduct, resolved to names.
  // Non-empty holds the sheet on its success state (no redirect) until the
  // cook taps Back to meal.
  const [skipped, setSkipped] = useState<{ names: string[]; unnamed: number }>({ names: [], unnamed: 0 })
  // Set before the first await of a confirm, cleared only on the error path
  // (§5 "Confirm" step 0) — success navigates away, so there is nothing left
  // to guard by the time it would otherwise clear.
  const confirmingRef = useRef(false)
  const lastDeductionsRef = useRef<DeductionItem[]>([])
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // True once, the first time this mount evaluates the restored session as
  // already finished — set once, in the restore effect, from the session as
  // it was AT RESTORE, not from any later live transition. Nit 6: a cook that
  // *becomes* finished live on this mount (the last Done tapped here) must
  // not auto-open the sheet.
  const wasFinishedAtRestoreRef = useRef(false)
  const autoOpenedRef = useRef(false)
  // Review N2 — `confirmMealCook` resolving/rejecting after this page has
  // unmounted (the user navigated away by another route while a confirm was
  // in flight) must not schedule a redirect or a retry against it.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const schedulerDishes = useMemo(() => (meal ? schedulerDishesForMeal(meal) : []), [meal])
  const dishIds = useMemo(() => schedulerDishes.map((d) => d.dish_id), [schedulerDishes])
  // Issue #653 review round 1 (S4) — see the meal screen's identical memo.
  const dishStepSignatures = useMemo(() => (meal ? dishStepSignaturesForMeal(meal) : []), [meal])
  const columns = useMemo(
    () => schedulerDishes.map((d) => ({ column: d.column, title: d.title })),
    [schedulerDishes],
  )
  // Issue #654 PR B — looks up a dish by recipe id (= dish id) for the Ask
  // Bubbles pin and its applied amendment; mirrors `buildMealCookRequest`'s
  // own local map.
  const dishByRecipeId = useMemo(
    () => new Map<string, MealDishFull>(meal ? meal.dishes.map((d) => [d.recipe.id, d]) : []),
    [meal],
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
      // Issue #654 §3/§5: `ensureCookId`, then save when it changed — a
      // pre-#654 session gets a deterministic `legacy-<started_at_ms>` id,
      // persisted so a later reload (or another tab) derives the same one.
      const ensured = ensureCookId(active)
      if (ensured !== active) saveMealCookProgress(ensured)
      wasFinishedAtRestoreRef.current = isMealCookFinished(ensured, schedulerDishes)
      setSession(ensured)
      setNowMinutes(Math.floor((Date.now() - ensured.started_at_ms) / 60_000))
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

  // Issue #654 §3 (S9) — the finish flow's own view of the same session:
  // which dishes actually count as cooked, and (the complement) which
  // dish titles the finished screen names as skipped.
  const cookedIds = useMemo(
    () => (session ? cookedDishIds(schedulerDishes, session) : []),
    [schedulerDishes, session],
  )
  const canDeduct = cookedIds.length > 0
  const skippedDishTitles = useMemo(
    () => schedulerDishes.filter((d) => !cookedIds.includes(d.dish_id)).map((d) => d.title),
    [schedulerDishes, cookedIds],
  )

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
    // Issue #663 — not while a step this one follows is still running.
    if (!session || !stream || !canStartEarly(stream.now)) return
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

  // Issue #654 PR B (§3) — opens the overlay pinned to the Now card's current
  // dish/step. Captured once at the tap; the overlay's own `pinned` prop is
  // re-derived from `askPin` on every render, not re-pinned as the Now card
  // advances.
  function handleAskBubbles() {
    if (!stream) return
    if (stream.now.kind !== 'active' && stream.now.kind !== 'upcoming') return
    const step = stream.now.step
    setAskPin({
      dishId: step.dish_id,
      dishTitle: step.dish_title,
      stepN: step.step_index + 1,
      stepText: step.text.trim() || step.label,
    })
  }

  // Issue #654 PR B (§3) — applies an amendment from the overlay into the
  // session's per-dish slot. Ignores anything that doesn't match the pin
  // (a stale card from a since-superseded pin) or names a dish no longer in
  // the meal. No request beyond the chat stream is made here — the saved
  // recipe is never written.
  //
  // Review S1 (defence in depth) — a blank-named line is dropped before it
  // ever reaches `withDishAmendment`: `readDishAmendment` rejects the WHOLE
  // amendment if any ingredient has a blank name, so letting one through
  // here would silently discard a real change the model made alongside it.
  // If nothing usable is left, nothing is applied at all.
  function handleApplyAmendment(a: AskBubblesAmendment) {
    if (!askPin || !session || !meal) return
    if (a.recipe_id !== askPin.dishId) return
    const dish = dishByRecipeId.get(a.recipe_id)
    if (!dish) return
    const ingredients = a.ingredients.filter((ing) => ing.name.trim() !== '')
    if (ingredients.length === 0) return
    updateSession(
      withDishAmendment(session, a.recipe_id, {
        ingredients,
        servings: recipeServingsFor(dish, meal.servings),
        change_summary: a.change_summary,
        applied_at_ms: Date.now(),
      }),
    )
  }

  // Issue #654 §5 — "Skip pantry update" (canDeduct) and "Back to meal"
  // (!canDeduct) on the finished screen both mean the same thing: no write,
  // no bubbles, nothing marked cooked. Dismisses any still-running dock
  // timers first (defensive — a finished session has no running records in
  // practice) before ending the session.
  function handleFinishWithoutPantry() {
    if (session) {
      for (const timerId of timerIdsToDismiss(session)) dismissTimer(timerId)
    }
    endMealCookSession(id)
    router.push(`/meals/${id}`)
  }

  function invalidateAfterConfirm() {
    queryClient.invalidateQueries({ queryKey: ['bubbles'] })
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
    queryClient.invalidateQueries({ queryKey: ['meal', id] })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    queryClient.invalidateQueries({ queryKey: ['inbox-entries'] })
  }

  /** The copy the sheet's error state shows for each `MealCookErrorKind` (§5). */
  function copyForErrorKind(kind: MealCookErrorKind, fallback: string): string {
    if (kind === 'dish_mismatch') {
      return "This meal changed while you were cooking, so it can't be taken from your pantry as it was."
    }
    if (kind === 'confirm_incomplete') {
      return 'Your pantry may be partly updated — check it.'
    }
    return fallback
  }

  /**
   * `POST /api/ai/meals/cook` — opens the sheet and requests a fresh
   * proposal. Retried verbatim (same request) by `handleRetry` when
   * `errorStage === 'load'`.
   */
  const handleMarkCooked = useCallback(async () => {
    if (!meal || !session) return
    const req = buildMealCookRequest(meal, session, schedulerDishes)
    setSheetOpen(true)
    setErrorStage('load')
    setSheetState('loading')
    setProposal(null)
    if (!req) {
      // Defensive: Mark meal as cooked is only rendered when `canDeduct`,
      // which is exactly "some dish was cooked" — buildMealCookRequest
      // returning null means the same thing, so there is nothing to show.
      setSheetOpen(false)
      return
    }
    try {
      const p = await requestMealCookProposal(req)
      setProposal(p)
      setSheetState('review')
    } catch (err) {
      if (err instanceof MealCookError && err.kind) {
        setErrorKind(err.kind)
        setErrorMessage(copyForErrorKind(err.kind, err.message))
      } else {
        setErrorKind(undefined)
        setErrorMessage(err instanceof Error ? err.message : 'Failed to build the meal cook proposal')
      }
      setSheetState('error')
    }
  }, [meal, session, schedulerDishes])

  /**
   * `POST /api/ai/meals/cook/confirm` (§5 "Confirm"). `isRetryOfInProgress`
   * is only ever true for the ONE automatic retry after a `confirm_in_progress`
   * — a second `confirm_in_progress` on that retry is treated exactly like
   * `confirm_incomplete`, never retried again.
   */
  async function doConfirm(deductions: DeductionItem[], isRetryOfInProgress: boolean) {
    if (!session) return
    try {
      const res = await confirmMealCook({
        meal_id: id,
        cook_ref: session.cook_id ?? '',
        recipe_ids: cookedIds,
        deductions,
        date: localDateString(),
      })
      // Success, `already_confirmed` included — the server's claim already
      // decided nothing double-deducts; end the session and invalidate.
      endMealCookSession(id)
      invalidateAfterConfirm()
      // Issue #621 — the server may have refused some rows. `?.` because the
      // page tests' mocks resolve `undefined`.
      const skippedNames = skippedDeductionNames(
        proposal ?? { matches: [] },
        res?.deductions_skipped ?? [],
      )
      const hasSkipped = skippedNames.names.length + skippedNames.unnamed > 0
      setSkipped(skippedNames)
      setErrorKind(undefined)
      setSheetState('success')
      // Review N2 — a confirm that resolves after this page has unmounted
      // (the user navigated away another way while it was in flight) must
      // not schedule a redirect against it. Issue #621: with a skipped
      // notice showing, no redirect at all — the sheet's Back to meal
      // (`handleSheetBackToMeal`) is the way on.
      if (mountedRef.current && !hasSkipped) {
        redirectTimerRef.current = setTimeout(() => {
          router.push(`/meals/${id}`)
        }, 1200)
      }
    } catch (err) {
      if (err instanceof MealCookError && err.kind === 'confirm_in_progress') {
        if (isRetryOfInProgress) {
          confirmingRef.current = false
          setErrorKind('confirm_incomplete')
          setErrorMessage(copyForErrorKind('confirm_incomplete', ''))
          setSheetState('error')
          return
        }
        // Review N2 — same guard for the retry: an unmounted page must not
        // schedule the automatic retry either.
        if (mountedRef.current) {
          waitTimerRef.current = setTimeout(() => {
            doConfirm(deductions, true)
          }, 2000)
        }
        return
      }
      confirmingRef.current = false
      if (err instanceof MealCookError && err.kind) {
        setErrorKind(err.kind)
        setErrorMessage(copyForErrorKind(err.kind, err.message))
      } else {
        setErrorKind(undefined)
        setErrorMessage(err instanceof Error ? err.message : 'Failed to confirm the meal cook')
      }
      setSheetState('error')
    }
  }

  function handleConfirm(deductions: DeductionItem[]) {
    if (confirmingRef.current) return
    if (!session) return
    // The two-tab checkpoint (mirrors CookModal.tsx): re-check right before
    // the network call that actually deducts, not just when the sheet
    // opened — and compare `cook_id`, not just the meal id (review S1). A
    // same-meal re-cook (this cook was ended, then a fresh one started
    // elsewhere) is "ended elsewhere" too: sending this tab's stale
    // `cook_ref` would either `replay_applied`-end the new cook mid-way (if
    // it hasn't confirmed yet) or double-deduct (if it already has).
    // `getActiveMealCookSession` already returns `null` for a genuinely
    // ended session, so this one comparison covers both cases.
    const active = getActiveMealCookSession(id)
    if (active?.cook_id !== session.cook_id) {
      setSheetOpen(false)
      router.push(`/meals/${id}`)
      return
    }
    confirmingRef.current = true
    lastDeductionsRef.current = deductions
    setSkipped({ names: [], unnamed: 0 })
    setErrorStage('confirm')
    setSheetState('confirming')
    doConfirm(deductions, false)
  }

  function handleRetry() {
    if (errorStage === 'load') {
      handleMarkCooked()
    } else {
      handleConfirm(lastDeductionsRef.current)
    }
  }

  /**
   * The sheet's "Back to meal" — only shown for `dish_mismatch` /
   * `confirm_incomplete` (never `confirm_in_progress`, §5). A `dish_mismatch`
   * leaves the session active, so the meal screen's stale notice can explain
   * it; `confirm_incomplete` ends it, since the confirm may have partly
   * landed.
   */
  function handleSheetBackToMeal() {
    if (errorKind === 'dish_mismatch') {
      queryClient.invalidateQueries({ queryKey: ['meal', id] })
      router.push(`/meals/${id}`)
      return
    }
    endMealCookSession(id)
    queryClient.invalidateQueries({ queryKey: ['pantry'] })
    queryClient.invalidateQueries({ queryKey: ['meal', id] })
    queryClient.invalidateQueries({ queryKey: ['meals'] })
    queryClient.invalidateQueries({ queryKey: ['inbox-entries'] })
    router.push(`/meals/${id}`)
  }

  function handleSheetClose() {
    setSheetOpen(false)
  }

  // Nit 6 — auto-open the sheet the first time this mount's stream evaluates
  // as finished, but ONLY when the session was already finished at restore
  // (returning to a finished cook means "finish up"). A live finish this
  // mount (the last Done tapped here) leaves the sheet closed — the user
  // taps Mark meal as cooked.
  useEffect(() => {
    if (autoOpenedRef.current) return
    if (!stream || stream.now.kind !== 'finished') return
    if (!wasFinishedAtRestoreRef.current) return
    autoOpenedRef.current = true
    if (canDeduct) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleMarkCooked()
    }
  }, [stream, canDeduct, handleMarkCooked])

  // Both timers are one-shots owned entirely by this page's confirm flow —
  // cleared on unmount so a stale wait/redirect never fires against an
  // unmounted component (e.g. the user navigated away by another route).
  useEffect(() => {
    return () => {
      if (waitTimerRef.current) clearTimeout(waitTimerRef.current)
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current)
    }
  }, [])

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

  // Issue #654 PR B — re-derived every render so a stacked amendment (or a
  // live servings change) is reflected the next time the overlay reads it;
  // `undefined` when the pinned dish is no longer in the meal, which also
  // guards the overlay's mount condition below.
  const askPinDish = askPin ? dishByRecipeId.get(askPin.dishId) : undefined

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
          <MealCookFinished
            mealTitle={meal.title}
            skippedDishTitles={skippedDishTitles}
            canDeduct={canDeduct}
            onMarkCooked={handleMarkCooked}
            onFinishWithoutPantry={handleFinishWithoutPantry}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <MealNowCard
              card={stream.now}
              clockLabel={clockLabel}
              onDone={handleDone}
              onExtend={handleExtend}
              onSkip={handleSkip}
              onStartEarly={handleStartEarly}
              onAskBubbles={handleAskBubbles}
            />
            {/* A waiting card already lists what's running, and has nothing
                next to preview: rendering either here would repeat it (PR #661 review). */}
            {stream.now.kind !== 'waiting' && (
              <>
                <MealRunningStrip steps={stream.running} clockLabel={clockLabel} />
                <MealNextUp step={stream.next_up} clockLabel={clockLabel} />
              </>
            )}
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

      <MealCookSheet
        open={sheetOpen}
        mealTitle={meal.title}
        state={sheetState}
        proposal={proposal}
        errorMessage={errorMessage}
        errorKind={errorKind}
        onConfirm={handleConfirm}
        onRetry={handleRetry}
        onBackToMeal={handleSheetBackToMeal}
        onClose={handleSheetClose}
        skipped={skipped}
      />

      {/* Issue #654 PR B (§3) — the per-dish Ask Bubbles overlay, mounted
          only while pinned to a dish still in the meal and the cook isn't
          finished. */}
      <AnimatePresence>
        {askPin && askPinDish && stream.now.kind !== 'finished' && (
          <motion.div
            key="ask-bubbles-meal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <AskBubblesOverlay
              stepN={askPin.stepN}
              stepText={askPin.stepText}
              recipeTitle={askPin.dishTitle}
              onClose={() => setAskPin(null)}
              pinned={{
                recipe_id: askPin.dishId,
                title: askPin.dishTitle,
                ingredients: pinnedIngredientsForDish(askPinDish, meal.servings, session),
              }}
              onApplyAmendment={handleApplyAmendment}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}
