'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import RecipeCard from '@/components/recipes/RecipeCard'
import EmptyState from '@/components/ui/EmptyState'
import RecipeSearchBar from '@/components/recipes/RecipeSearchBar'
import { fetchMeals } from '@/lib/api/meals'
import { searchMeals } from '@/lib/recipe-search'

interface MealsListProps {
  /** The Meals tab's own search query (issue #904), held by the library so it outlives a tab switch. */
  query?: string
  onQueryChange: (query: string) => void
}

/**
 * The library's "Meals" filter (issue #650 / spec #647 "Chat and meal UI") —
 * lists saved meals (never drafts; `fetchMeals()`'s default). Tapping one
 * opens the minimal meal page.
 */
export default function MealsList({ query = '', onQueryChange }: MealsListProps) {
  const router = useRouter()

  const { data: meals, isLoading } = useQuery({
    queryKey: ['meals', { drafts: false }],
    queryFn: () => fetchMeals(),
  })

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
        <span className="text-4xl animate-bounce">🍽️</span>
        <p className="font-sans text-sm text-[var(--color-muted)]">
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
        subline="Ask Bubbly what's for dinner, and save a meal to see it here."
        ctaLabel="Chat with Bubbly"
        ctaEmoji="💬"
        onCta={() => router.push('/chat')}
      />
    )
  }

  // Search runs over every meal the list loaded, by meal title and dish titles.
  const shown = searchMeals(meals, query)

  return (
    <div className="flex flex-col gap-3">
      <div className="px-2">
        <RecipeSearchBar
          onSearch={onQueryChange}
          initialValue={query}
          placeholder="Search your meals..."
        />
      </div>

      {shown.length === 0 ? (
        <p className="font-sans py-8 text-center text-sm text-[var(--color-muted)]">
          No results for &ldquo;{query}&rdquo;
        </p>
      ) : (
        <ul className="flex flex-col gap-3 w-full max-w-md mx-auto px-2" role="list" aria-label="Saved meals">
          {shown.map((meal) => (
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
      )}
    </div>
  )
}
