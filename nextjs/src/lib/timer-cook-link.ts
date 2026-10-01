/**
 * Where a timer chip in the dock leads back to (issue #848).
 *
 * A meal cook-along records the dock timer each of its steps started
 * (`timer_id`), so those chips link to that meal's cook page exactly. A recipe's
 * guided cook does not record its timers, so while a recipe is mid-cook, any
 * other timer links to that recipe's cook (the same route the Home card's "Pick
 * up" uses). A timer with no cook behind it (a quick-set "Pasta 10 min" with no
 * cook on record) has no link. Pure: the sessions are passed in.
 */
import type { ActiveCookSession } from '@/lib/cook-session'
import type { MealCookSession } from '@/lib/meal-cook-session'

export function timerCookHref(
  timerId: string,
  meal: Pick<MealCookSession, 'meal_id' | 'steps'> | null,
  recipe: Pick<ActiveCookSession, 'recipeId'> | null,
): string | null {
  if (meal && Object.values(meal.steps).some((rec) => rec.timer_id === timerId)) {
    return `/meals/${meal.meal_id}/cook`
  }
  if (recipe) return `/recipes?resume=${recipe.recipeId}`
  return null
}
