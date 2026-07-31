'use client'

import { useState, useEffect } from 'react'
import RecipeBook from '@/components/recipes/RecipeBook'
import { type Recipe } from '@/components/recipes/RecipePage'

export default function RecipeBookLoader() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

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

  return <RecipeBook recipes={recipes} onMutate={() => { setLoading(true); setRefreshKey(k => k + 1) }} />
}
