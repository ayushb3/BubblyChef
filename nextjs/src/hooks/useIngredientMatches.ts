'use client'

/**
 * `useIngredientMatches(ingredients)` — how the caller's pantry covers a
 * recipe's ingredient lines, for the food tags (issue #784). Deterministic and
 * read-only on the AI service, so it is asked for on every view of a recipe.
 *
 * Returns `undefined` while loading and when the call fails: the lines then
 * render without tags, never an error and never a guess.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchIngredientMatches, type IngredientLineInput } from '@/lib/api/ingredient-match'
import { ingredientParts } from '@/lib/recipe-helpers'
import type { IngredientMatch, RecipeIngredient } from '@/types/recipes'

/** Recipe ingredient elements as match lines: blank rows dropped, order kept. */
function toLines(ingredients: (string | RecipeIngredient)[]): IngredientLineInput[] {
  const lines: IngredientLineInput[] = []
  for (const ing of ingredients) {
    const { name } = ingredientParts(ing)
    if (!name) continue
    lines.push(
      typeof ing === 'string' ? ing.trim() : { name, quantity: ing.quantity, unit: ing.unit },
    )
  }
  return lines
}

export function useIngredientMatches(
  ingredients: (string | RecipeIngredient)[],
): IngredientMatch[] | undefined {
  const lines = toLines(ingredients)
  const { data } = useQuery({
    queryKey: ['ingredient-matches', lines],
    queryFn: () => fetchIngredientMatches(lines),
    enabled: lines.length > 0,
    retry: false,
    staleTime: 30_000,
  })
  return data
}
