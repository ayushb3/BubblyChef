'use client'

/**
 * `useIngredientMatches(ingredients)` — how the caller's pantry covers a
 * recipe's ingredient lines, for the food tags (issue #784). Deterministic and
 * read-only on the AI service, so it is asked for on every view of a recipe.
 *
 * The result is aligned to `ingredients` BY ROW, not by name: entry `i` is the
 * match for `ingredients[i]` (`null` for a blank row that was never sent). Two
 * lines of one food ("2 eggs" and "1 egg") therefore each carry their own
 * status; looking up by name would hand both the first line's.
 *
 * Returns `undefined` while loading and when the call fails: the lines then
 * render without tags, never an error and never a guess.
 *
 * The query key sits under `['pantry']`, so every pantry mutation that already
 * invalidates the pantry (add, edit, delete, cook confirm) refreshes the tags.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchIngredientMatches, type IngredientLineInput } from '@/lib/api/ingredient-match'
import { ingredientParts } from '@/lib/recipe-helpers'
import type { IngredientMatch, RecipeIngredient } from '@/types/recipes'

/** One match per ingredient row (`null` where the row had nothing to look up). */
export type RowMatches = (IngredientMatch | null)[]

/** The lines to send (blank rows dropped) and the row each one came from. */
export function toLines(ingredients: (string | RecipeIngredient)[]): {
  lines: IngredientLineInput[]
  rows: number[]
} {
  const lines: IngredientLineInput[] = []
  const rows: number[] = []
  ingredients.forEach((ing, row) => {
    const { name } = ingredientParts(ing)
    if (!name) return
    lines.push(
      typeof ing === 'string' ? ing.trim() : { name, quantity: ing.quantity, unit: ing.unit },
    )
    rows.push(row)
  })
  return { lines, rows }
}

/** Put each match back on the row it was asked for. */
export function alignToRows(
  matches: IngredientMatch[],
  rows: number[],
  rowCount: number,
): RowMatches {
  const out: RowMatches = Array.from({ length: rowCount }, () => null)
  matches.forEach((m, k) => {
    out[rows[k]] = m
  })
  return out
}

export function useIngredientMatches(
  ingredients: (string | RecipeIngredient)[],
): RowMatches | undefined {
  const { lines, rows } = toLines(ingredients)
  const { data } = useQuery({
    queryKey: ['pantry', 'ingredient-matches', lines],
    queryFn: () => fetchIngredientMatches(lines),
    enabled: lines.length > 0,
    retry: false,
    staleTime: 30_000,
  })
  const rowCount = ingredients.length
  const rowsKey = rows.join(',')
  return useMemo(
    () => (data ? alignToRows(data, rows, rowCount) : undefined),
    // `rows` is derived from the same ingredients as `data`'s key; rowsKey stands in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, rowsKey, rowCount],
  )
}
