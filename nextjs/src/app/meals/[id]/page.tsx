'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import SpringButton from '@/components/ui/SpringButton'
import MealDishCard from '@/components/meal/MealDishCard'
import MealTimelineTable, { timelineNotes } from '@/components/meal/MealTimelineTable'
import ServeAtControl, { type ServeAtMode } from '@/components/meal/ServeAtControl'
import SideAlternativesRow from '@/components/meal/SideAlternativesRow'
import {
  fetchMeal,
  updateMeal,
  fetchSideAlternatives,
  expandMealDish,
  toNewDishRecipePayload,
  type SideAlternativeOutline,
} from '@/lib/api/meals'
import { ensureSteps } from '@/lib/api/recipes'
import { scaledIngredients } from '@/lib/recipe-helpers'
import { scheduleMeal } from '@/lib/meal-scheduler'
import { resolveMealAnchor } from '@/lib/meal-anchor'
import { columnFor, fallbackSteps, schedulerDishesForMeal } from '@/lib/meal-dishes'
import {
  getActiveMealCookSession,
  startMealCookSession,
  clearActiveMealCookSession,
  isStaleMealCookSession,
} from '@/lib/meal-cook-session'
import { timerIdsToDismiss } from '@/lib/meal-cook-stream'
import { useCookingTimers } from '@/lib/useCookingTimers'
import type { Meal, MealDishFull } from '@/types/meals'

/**
 * The full meal screen (issue #652 / spec #647 "The meal screen"), replacing
 * the minimal page from issue #650. Everything but the serve-at time comes
 * from `GET /api/meals/[id]` (React Query) — the timeline is recomputed with
 * `useMemo` from the meal on every render and never stored, so a reload
 * always reproduces it exactly.
 */

type RowTarget = { kind: 'swap'; position: 1 | 2 } | { kind: 'add' }

interface RowUiState {
  target: RowTarget
  state: 'loading' | 'error' | 'ready'
  alternatives: SideAlternativeOutline[]
  pendingIndex: number | null
  errorMessage?: string
  /**
   * Set only when the *last* failure was an expand/persist for a specific
   * card (not the initial alternatives fetch) — so Retry re-attempts that
   * exact card instead of re-fetching the whole list (issue #652 review).
   */
  retryIndex?: number
}

function nextFreeSidePosition(meal: Meal): 1 | 2 {
  const used = new Set(meal.dishes.filter((d) => d.role === 'side').map((d) => d.position))
  return used.has(1) ? 2 : 1
}

/** The recipe id currently at `position` — the optimistic-concurrency guard sent as `expected_recipe_id`. */
function dishRecipeIdAt(meal: Meal, position: number): string | undefined {
  return meal.dishes.find((d) => d.position === position)?.recipe.id
}

function defaultServeAtInput(now: Date): string {
  const in90 = new Date(now.getTime() + 90 * 60_000)
  return `${String(in90.getHours()).padStart(2, '0')}:${String(in90.getMinutes()).padStart(2, '0')}`
}

export default function MealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { dismiss: dismissTimer } = useCookingTimers()
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : ''

  const { data: meal, isLoading, isError } = useQuery({
    queryKey: ['meal', id],
    queryFn: () => fetchMeal(id),
    enabled: Boolean(id),
  })

  // Fixed for the life of this page load, like the #649 demo page — not
  // re-read per render, so the anchor doesn't drift while the screen is open.
  const [now] = useState(() => new Date())
  const [mode, setMode] = useState<ServeAtMode>('start-now')
  const [serveAtInput, setServeAtInput] = useState(() => defaultServeAtInput(now))
  const [row, setRow] = useState<RowUiState | null>(null)
  const [confirmRemovePosition, setConfirmRemovePosition] = useState<number | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // True only while a swap/add's expand-then-PUT is actually persisting —
  // browsing alternatives (loadAlternatives) doesn't set this. Combined with
  // `removeMutation.isPending` below, this is the single "a dish op is in
  // flight" flag that locks every other dish control (issue #652 review) so
  // two dish-mutating ops can never race each other client-side.
  const [pickMutating, setPickMutating] = useState(false)
  // True only while the missing-steps upgrade effect below actually has
  // in-flight `ensureSteps` calls — not "some dish still lacks structured
  // steps forever", which would permanently disable Start cooking for a
  // dish whose upgrade already failed and fell back to estimates (issue
  // #653: "disabled while ... any dish has no steps and is still being
  // upgraded").
  const [stepsUpgrading, setStepsUpgrading] = useState(false)
  const attemptedStepsRef = useRef<Set<string>>(new Set())
  // Bumped on every new loadAlternatives/cancel so a stale async result
  // (an alternatives fetch, or a pick's expand+PUT) can tell it's been
  // superseded and skip its `setRow` — otherwise a slow response could land
  // after the user cancelled and opened a *different* row, clobbering it.
  const rowOpIdRef = useRef(0)

  const servingsMutation = useMutation({
    mutationFn: (servings: number) => updateMeal(id, { servings }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['meal', id], updated)
    },
  })

  const promoteMutation = useMutation({
    mutationFn: () => updateMeal(id, { promote: true }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['meal', id], updated)
      queryClient.invalidateQueries({ queryKey: ['bubbles'] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (payload: { position: number; expectedRecipeId?: string }) =>
      updateMeal(id, {
        remove_side: { position: payload.position, expected_recipe_id: payload.expectedRecipeId },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['meal', id], updated)
      setConfirmRemovePosition(null)
      setRemoveError(null)
    },
    onError: (err) => {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove that side.')
    },
  })

  const dishOpInFlight = pickMutating || removeMutation.isPending

  // Fallback for missing steps (issue #648 / #652): any dish recipe with no
  // structured steps is upgraded through `ensureSteps` when the screen
  // opens; the meal is refetched whenever something was actually derived —
  // unconditionally, even if this effect instance has since been
  // "cancelled" (React 18 StrictMode mounts, cleans up, and re-mounts
  // effects once in dev; gating the invalidation on a `cancelled` flag set
  // by that synthetic cleanup meant it never fired in StrictMode, since the
  // cleanup runs before the `await ensureSteps(...)` below ever resolves).
  // `attemptedStepsRef` is what actually prevents double-calling a given
  // recipe id — it persists across the StrictMode remount since refs (unlike
  // the synthetic mount/unmount) aren't reset by it.
  useEffect(() => {
    if (!meal) return
    const missing = meal.dishes.filter(
      (d) => !d.recipe.steps && !attemptedStepsRef.current.has(d.recipe.id),
    )
    if (missing.length === 0) return

    setStepsUpgrading(true)
    ;(async () => {
      let anyDerived = false
      for (const dish of missing) {
        attemptedStepsRef.current.add(dish.recipe.id)
        try {
          const result = await ensureSteps(dish.recipe.id)
          if (result.derived) anyDerived = true
        } catch {
          // Best-effort: this dish renders via fallbackSteps + the
          // "estimates" note until (if ever) a later attempt succeeds.
        }
      }
      if (anyDerived) {
        queryClient.invalidateQueries({ queryKey: ['meal', id] })
      }
      setStepsUpgrading(false)
    })()
  }, [meal, id, queryClient])

  const dishesSorted = useMemo(
    () => (meal ? meal.dishes.slice().sort((a, b) => a.position - b.position) : []),
    [meal],
  )

  const schedulerDishes = useMemo(() => (meal ? schedulerDishesForMeal(meal) : []), [meal])

  const timeline = useMemo(
    () =>
      scheduleMeal({
        dishes: schedulerDishes,
        constraints: { exclusive_tags: meal?.constraints.exclusive_tags ?? [] },
      }),
    [schedulerDishes, meal],
  )

  const columns = useMemo(
    () => dishesSorted.map((d) => ({ column: columnFor(d.position), title: d.recipe.title })),
    [dishesSorted],
  )

  // Cook-along entry (issue #653). `dishIds` mirrors what `startMealCookSession`
  // stores and what `isStaleMealCookSession` compares against — position-
  // ordered recipe ids, the same shape the cook route restores dishes from.
  const dishIds = useMemo(() => dishesSorted.map((d) => d.recipe.id), [dishesSorted])
  // Recomputed from `meal` (not "checked once on mount"): a swap/remove on
  // *this* page can turn a previously-resumable session stale while it's
  // still open, and the banner should reflect that without a reload.
  const activeCookSession = useMemo(() => (meal ? getActiveMealCookSession(meal.id) : null), [meal])
  const cookSessionIsStale = useMemo(
    () => (activeCookSession ? isStaleMealCookSession(activeCookSession, dishIds) : false),
    [activeCookSession, dishIds],
  )

  const serveAt = useMemo(() => {
    if (mode !== 'serve-at') return undefined
    const [h, m] = serveAtInput.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return undefined
    const d = new Date(now)
    d.setHours(h, m, 0, 0)
    // An "HH:MM" earlier than `now` means tomorrow, not "already passed
    // today" (issue #652 review) — e.g. typing, or "Use <earliest>"
    // offering, "00:30" at 23:00. Minute granularity, not raw ms: `now`
    // carries seconds the input can't express, so a same-minute
    // reconstruction (a few seconds "before" `now`) must not roll over.
    const dMinute = Math.floor(d.getTime() / 60_000)
    const nowMinute = Math.floor(now.getTime() / 60_000)
    if (dMinute < nowMinute) {
      d.setDate(d.getDate() + 1)
    }
    return d
  }, [mode, serveAtInput, now])

  const anchor = resolveMealAnchor({
    mode,
    total_minutes: timeline.total_minutes,
    now,
    serve_at: serveAt,
  })

  const handleServingsChange = (delta: number) => {
    if (!meal) return
    const next = meal.servings + delta
    // Same bounds `PUT /api/meals/[id]` enforces.
    if (next < 1 || next > 100) return
    servingsMutation.mutate(next)
  }

  function handleStartCooking() {
    if (!meal) return
    startMealCookSession(meal.id, dishIds, Date.now())
    router.push(`/meals/${meal.id}/cook`)
  }

  function handleResumeCooking() {
    if (!meal) return
    router.push(`/meals/${meal.id}/cook`)
  }

  /**
   * "Start over" from either the Resume banner or the stale notice: per the
   * contract, dismiss the old session's still-running dock timers first (an
   * orphaned timer would otherwise sit in the dock forever, tied to a step
   * that no longer exists once a fresh session starts), then clear and begin
   * fresh.
   */
  function handleStartOverCooking() {
    if (!meal) return
    if (activeCookSession) {
      for (const timerId of timerIdsToDismiss(activeCookSession)) dismissTimer(timerId)
    }
    clearActiveMealCookSession(meal.id)
    startMealCookSession(meal.id, dishIds, Date.now())
    router.push(`/meals/${meal.id}/cook`)
  }

  async function loadAlternatives(target: RowTarget) {
    if (dishOpInFlight) return
    const opId = ++rowOpIdRef.current
    setRow({ target, state: 'loading', alternatives: [], pendingIndex: null })
    try {
      const position = target.kind === 'swap' ? target.position : undefined
      const alternatives = await fetchSideAlternatives({ meal_id: id, position })
      if (rowOpIdRef.current !== opId) return // superseded by a newer row
      setRow({ target, state: 'ready', alternatives, pendingIndex: null })
    } catch (err) {
      if (rowOpIdRef.current !== opId) return
      setRow({
        target,
        state: 'error',
        alternatives: [],
        pendingIndex: null,
        errorMessage: err instanceof Error ? err.message : "Couldn't load alternatives.",
      })
    }
  }

  async function handlePick(index: number) {
    if (!row || !meal) return
    if (row.pendingIndex != null || dishOpInFlight) return // already mid-pick, or another op owns the lock
    const alt = row.alternatives[index]
    const target = row.target
    const opId = rowOpIdRef.current
    setRow({ ...row, state: 'ready', pendingIndex: index, errorMessage: undefined, retryIndex: undefined })
    setPickMutating(true)
    const position = target.kind === 'swap' ? target.position : nextFreeSidePosition(meal)
    const expectedRecipeId = target.kind === 'swap' ? dishRecipeIdAt(meal, target.position) : undefined

    try {
      const expanded = await expandMealDish({
        meal_id: id,
        position,
        outline: {
          role: 'side',
          name: alt.name,
          key_ingredients: alt.key_ingredients,
          est_total_minutes: alt.est_total_minutes,
          est_hands_on_minutes: alt.est_hands_on_minutes,
        },
      })
      const recipe = toNewDishRecipePayload(expanded.recipe, alt.name)

      const updated =
        target.kind === 'swap'
          ? await updateMeal(id, {
              replace_dish: { position, recipe, expected_recipe_id: expectedRecipeId },
            })
          : await updateMeal(id, { add_side: { recipe } })

      queryClient.setQueryData(['meal', id], updated)
      if (rowOpIdRef.current === opId) setRow(null)
    } catch (err) {
      if (rowOpIdRef.current === opId) {
        setRow({
          target,
          state: 'error',
          alternatives: row.alternatives,
          pendingIndex: null,
          errorMessage: err instanceof Error ? err.message : "Couldn't build that dish.",
          retryIndex: index,
        })
      }
    } finally {
      setPickMutating(false)
    }
  }

  function handleRetryRow() {
    if (!row) return
    if (row.retryIndex != null) {
      handlePick(row.retryIndex)
    } else {
      loadAlternatives(row.target)
    }
  }

  function handleCancelRow() {
    if (dishOpInFlight) return // can't abort an expand/PUT already in flight — the button no-ops until it settles
    rowOpIdRef.current++ // invalidate any still-in-flight alternatives fetch
    setRow(null)
  }

  function handleRequestRemove(position: number) {
    setRemoveError(null)
    setConfirmRemovePosition(position)
  }

  function handleCancelRemove() {
    setConfirmRemovePosition(null)
    setRemoveError(null)
  }

  function handleConfirmRemove(position: number) {
    // The confirm can be open when a swap starts elsewhere; one dish op at a time.
    if (!meal || dishOpInFlight) return
    removeMutation.mutate({ position, expectedRecipeId: dishRecipeIdAt(meal, position) })
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
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
          Loading meal...
        </p>
      </main>
    )
  }

  // ── Error / 404 state ──────────────────────────────────────────────────────
  if (isError || !meal) {
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
        <p
          className="text-sm text-center"
          style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
        >
          This meal doesn&apos;t exist or was deleted.
        </p>
        <Link
          href="/recipes"
          className="mt-2 px-6 py-2 rounded-full font-bold text-white text-sm"
          style={{ background: 'var(--color-primary)', fontFamily: 'Nunito, sans-serif' }}
        >
          Back to Recipes
        </Link>
      </main>
    )
  }

  const sideCount = meal.dishes.filter((d) => d.role === 'side').length

  return (
    <main
      className="min-h-screen pb-24"
      style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}
    >
      <div className="max-w-2xl mx-auto px-4 pt-6 flex flex-col gap-6">
        {/* Header row */}
        <FadeInView>
          <div className="flex items-start justify-between gap-4">
            <button
              onClick={() => router.push('/recipes')}
              className="flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-70 active:scale-95 flex-shrink-0 mt-1"
              style={{ color: 'var(--color-muted)' }}
            >
              <span aria-hidden>←</span>
              <span>Recipes</span>
            </button>

            {meal.is_draft && (
              <SpringButton
                className="px-4 py-2 rounded-full text-sm font-bold text-white active:scale-95 disabled:opacity-60"
                style={{ background: 'var(--color-primary)' } as React.CSSProperties}
                onClick={() => promoteMutation.mutate()}
                disabled={promoteMutation.isPending || promoteMutation.isSuccess}
              >
                {promoteMutation.isPending
                  ? 'Saving…'
                  : promoteMutation.isSuccess
                  ? '✓ Saved!'
                  : 'Save meal'}
              </SpringButton>
            )}
          </div>
        </FadeInView>

        {/* Title */}
        <FadeInView delay={0.05}>
          <h1 className="text-3xl font-extrabold leading-tight" style={{ color: 'var(--color-text)' }}>
            {meal.title}
          </h1>
        </FadeInView>

        {/* Servings stepper */}
        <FadeInView delay={0.08}>
          <div className="flex items-center gap-3">
            <span
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: 'var(--color-muted)' }}
            >
              Servings
            </span>
            <div
              className="flex items-center gap-3 rounded-full px-2 py-1"
              style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
            >
              <button
                type="button"
                aria-label="Decrease servings"
                onClick={() => handleServingsChange(-1)}
                disabled={servingsMutation.isPending || meal.servings <= 1}
                className="w-7 h-7 rounded-full flex items-center justify-center font-bold disabled:opacity-40"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}
              >
                −
              </button>
              <span
                data-testid="meal-servings-value"
                className="w-6 text-center text-sm font-extrabold"
                style={{ color: 'var(--color-text)' }}
              >
                {meal.servings}
              </span>
              <button
                type="button"
                aria-label="Increase servings"
                onClick={() => handleServingsChange(1)}
                disabled={servingsMutation.isPending || meal.servings >= 100}
                className="w-7 h-7 rounded-full flex items-center justify-center font-bold disabled:opacity-40"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}
              >
                +
              </button>
            </div>
          </div>
        </FadeInView>

        {/* Serve-at / start-now */}
        <FadeInView delay={0.1}>
          <ServeAtControl
            mode={mode}
            serveAt={serveAtInput}
            anchor={anchor}
            onModeChange={setMode}
            onServeAtChange={setServeAtInput}
            totalMinutes={timeline.total_minutes}
          />
        </FadeInView>

        {/* Timeline */}
        <FadeInView delay={0.12}>
          <div className="flex flex-col gap-2">
            <h2
              className="text-xs font-bold uppercase tracking-wide"
              style={{ color: 'var(--color-muted)' }}
            >
              Timeline — {timeline.total_minutes} min total, {timeline.hands_on_minutes} min hands-on
            </h2>
            {timeline.warnings.length > 0 && (
              <p
                className="text-xs"
                style={{ color: 'var(--color-primary-dark)' }}
                data-testid="meal-timeline-warnings"
              >
                {timelineNotes(timeline).join(' ')}
              </p>
            )}
            <MealTimelineTable timeline={timeline} columns={columns} anchor={anchor} />
          </div>
        </FadeInView>

        {/* Cook-along entry (issue #653) */}
        <FadeInView delay={0.14}>
          {!activeCookSession && (
            <SpringButton
              className="w-full py-3 rounded-full text-sm font-bold text-white active:scale-95 disabled:opacity-60"
              style={{ background: 'var(--color-primary)' } as React.CSSProperties}
              onClick={handleStartCooking}
              disabled={dishOpInFlight || stepsUpgrading}
              title="Start cooking"
            >
              🍳 Start cooking
            </SpringButton>
          )}
          {activeCookSession && !cookSessionIsStale && (
            <div
              className="rounded-2xl p-4 flex items-center justify-between gap-3"
              style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
              data-testid="meal-cook-resume-banner"
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Resume cooking?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResumeCooking}
                  className="min-h-[44px] px-4 rounded-full text-sm font-bold"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={handleStartOverCooking}
                  className="min-h-[44px] px-3 rounded-full text-sm font-bold"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Start over
                </button>
              </div>
            </div>
          )}
          {activeCookSession && cookSessionIsStale && (
            <div
              className="rounded-2xl p-4 flex items-center justify-between gap-3"
              style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
              role="status"
              data-testid="meal-cook-stale-banner"
            >
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                This meal changed since you started cooking.
              </p>
              <button
                type="button"
                onClick={handleStartOverCooking}
                className="min-h-[44px] px-4 rounded-full text-sm font-bold"
                style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
              >
                Start over
              </button>
            </div>
          )}
        </FadeInView>

        {/* Dishes */}
        <div className="flex flex-col gap-4">
          {dishesSorted.map((dish) => (
            <DishSection
              key={dish.recipe.id}
              dish={dish}
              mealServings={meal.servings}
              sideCount={sideCount}
              row={row}
              confirmRemovePosition={confirmRemovePosition}
              removeError={removeError}
              removePending={removeMutation.isPending}
              controlsDisabled={dishOpInFlight}
              onSwap={() => loadAlternatives({ kind: 'swap', position: dish.position as 1 | 2 })}
              onRequestRemove={() => handleRequestRemove(dish.position)}
              onCancelRemove={handleCancelRemove}
              onConfirmRemove={() => handleConfirmRemove(dish.position)}
              onPick={handlePick}
              onRetryRow={handleRetryRow}
              onCancelRow={handleCancelRow}
            />
          ))}
        </div>

        {sideCount === 1 && (
          <FadeInView>
            <div className="flex flex-col gap-2">
              {!row && (
                <button
                  type="button"
                  onClick={() => loadAlternatives({ kind: 'add' })}
                  disabled={dishOpInFlight}
                  className="self-start min-h-[44px] px-4 rounded-full text-sm font-bold disabled:opacity-40"
                  style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  + Add a side
                </button>
              )}
              {row && row.target.kind === 'add' && (
                <SideAlternativesRow
                  state={row.state}
                  alternatives={row.alternatives}
                  pendingIndex={row.pendingIndex}
                  errorMessage={row.errorMessage}
                  onPick={handlePick}
                  onRetry={handleRetryRow}
                  onCancel={handleCancelRow}
                />
              )}
            </div>
          </FadeInView>
        )}
      </div>
    </main>
  )
}

function DishSection({
  dish,
  mealServings,
  sideCount,
  row,
  confirmRemovePosition,
  removeError,
  removePending,
  controlsDisabled,
  onSwap,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
  onPick,
  onRetryRow,
  onCancelRow,
}: {
  dish: MealDishFull
  mealServings: number
  sideCount: number
  row: RowUiState | null
  confirmRemovePosition: number | null
  removeError: string | null
  removePending: boolean
  /** True while any dish op (a pick's expand+PUT, or a remove) is committing — locks Swap/Remove/Add/Cancel everywhere. */
  controlsDisabled: boolean
  onSwap: () => void
  onRequestRemove: () => void
  onCancelRemove: () => void
  onConfirmRemove: () => void
  onPick: (index: number) => void
  onRetryRow: () => void
  onCancelRow: () => void
}) {
  const recipeServings = dish.recipe.servings && dish.recipe.servings > 0 ? dish.recipe.servings : mealServings
  const scale = recipeServings > 0 ? mealServings / recipeServings : 1
  const stepsEstimated = !dish.recipe.steps || dish.recipe.steps.length === 0
  const isSide = dish.role === 'side'
  const rowIsHere = row?.target.kind === 'swap' && row.target.position === dish.position
  const removeIsHere = confirmRemovePosition === dish.position

  return (
    <FadeInView>
      <div className="flex flex-col gap-2">
        <MealDishCard
          role={dish.role}
          title={dish.recipe.title}
          href={`/recipes/${dish.recipe.id}`}
          ingredients={scaledIngredients(dish.recipe.ingredients, scale)}
          instructions={dish.recipe.instructions}
          steps={dish.recipe.steps ?? fallbackSteps(dish.recipe.instructions)}
          stepsEstimated={stepsEstimated}
          actions={
            isSide ? (
              <>
                <button
                  type="button"
                  onClick={onSwap}
                  disabled={controlsDisabled}
                  className="min-h-[44px] px-3 rounded-full text-xs font-bold disabled:opacity-40"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  Swap
                </button>
                {sideCount === 2 && (
                  <button
                    type="button"
                    onClick={onRequestRemove}
                    disabled={controlsDisabled}
                    className="min-h-[44px] px-3 rounded-full text-xs font-bold disabled:opacity-40"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Remove
                  </button>
                )}
              </>
            ) : undefined
          }
        />

        {removeIsHere && (
          <div
            className="rounded-2xl p-3 flex flex-col gap-2"
            style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
            role="alertdialog"
            aria-label={`Remove ${dish.recipe.title}?`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                Remove this side?
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancelRemove}
                  disabled={removePending}
                  className="min-h-[44px] px-3 rounded-full text-xs font-bold disabled:opacity-40"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirmRemove}
                  // controlsDisabled covers a pending remove and any swap/add in flight.
                  disabled={controlsDisabled}
                  className="min-h-[44px] px-4 rounded-full text-xs font-bold text-white disabled:opacity-60"
                  style={{ background: 'var(--color-coral, #ff9aa2)' }}
                >
                  {removePending ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
            {removeError && (
              <p className="text-xs" role="alert" style={{ color: 'var(--color-coral, #ff9aa2)' }}>
                {removeError}
              </p>
            )}
          </div>
        )}

        {rowIsHere && row && (
          <SideAlternativesRow
            state={row.state}
            alternatives={row.alternatives}
            pendingIndex={row.pendingIndex}
            errorMessage={row.errorMessage}
            onPick={onPick}
            onRetry={onRetryRow}
            onCancel={onCancelRow}
          />
        )}
      </div>
    </FadeInView>
  )
}
