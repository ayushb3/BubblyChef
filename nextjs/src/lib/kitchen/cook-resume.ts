/**
 * What the Bubbles card says about a cook left mid-recipe (issue #755): a cook
 * session on record plus the recipe or meal it belongs to, as a `CookResume`
 * ("Back to the lemon pasta? You were on step 4 of 7").
 *
 * Pure: the session comes from `lib/cook-session.ts` / `lib/meal-cook-session.ts`
 * (which already refuse an ended session and defend against corrupt storage) and
 * the recipe or meal from the existing fetches; this only puts them in words.
 */
import type { ActiveCookSession } from '@/lib/cook-session'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { MealCookSession } from '@/lib/meal-cook-session'
import { dishStepSignaturesForMeal, schedulerDishesForMeal } from '@/lib/meal-dishes'
import { isStaleMealCookSession } from '@/lib/meal-cook-session'
import type { CookResume } from '@/lib/kitchen/home-card'
import type { Meal } from '@/types/meals'

/**
 * A guided recipe cook. The guided flow stores a 0-based step index, -1 being the
 * optional prep screen, so "step N" is index + 1, held between the first step and
 * the last. `null` when the session is for a different recipe.
 */
export function recipeCookResume(
  session: ActiveCookSession,
  recipe: Pick<Recipe, 'id' | 'title' | 'instructions'>,
): CookResume | null {
  if (session.recipeId !== recipe.id) return null
  const total = recipe.instructions.length
  const step = Math.max(1, session.step + 1)
  return {
    kind: 'recipe',
    id: recipe.id,
    title: recipe.title,
    step: total > 0 ? Math.min(step, total) : step,
    totalSteps: total,
  }
}

/**
 * A meal cook-along. The step is how many steps across all the dishes are behind
 * you (done or skipped) plus one. `null` when the session is for another meal or
 * is stale (a dish was swapped or its steps changed): the meal screen owns that
 * case ("This meal changed since you started cooking"), not the card.
 */
export function mealCookResume(session: MealCookSession, meal: Meal): CookResume | null {
  if (session.meal_id !== meal.id) return null
  const dishes = schedulerDishesForMeal(meal)
  const dishIds = dishes.map((d) => d.dish_id)
  if (isStaleMealCookSession(session, dishIds, dishStepSignaturesForMeal(meal))) return null

  const keys = dishes.flatMap((d) => d.steps.map((_, i) => `${d.dish_id}:${i}`))
  const behind = keys.filter((k) => {
    const status = session.steps[k]?.status
    return status === 'done' || status === 'skipped'
  }).length
  const total = keys.length
  return {
    kind: 'meal',
    id: meal.id,
    title: meal.title,
    step: total > 0 ? Math.min(behind + 1, total) : behind + 1,
    totalSteps: total,
  }
}
