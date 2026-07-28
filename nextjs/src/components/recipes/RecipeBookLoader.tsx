'use client'

import { useState, useEffect } from 'react'
import RecipeBook from '@/components/recipes/RecipeBook'
import { type Recipe } from '@/components/recipes/RecipePage'

export default function RecipeBookLoader() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // Reset `loading` for a refetch during render rather than in the effect
  // below (React docs: "Adjusting state when a prop changes"). `loading`
  // already starts `true` for the initial mount fetch, so this only fires on
  // a genuine `refreshKey` bump from `onMutate` — no setState-in-effect needed.
  const [trackedRefreshKey, setTrackedRefreshKey] = useState(refreshKey)
  if (refreshKey !== trackedRefreshKey) {
    setTrackedRefreshKey(refreshKey)
    setLoading(true)
  }

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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
        <span className="text-4xl animate-bounce">📖</span>
        <p className="text-sm text-[var(--color-muted)]" style={{ fontFamily: 'Nunito, sans-serif' }}>
          Opening your recipe book…
        </p>
      </div>
    )
  }

  return <RecipeBook recipes={recipes} onMutate={() => setRefreshKey(k => k + 1)} />
}
