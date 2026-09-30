/**
 * Issues #489 + #490 — pure helpers for a confirmed mid-cook amendment on the
 * single-recipe cook (the chat page's "Update what I'm cooking" card). No I/O:
 * the persisted record lives in `lib/cook-session.ts`.
 *
 * The amended list is the meal cook-along's per-dish amendment (#654) in the
 * same `MealCookIngredient` shape, cleaned by the same
 * `sanitizeMealCookIngredients`, so a single-recipe cook and a meal dish mean
 * the same thing by "what was cooked".
 */

import type { RecipeAmendmentProposal } from '@/types/chat'
import type { MealCookIngredient } from '@/types/meals'
import type { RecipeIngredient } from '@/types/recipes'
import { sanitizeMealCookIngredients } from '@/lib/meal-cook-deduction'

/**
 * The cook list a proposal's `amended_ingredients` mean: blank-named lines
 * dropped (the backend allows one, and a nameless line could never match the
 * pantry), non-finite quantities nulled.
 */
export function amendedLinesFromProposal(proposal: RecipeAmendmentProposal): MealCookIngredient[] {
  return sanitizeMealCookIngredients(proposal.amended_ingredients).filter(
    (ing): ing is MealCookIngredient => typeof ing !== 'string',
  )
}

/**
 * An amended list shown as recipe ingredients (the banner count, the guided
 * flow's prep list). Only what a recipe ingredient carries: `notes` belongs to
 * the amendment card, not the ingredient row.
 */
export function toRecipeIngredients(list: MealCookIngredient[]): RecipeIngredient[] {
  return list.map((ing) => ({
    name: ing.name,
    quantity: ing.quantity ?? null,
    unit: ing.unit ?? null,
    ...(typeof ing.optional === 'boolean' ? { optional: ing.optional } : {}),
  }))
}
