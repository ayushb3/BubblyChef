'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import RecipeBook from '@/components/recipes/RecipeBook'
import MealsList from '@/components/recipes/MealsList'
import { type Recipe } from '@/components/recipes/RecipePage'

type LibraryTab = 'recipes' | 'meals'

export default function RecipeBookLoader() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  // Library "Meals" filter (issue #650 / spec #647) — a top-level tab rather
  // than folded into RecipeBook's own page-turn/sidebar UI, so meals get
  // their own simple list without touching RecipeBook's already-intricate
  // paging state.
  // `?tab=meals` opens on the Meals tab — where deleting a meal lands the user
  // (issue #675). Anything else keeps the default.
  const initialTab: LibraryTab = useSearchParams().get('tab') === 'meals' ? 'meals' : 'recipes'
  const [tab, setTab] = useState<LibraryTab>(initialTab)

  useEffect(() => {
    fetch('/api/recipes')
      .then((r) => r.json())
      .then((data) => {
        setRecipes(data.recipes ?? [])
      })
      .catch(() => {
        setRecipes([])
      })
      .finally(() => setLoading(false))
  }, [refreshKey])

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Library"
        className="flex gap-2 w-full max-w-md mx-auto px-2"
      >
        {(['recipes', 'meals'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="font-sans px-4 py-1.5 rounded-full text-sm font-bold transition-colors"
            style={{
              background: tab === t ? 'var(--color-primary)' : 'var(--color-surface)',
              color: tab === t ? 'var(--color-on-primary)' : 'var(--color-muted)',
              border: tab === t ? 'none' : '1px solid var(--color-border)',
            }}
          >
            {t === 'recipes' ? '📖 Recipes' : '🍽️ Meals'}
          </button>
        ))}
      </div>

      {tab === 'meals' ? (
        <MealsList />
      ) : loading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
          <span className="text-4xl animate-bounce">📖</span>
          <p className="font-sans text-sm text-[var(--color-muted)]">
            Opening your recipe book…
          </p>
        </div>
      ) : (
        <RecipeBook recipes={recipes} onMutate={() => { setLoading(true); setRefreshKey(k => k + 1) }} />
      )}
    </div>
  )
}
