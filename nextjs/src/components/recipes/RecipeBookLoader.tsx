'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Heart } from '@phosphor-icons/react'
import RecipeBook from '@/components/recipes/RecipeBook'
import MealsList from '@/components/recipes/MealsList'
import { type Recipe } from '@/components/recipes/RecipePage'
import { fetchAllRecipes } from '@/lib/api/recipes'

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
  const searchParams = useSearchParams()
  const initialTab: LibraryTab = searchParams.get('tab') === 'meals' ? 'meals' : 'recipes'
  // `?resume=<recipe id>` (issue #755): the Bubbles card's "Pick up at step N".
  const resumeRecipeId = searchParams.get('resume')
  const [tab, setTab] = useState<LibraryTab>(initialTab)
  // Each tab keeps its own search query (issue #904), held here because switching
  // tabs unmounts the list; a shared query would leave a filter applied to the
  // other tab's list.
  const [queries, setQueries] = useState<Record<LibraryTab, string>>({ recipes: '', meals: '' })
  const setRecipesQuery = useCallback((q: string) => setQueries((s) => ({ ...s, recipes: q })), [])
  const setMealsQuery = useCallback((q: string) => setQueries((s) => ({ ...s, meals: q })), [])
  // The Favorites heart in the tab row (issue #855, moved from a chip by #904). It
  // narrows the Recipes list; meals have no favorite of their own, so on the Meals
  // tab it is disabled (and shows unpressed) rather than inventing a meaning. The
  // state is kept so coming back to Recipes finds the filter as it was left.
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  const favoritesAvailable = tab === 'recipes' && recipes.length > 0
  const favoritesActive = favoritesAvailable && favoritesOnly

  useEffect(() => {
    // Every page, not the route's default 50 (issue #869) — search and the
    // Favorites filter run client-side over this list.
    fetchAllRecipes()
      .then((all) => {
        setRecipes(all)
      })
      .catch(() => {
        setRecipes([])
      })
      .finally(() => setLoading(false))
  }, [refreshKey])

  return (
    <div className="flex flex-col gap-3">
      <div data-testid="library-toolbar" className="flex items-center gap-2 w-full max-w-md mx-auto px-2">
        <div role="tablist" aria-label="Library" className="flex gap-2">
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
        {/* Not a tab: a square, icon-only keycap, so it reads as a filter on
            whichever list is showing rather than a third page. */}
        <button
          type="button"
          aria-label="Favorites"
          aria-pressed={favoritesActive}
          title={
            favoritesAvailable
              ? favoritesActive
                ? 'Showing favorites only'
                : 'Show favorites only'
              : tab === 'meals'
                ? 'Meals have no favorites'
                : 'No recipes to filter yet'
          }
          disabled={!favoritesAvailable}
          onClick={() => setFavoritesOnly((on) => !on)}
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-[var(--color-text)] shadow-[0_3px_0_var(--color-text)] transition-colors active:translate-y-[2px] active:shadow-[0_1px_0_var(--color-text)] disabled:opacity-40 disabled:shadow-none motion-reduce:transition-none"
          style={{ background: favoritesActive ? 'var(--color-primary)' : 'var(--color-surface)' }}
        >
          <Heart
            size={22}
            weight={favoritesActive ? 'fill' : 'regular'}
            color={favoritesActive ? 'var(--color-coral)' : 'var(--color-text)'}
          />
        </button>
      </div>

      {tab === 'meals' ? (
        <MealsList query={queries.meals} onQueryChange={setMealsQuery} />
      ) : loading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
          <span className="text-4xl animate-bounce">📖</span>
          <p className="font-sans text-sm text-[var(--color-muted)]">
            Opening your recipe book…
          </p>
        </div>
      ) : (
        <RecipeBook recipes={recipes} resumeRecipeId={resumeRecipeId} initialSearch={queries.recipes} favoritesOnly={favoritesOnly} onSearchChange={setRecipesQuery} onMutate={() => { setLoading(true); setRefreshKey(k => k + 1) }} />
      )}
    </div>
  )
}
