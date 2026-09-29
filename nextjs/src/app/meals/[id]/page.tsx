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
import { scheduleMeal, type Column, type SchedulerDish } from '@/lib/meal-scheduler'
import { resolveMealAnchor } from '@/lib/meal-anchor'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Meal, MealDishFull } from '@/types/meals'
import type { Step } from '@/types/recipes'

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
}

function columnFor(position: number): Column {
  if (position === 0) return 'main'
  return position === 1 ? 'side_1' : 'side_2'
}

/**
 * A dish recipe with no structured steps (the `ensure` call in the effect
 * below either hasn't run yet or failed) is scheduled as sequential 3-min
 * estimates built from `instructions` — the scheduler's own
 * `estimated_duration` path, with an explicit dependency chain so the steps
 * run in order rather than however the scheduler would otherwise interleave
 * unrelated steps.
 */
function fallbackSteps(instructions: Recipe['instructions']): Step[] {
  return instructions.map((instr, i) => {
    const text = typeof instr === 'string' ? instr : instr.text ?? instr.step ?? ''
    return {
      text,
      label: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      ongoing_label: null,
      duration_minutes: 3,
      duration_estimated: true,
      hands_on: true,
      depends_on: i > 0 ? [i - 1] : [],
      exclusive: [],
    }
  })
}

function nextFreeSidePosition(meal: Meal): 1 | 2 {
  const used = new Set(meal.dishes.filter((d) => d.role === 'side').map((d) => d.position))
  return used.has(1) ? 2 : 1
}

function defaultServeAtInput(now: Date): string {
  const in90 = new Date(now.getTime() + 90 * 60_000)
  return `${String(in90.getHours()).padStart(2, '0')}:${String(in90.getMinutes()).padStart(2, '0')}`
}

export default function MealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
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
  const attemptedStepsRef = useRef<Set<string>>(new Set())

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

  // Fallback for missing steps (issue #648 / #652): any dish recipe with no
  // structured steps is upgraded through `ensureSteps` when the screen
  // opens; the meal is refetched only if something was actually derived.
  // `attemptedStepsRef` makes each recipe id eligible exactly once per
  // mount, so a recipe whose ensure call fails renders via `fallbackSteps`
  // instead of being retried on every render.
  useEffect(() => {
    if (!meal) return
    const missing = meal.dishes.filter(
      (d) => !d.recipe.steps && !attemptedStepsRef.current.has(d.recipe.id),
    )
    if (missing.length === 0) return

    let cancelled = false
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
      if (!cancelled && anyDerived) {
        queryClient.invalidateQueries({ queryKey: ['meal', id] })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [meal, id, queryClient])

  const dishesSorted = useMemo(
    () => (meal ? meal.dishes.slice().sort((a, b) => a.position - b.position) : []),
    [meal],
  )

  const schedulerDishes: SchedulerDish[] = useMemo(
    () =>
      dishesSorted.map((d) => ({
        dish_id: d.recipe.id,
        column: columnFor(d.position),
        title: d.recipe.title,
        steps:
          d.recipe.steps && d.recipe.steps.length > 0
            ? d.recipe.steps
            : fallbackSteps(d.recipe.instructions),
      })),
    [dishesSorted],
  )

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

  const serveAt = useMemo(() => {
    if (mode !== 'serve-at') return undefined
    const [h, m] = serveAtInput.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return undefined
    const d = new Date(now)
    d.setHours(h, m, 0, 0)
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

  async function loadAlternatives(target: RowTarget) {
    setRow({ target, state: 'loading', alternatives: [], pendingIndex: null })
    try {
      const position = target.kind === 'swap' ? target.position : undefined
      const alternatives = await fetchSideAlternatives({ meal_id: id, position })
      setRow({ target, state: 'ready', alternatives, pendingIndex: null })
    } catch (err) {
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
    if (!row || row.state !== 'ready' || !meal) return
    const alt = row.alternatives[index]
    const target = row.target
    setRow({ ...row, pendingIndex: index })
    const position = target.kind === 'swap' ? target.position : nextFreeSidePosition(meal)

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

      if (target.kind === 'swap') {
        await updateMeal(id, { replace_dish: { position, recipe } })
      } else {
        await updateMeal(id, { add_side: { recipe } })
      }
      await queryClient.invalidateQueries({ queryKey: ['meal', id] })
      setRow(null)
    } catch (err) {
      setRow({
        target,
        state: 'error',
        alternatives: row.alternatives,
        pendingIndex: null,
        errorMessage: err instanceof Error ? err.message : "Couldn't build that dish.",
      })
    }
  }

  async function handleRemoveConfirmed(position: number) {
    setConfirmRemovePosition(null)
    await updateMeal(id, { remove_side: { position } })
    await queryClient.invalidateQueries({ queryKey: ['meal', id] })
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
              onSwap={() => loadAlternatives({ kind: 'swap', position: dish.position as 1 | 2 })}
              onRequestRemove={() => setConfirmRemovePosition(dish.position)}
              onCancelRemove={() => setConfirmRemovePosition(null)}
              onConfirmRemove={() => handleRemoveConfirmed(dish.position)}
              onPick={handlePick}
              onRetryRow={() => row && loadAlternatives(row.target)}
              onCancelRow={() => setRow(null)}
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
                  className="self-start min-h-[44px] px-4 rounded-full text-sm font-bold"
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
                  onRetry={() => loadAlternatives(row.target)}
                  onCancel={() => setRow(null)}
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

  return (
    <FadeInView>
      <div className="flex flex-col gap-2">
        <MealDishCard
          role={dish.role}
          title={dish.recipe.title}
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
                  className="min-h-[44px] px-3 rounded-full text-xs font-bold"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  Swap
                </button>
                {sideCount === 2 && (
                  <button
                    type="button"
                    onClick={onRequestRemove}
                    className="min-h-[44px] px-3 rounded-full text-xs font-bold"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Remove
                  </button>
                )}
              </>
            ) : undefined
          }
        />

        {confirmRemovePosition === dish.position && (
          <div
            className="rounded-2xl p-3 flex items-center justify-between gap-3"
            style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
            role="alertdialog"
            aria-label={`Remove ${dish.recipe.title}?`}
          >
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Remove this side?
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancelRemove}
                className="min-h-[44px] px-3 rounded-full text-xs font-bold"
                style={{ color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmRemove}
                className="min-h-[44px] px-4 rounded-full text-xs font-bold text-white"
                style={{ background: 'var(--color-coral, #ff9aa2)' }}
              >
                Remove
              </button>
            </div>
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
