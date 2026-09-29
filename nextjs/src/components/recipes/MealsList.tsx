'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
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
    <ul className="flex flex-col gap-2 w-full max-w-md mx-auto px-2" role="list" aria-label="Saved meals">
      {meals.map((meal) => (
        <li key={meal.id}>
          <Link
            href={`/meals/${meal.id}`}
            className="block rounded-2xl px-4 py-3 transition-colors hover:bg-[var(--color-bg)]"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <p
              className="font-extrabold text-sm"
              style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
            >
              {meal.title}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}>
              {meal.dishes.map((d) => d.title).filter(Boolean).join(' · ') || 'No dishes'}
              {' · '}Serves {meal.servings}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
