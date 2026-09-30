/**
 * Pure helpers for the chat-to-meal flow (issue #650 / spec #647), kept out
 * of `app/chat/page.tsx` so they're testable without the component tree —
 * same rationale as `lib/chat-chips.ts`.
 */

import type {
  ChatRecipeData,
  MealFixedMainContext,
  MealFixedMainRecipe,
  MealProposal,
} from '@/types/chat'
import type { CreateMealDish, CreateMealRequest } from '@/types/meals'

/**
 * The in-chat recipe as `context.meal_fixed_main.recipe` (issue #651 PR B).
 * Copies only the fields `MealFixedMainRecipe` lists, so `ingredient_availability`
 * and any `id` never reach the wire. Ingredients with a blank name are dropped;
 * a missing title becomes 'Untitled recipe' and missing lists become `[]`.
 */
export function fixedMainPayload(recipe: ChatRecipeData): MealFixedMainRecipe {
  const ingredients: MealFixedMainRecipe['ingredients'] = []
  for (const ing of recipe.ingredients ?? []) {
    if (!ing.name || ing.name.trim() === '') continue
    ingredients.push({
      name: ing.name,
      ...(ing.quantity !== undefined ? { quantity: ing.quantity } : {}),
      ...(ing.unit !== undefined ? { unit: ing.unit } : {}),
      ...(ing.preparation !== undefined ? { preparation: ing.preparation } : {}),
      ...(ing.optional !== undefined ? { optional: ing.optional } : {}),
    })
  }

  return {
    title: recipe.title?.trim() || 'Untitled recipe',
    ...(recipe.description !== undefined ? { description: recipe.description } : {}),
    ingredients,
    instructions: recipe.instructions ?? [],
    ...(recipe.steps !== undefined ? { steps: recipe.steps } : {}),
    ...(recipe.prep_time_minutes !== undefined
      ? { prep_time_minutes: recipe.prep_time_minutes }
      : {}),
    ...(recipe.cook_time_minutes !== undefined
      ? { cook_time_minutes: recipe.cook_time_minutes }
      : {}),
    ...(recipe.total_time_minutes !== undefined
      ? { total_time_minutes: recipe.total_time_minutes }
      : {}),
    ...(recipe.servings !== undefined ? { servings: recipe.servings } : {}),
    ...(recipe.cuisine !== undefined ? { cuisine: recipe.cuisine } : {}),
    ...(recipe.meal_type !== undefined ? { meal_type: recipe.meal_type } : {}),
    ...(recipe.difficulty !== undefined ? { difficulty: recipe.difficulty } : {}),
    ...(recipe.dietary_tags !== undefined ? { dietary_tags: recipe.dietary_tags } : {}),
  }
}

/**
 * `context.meal_fixed_main` for a chat card: `{ recipe_id }` when `savedId` is
 * a non-empty string (the card's own Save succeeded, so the row is non-draft),
 * otherwise the recipe as a payload.
 */
export function fixedMainForCard(
  recipe: ChatRecipeData,
  savedId?: string | null,
): MealFixedMainContext {
  return savedId ? { recipe_id: savedId } : { recipe: fixedMainPayload(recipe) }
}

/**
 * Build the `POST /api/meals` payload from a `meal` proposal's dishes. Every
 * generated dish is sent as a new recipe payload. A fixed saved main (issue
 * #651 PR B) carries `recipe_id` and is sent as a reference, which
 * `POST /api/meals` links without copying.
 */
export function buildCreateMealPayload(
  proposal: MealProposal,
  isDraft: boolean,
): CreateMealRequest {
  const dishes: CreateMealDish[] = proposal.dishes.map((dish) => {
    if (dish.recipe_id) {
      return { role: dish.role, position: dish.position, recipe_id: dish.recipe_id }
    }
    return {
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
    }
  })

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
