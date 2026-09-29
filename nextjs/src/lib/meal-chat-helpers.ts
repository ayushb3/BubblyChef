/**
 * Pure helpers for the chat-to-meal flow (issue #650 / spec #647), kept out
 * of `app/chat/page.tsx` so they're testable without the component tree —
 * same rationale as `lib/chat-chips.ts`.
 */

import type { MealProposal } from '@/types/chat'
import type { CreateMealDish, CreateMealRequest } from '@/types/meals'

/**
 * Build the `POST /api/meals` payload from a `meal` proposal's dishes. Every
 * dish at pick time is a freshly generated recipe (issue #650's contract:
 * "Dishes are expanded concurrently... a full RecipeCard... per dish") —
 * none carries an existing recipe id yet, so every dish is sent as a new
 * recipe payload, never a `recipe_id` reference.
 */
export function buildCreateMealPayload(
  proposal: MealProposal,
  isDraft: boolean,
): CreateMealRequest {
  const dishes: CreateMealDish[] = proposal.dishes.map((dish) => ({
    role: dish.role,
    position: dish.position,
    recipe: {
      title: dish.recipe.title ?? 'Untitled dish',
      description: dish.recipe.description,
      ingredients: dish.recipe.ingredients,
      instructions: dish.recipe.instructions,
      steps: dish.recipe.steps,
      cuisine: dish.recipe.cuisine,
      meal_type: dish.recipe.meal_type,
      dietary_tags: dish.recipe.dietary_tags,
      difficulty: dish.recipe.difficulty,
      prep_time_minutes: dish.recipe.prep_time_minutes,
      cook_time_minutes: dish.recipe.cook_time_minutes,
      total_time_minutes: dish.recipe.total_time_minutes,
      servings: dish.recipe.servings ?? proposal.servings,
    },
  }))

  return {
    title: proposal.title,
    servings: proposal.servings,
    constraints: proposal.constraints,
    is_draft: isDraft,
    source_type: 'chat',
    // Proposals restored from history before `meal_ref` existed have none;
    // they fall back to the per-mount guard in `app/chat/page.tsx`.
    ...(proposal.meal_ref ? { source_ref: proposal.meal_ref } : {}),
    dishes,
  }
}
