/**
 * Recipe tag + ingredient helpers and dashboard utilities.
 *
 * AI-generated recipes carry dietary tags in `dietary_tags`; the DB stores a
 * single `tags` array.  This module provides the canonical merge + dedup so
 * both the API route (server) and any client-side callers use identical logic.
 *
 * It is also the single home for rules that would otherwise be copied across
 * call sites: ingredient-shape handling (see `ingredientParts`) and dashboard
 * recipe selection (see `pickRandomRecipe`).
 */

import type { RecipeIngredient } from '@/types/recipes'

/**
 * Pick one recipe at random from an array.
 *
 * Returns `null` when the array is empty so callers don't need to guard the
 * length themselves.  `HeroHome` (the live dashboard) uses this as the single
 * source of random selection. Issue #168 will replace this with pantry-aware
 * selection.
 */
export function pickRandomRecipe<T>(recipes: T[]): T | null {
  if (recipes.length === 0) return null
  return recipes[Math.floor(Math.random() * recipes.length)]
}

/**
 * Merge two tag arrays and return a deduplicated list.
 *
 * Dedup is case-insensitive: the first occurrence wins, later duplicates
 * (regardless of casing) are dropped.  The relative order of unique tags is
 * preserved — `tags` entries first, then any `dietary_tags` not already
 * present.
 *
 * @param tags         General tags already on the recipe (may be undefined).
 * @param dietaryTags  AI-generated dietary tags (may be undefined).
 * @returns            Deduplicated array written to the `tags` column.
 */
export function mergeTags(
  tags: string[] | undefined | null,
  dietaryTags: string[] | undefined | null,
): string[] {
  const combined = [...(tags ?? []), ...(dietaryTags ?? [])]
  const seen = new Set<string>()
  return combined.filter((tag) => {
    const lower = tag.toLowerCase()
    if (seen.has(lower)) return false
    seen.add(lower)
    return true
  })
}

/** Every part a call site could need from an ingredient list element. */
export interface IngredientParts {
  /** Bare name — lowercase this yourself for a map/lookup key, do not use `label`. */
  name: string
  /** `"<quantity> <unit>"`, or `''` when neither is present (always `''` for a string element). */
  quantityText: string
  /** Full display label — `"<quantity> <unit> <name>"` with missing parts omitted. */
  label: string
  /** Only ever set for the object shape; `null` for strings or when absent. */
  preparation: string | null
  /** Only ever `true` for the object shape; `false` for strings or when absent. */
  optional: boolean
}

/**
 * Break a single ingredient list element into every part a call site could
 * need, regardless of shape.
 *
 * Recipe `ingredients` exist in the DB in two shapes: `RecipeIngredient`
 * objects (written by AI generation and URL import) and plain strings
 * (written by `RecipeEditModal`, which flattens ingredients to a
 * `string[]` on save). Every ingredient list must call this — or the
 * `ingredientLabel()` wrapper below when only the label is needed — instead
 * of hand-rolling a `typeof ing === 'string'` check, so both shapes render
 * correctly everywhere (see issue #315 — the recipe detail page assumed
 * the object shape only and silently rendered blank rows for strings).
 *
 * Behaviour:
 * - `string` input: `name` and `label` are the trimmed string, `quantityText`
 *   is `''`, `preparation` is `null`, `optional` is `false`.
 * - object input: `label` renders as `"<quantity> <unit> <name>"`, omitting
 *   any part that is missing. A `quantity` of `0` is treated as present (only
 *   `null`, `undefined`, and `''` are dropped) — a recipe step that
 *   legitimately calls for "0" of something should not silently lose it.
 *   `preparation` and `optional` pass through as-is (defaulting to `null`
 *   and `false`).
 * - `null`/`undefined`/malformed input (no usable `name`) returns all-empty
 *   defaults rather than throwing, so a single bad element degrades to an
 *   empty row instead of crashing the whole list.
 */
export function ingredientParts(
  ing: string | RecipeIngredient | null | undefined,
): IngredientParts {
  const empty: IngredientParts = { name: '', quantityText: '', label: '', preparation: null, optional: false }

  if (typeof ing === 'string') {
    const trimmed = ing.trim()
    return { name: trimmed, quantityText: '', label: trimmed, preparation: null, optional: false }
  }
  if (ing === null || ing === undefined || typeof ing !== 'object') return empty
  if (typeof ing.name !== 'string' || ing.name.trim() === '') return empty

  const isPresent = (value: unknown): value is string | number =>
    value !== null && value !== undefined && value !== ''

  const quantityText = [ing.quantity, ing.unit].filter(isPresent).join(' ')
  const label = [quantityText, ing.name].filter(isPresent).join(' ')

  return {
    name: ing.name,
    quantityText,
    label,
    preparation: ing.preparation ?? null,
    optional: Boolean(ing.optional),
  }
}

/**
 * Render a single ingredient list element to display text.
 *
 * Thin wrapper over `ingredientParts().label` for the (common) case where
 * only the label is needed — see `ingredientParts` for the full behaviour
 * contract, which this delegates to unchanged.
 */
export function ingredientLabel(
  ing: string | RecipeIngredient | null | undefined,
): string {
  return ingredientParts(ing).label
}
