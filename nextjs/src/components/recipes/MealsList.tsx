'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import RecipeCard from '@/components/recipes/RecipeCard'
import EmptyState from '@/components/ui/EmptyState'
import { fetchMeals } from '@/lib/api/meals'

/**
 * The library's "Meals" filter (issue #650 / spec #647 "Chat and meal UI") —
 * lists saved meals (never drafts; `fetchMeals()`'s default). Tapping one
 * opens the minimal meal page.
 */
export default function MealsList() {
  const router = useRouter()

  const { data: meals, isLoading } = useQuery({
    queryKey: ['meals', { drafts: false }],
    queryFn: () => fetchMeals(),
  })

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
        <span className="text-4xl animate-bounce">🍽️</span>
        <p className="text-sm text-[var(--color-muted)]" style={{ fontFamily: 'Nunito, sans-serif' }}>
          Loading your meals…
        </p>
      </div>
    )
  }

  if (!meals || meals.length === 0) {
    return (
      <EmptyState
        mascotState="surprised"
        headerLabel="Meals"
        headline="No saved meals yet"
        subline="Ask Chef Bubbly what's for dinner, and save a meal to see it here."
        ctaLabel="Chat with Bubbles"
        ctaEmoji="💬"
        onCta={() => router.push('/chat')}
      />
    )
  }

  return (
    <ul className="flex flex-col gap-3 w-full max-w-md mx-auto px-2" role="list" aria-label="Saved meals">
      {meals.map((meal) => (
        <li key={meal.id}>
          <RecipeCard
            variant="compact"
            href={`/meals/${meal.id}`}
            title={meal.title}
            dishes={meal.dishes.map((d) => d.title).filter((t): t is string => Boolean(t))}
            servings={meal.servings}
          />
        </li>
      ))}
    </ul>
  )
}
