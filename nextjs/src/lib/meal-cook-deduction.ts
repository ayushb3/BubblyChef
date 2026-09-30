/**
 * Issue #654 §3 — pure helpers that turn a meal cook-along session into the
 * request `POST /api/ai/meals/cook` (and its confirm) actually send. No I/O,
 * no framework — same discipline as `lib/meal-cook-stream.ts` and
 * `lib/meal-scheduler.ts`.
 */

import type { SchedulerDish } from '@/lib/meal-scheduler'
import type { Meal, MealDishFull } from '@/types/meals'
import type { MealCookDishRequest, MealCookIngredient, MealCookRequest } from '@/types/meals'
import { readDishAmendment, type MealCookSession } from '@/lib/meal-cook-session'

/** The server's `max_length` on `MealCookDishRequest.ingredients` (§2a). */
const MAX_INGREDIENTS = 100

/** The meal screen's own rule (`app/meals/[id]/page.tsx`:725-726): a recipe with no servings borrows the meal's. */
export function recipeServingsFor(dish: MealDishFull, mealServings: number): number {
  return dish.recipe.servings && dish.recipe.servings > 0 ? dish.recipe.servings : mealServings
}

/**
 * The dish ids (= recipe ids) that count as cooked (S9): a dish is NOT
 * cooked only when it has at least one step and every one of them is
 * `skipped`. A dish with no structured steps and no fallback steps either
 * (no `instructions`) has zero steps and always counts as cooked — there's
 * nothing to have skipped. A partial skip changes nothing: any dish with at
 * least one non-skipped step (done, running, or still pending) counts as
 * cooked.
 */
export function cookedDishIds(dishes: SchedulerDish[], session: MealCookSession): string[] {
  return dishes
    .filter((dish) => {
      if (dish.steps.length === 0) return true
      return !dish.steps.every((_, i) => session.steps[`${dish.dish_id}:${i}`]?.status === 'skipped')
    })
    .map((dish) => dish.dish_id)
}

/**
 * Drops anything that isn't a usable ingredient element (S5) so the request
 * never 422s on a malformed stored recipe: keeps non-blank strings and
 * objects with a non-blank string `name`; a non-finite `quantity` (`NaN`,
 * `Infinity`, a string) becomes `null`; at most `MAX_INGREDIENTS` elements,
 * keeping the first.
 */
function sanitizeMealCookIngredients(raw: unknown[]): (string | MealCookIngredient)[] {
  const cleaned: (string | MealCookIngredient)[] = []

  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim() !== '') cleaned.push(item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const ing = item as Record<string, unknown>
    if (typeof ing.name !== 'string' || ing.name.trim() === '') continue

    const quantity =
      typeof ing.quantity === 'number' && Number.isFinite(ing.quantity) ? ing.quantity : null
    cleaned.push({
      name: ing.name,
      quantity,
      unit: typeof ing.unit === 'string' ? ing.unit : null,
      ...(typeof ing.optional === 'boolean' ? { optional: ing.optional } : {}),
      ...(typeof ing.notes === 'string' ? { notes: ing.notes } : {}),
    })
  }

  return cleaned.slice(0, MAX_INGREDIENTS)
}

/**
 * Scales a numeric `quantity` by `factor`, rounded to 2 dp — only when
 * `factor` isn't 1 (Nit 2), so an unscaled dish's quantities pass through
 * exactly as stored rather than picking up spurious rounding.
 */
function scaleQuantity<T extends { quantity?: number | null }>(ing: T, factor: number): T {
  if (factor === 1 || typeof ing.quantity !== 'number') return ing
  return { ...ing, quantity: Math.round(ing.quantity * factor * 100) / 100 }
}

/**
 * The ingredient list (and `string_scale`) `dish` cooks with, at meal scale
 * (§2a, §3):
 *
 * - **With a valid amendment** (`readDishAmendment` non-null): its objects,
 *   rescaled by `mealServings / amendment.servings` when that isn't 1.
 * - **Otherwise:** the recipe's own ingredients. Objects get the meal-screen
 *   factor on `quantity` (`preparation` dropped); strings stay strings,
 *   unscaled — the server scales them with `string_scale`, since scaling a
 *   string client-side would mean re-implementing `_parse_ingredient_string`
 *   in TypeScript and drifting from it.
 *
 * Either list is sanitized (S5) before it's returned.
 */
export function cookedIngredientsForDish(
  dish: MealDishFull,
  mealServings: number,
  session: MealCookSession,
): { ingredients: (string | MealCookIngredient)[]; string_scale: number } {
  const recipeServings = recipeServingsFor(dish, mealServings)
  const string_scale = recipeServings > 0 ? mealServings / recipeServings : 1

  const amendment = readDishAmendment(session, dish.recipe.id)

  let raw: unknown[]
  if (amendment) {
    const factor = amendment.servings > 0 ? mealServings / amendment.servings : 1
    raw = amendment.ingredients.map((ing) => scaleQuantity(ing, factor))
  } else {
    raw = dish.recipe.ingredients.map((ing) => {
      if (typeof ing === 'string') return ing
      const { preparation: _preparation, ...rest } = ing
      return scaleQuantity(rest, string_scale)
    })
  }

  return { ingredients: sanitizeMealCookIngredients(raw), string_scale }
}

/**
 * The full `POST /api/ai/meals/cook` (and confirm) request body for `meal`,
 * as cooked in `session` against `dishes` (the scheduler shape carrying each
 * dish's steps). `null` when no dish was cooked (S9) — every dish's every
 * step was skipped.
 */
export function buildMealCookRequest(
  meal: Meal,
  session: MealCookSession,
  dishes: SchedulerDish[],
): MealCookRequest | null {
  const cooked = cookedDishIds(dishes, session)
  if (cooked.length === 0) return null

  const dishByRecipeId = new Map(meal.dishes.map((d) => [d.recipe.id, d]))

  const requestDishes: MealCookDishRequest[] = cooked
    .map((recipeId) => dishByRecipeId.get(recipeId))
    .filter((d): d is MealDishFull => d !== undefined)
    .map((dish) => {
      const { ingredients, string_scale } = cookedIngredientsForDish(dish, meal.servings, session)
      return { recipe_id: dish.recipe.id, ingredients, string_scale }
    })

  if (requestDishes.length === 0) return null

  return { meal_id: meal.id, servings: meal.servings, dishes: requestDishes }
}
