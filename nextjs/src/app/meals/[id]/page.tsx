'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import BubblesMascot from '@/components/ui/BubblesMascot'
import FadeInView from '@/components/ui/FadeInView'
import SpringButton from '@/components/ui/SpringButton'
import { fetchMeal, updateMeal } from '@/lib/api/meals'
import { scaledIngredientLabel } from '@/lib/recipe-helpers'
import type { MealDishFull } from '@/types/meals'

/**
 * Minimal meal page (issue #650 / spec #647 "Chat and meal UI") — title,
 * servings, and the dishes with their roles, each linking to its own recipe
 * page. The full meal screen with the cook-along timeline lands on this same
 * route in a later ticket.
 */
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

  const handleServingsChange = (delta: number) => {
    if (!meal) return
    const next = meal.servings + delta
    if (next < 1) return
    servingsMutation.mutate(next)
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

  return (
    <main
      className="min-h-screen pb-24"
      style={{ background: 'var(--color-bg)', fontFamily: 'Nunito, sans-serif' }}
    >
      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* Header row */}
        <FadeInView>
          <div className="flex items-start justify-between gap-4 mb-5">
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
          <h1 className="text-3xl font-extrabold leading-tight mb-3" style={{ color: 'var(--color-text)' }}>
            {meal.title}
          </h1>
        </FadeInView>

        {/* Servings stepper */}
        <FadeInView delay={0.08}>
          <div className="flex items-center gap-3 mb-6">
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
                disabled={servingsMutation.isPending}
                className="w-7 h-7 rounded-full flex items-center justify-center font-bold disabled:opacity-40"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}
              >
                +
              </button>
            </div>
          </div>
        </FadeInView>

        {/* Dishes */}
        <div className="flex flex-col gap-4">
          {meal.dishes
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((dish) => (
              <DishCard key={dish.recipe.id} dish={dish} mealServings={meal.servings} />
            ))}
        </div>
      </div>
    </main>
  )
}

function DishCard({ dish, mealServings }: { dish: MealDishFull; mealServings: number }) {
  const recipeServings = dish.recipe.servings && dish.recipe.servings > 0 ? dish.recipe.servings : mealServings
  const scale = recipeServings > 0 ? mealServings / recipeServings : 1

  return (
    <FadeInView>
      <section
        className="rounded-3xl p-4"
        style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            {dish.role}
          </span>
        </div>
        <Link
          href={`/recipes/${encodeURIComponent(dish.recipe.id)}`}
          className="text-lg font-extrabold leading-tight hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-text)' }}
        >
          {dish.recipe.title}
        </Link>
        {dish.recipe.ingredients.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {dish.recipe.ingredients.map((ing, i) => (
              <li key={i} className="text-sm" style={{ color: 'var(--color-text)' }}>
                {scaledIngredientLabel(ing, scale)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </FadeInView>
  )
}
