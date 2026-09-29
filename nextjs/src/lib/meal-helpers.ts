/**
 * Server-side helpers shared by the meals CRUD routes (issue #650 / spec
 * #647 "Meal schema", "API contracts"). Kept out of the route files so
 * `GET /api/meals/[id]` and the post-create fetch in `POST /api/meals` build
 * the same `Meal` shape from one place.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Meal, MealConstraints, MealSummary } from '@/types/meals'

/** Always this shape on the wire, regardless of what the caller sent. */
export function normalizeConstraints(raw: unknown): MealConstraints {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<MealConstraints>
  return {
    kitchen_limits: Array.isArray(c.kitchen_limits)
      ? c.kitchen_limits.filter((s): s is string => typeof s === 'string')
      : [],
    exclusive_tags: Array.isArray(c.exclusive_tags)
      ? c.exclusive_tags.filter((s): s is string => typeof s === 'string')
      : [],
    recipe_constraints:
      c.recipe_constraints && typeof c.recipe_constraints === 'object'
        ? c.recipe_constraints
        : {},
  }
}

/**
 * A meal needs exactly one main (at position 0) and one or two sides (at
 * positions 1-2), matching the DB's own CHECK/unique constraints
 * (`supabase/migrations/00013_meals.sql`). Returns an error message, or
 * `null` when the set is valid.
 */
export function validateMealDishRoles(
  dishes: Array<{ role: string; position: number }>,
): string | null {
  if (dishes.some((d) => d.role !== 'main' && d.role !== 'side')) {
    return 'Each dish role must be "main" or "side".'
  }
  const mains = dishes.filter((d) => d.role === 'main')
  const sides = dishes.filter((d) => d.role === 'side')
  if (mains.length !== 1) return 'A meal needs exactly one main.'
  if (sides.length < 1 || sides.length > 2) return 'A meal needs one or two sides.'
  const positions = dishes.map((d) => d.position)
  if (new Set(positions).size !== positions.length) return 'Dish positions must be unique.'
  if (mains[0].position !== 0) return 'The main must be at position 0.'
  if (sides.some((s) => s.position < 1 || s.position > 2)) {
    return 'Sides must be at position 1 or 2.'
  }
  return null
}

/**
 * Load one meal, scoped to `userId`, with every dish's full recipe row
 * (`GET /api/meals/[id]`'s shape, and what `POST /api/meals` returns).
 * Returns `null` when the meal doesn't exist or isn't owned by this user.
 */
export async function fetchFullMeal(
  supabase: SupabaseClient,
  userId: string,
  mealId: string,
): Promise<Meal | null> {
  const { data: meal, error } = await supabase
    .from('meals')
    .select('*')
    .eq('id', mealId)
    .eq('user_id', userId)
    .single()

  if (error || !meal) return null

  const { data: dishes, error: dishesError } = await supabase
    .from('meal_dishes')
    .select('role, position, recipe_id, recipes(*)')
    .eq('meal_id', mealId)
    .eq('user_id', userId)
    .order('position', { ascending: true })

  if (dishesError) return null

  return {
    ...meal,
    dishes: (dishes ?? []).map((d: Record<string, unknown>) => ({
      role: d.role,
      position: d.position,
      recipe: d.recipes,
    })),
  } as Meal
}

/**
 * Flattens a recipe row's nested `meal_dishes(meals(title))` selection
 * (issue #650) into a plain `meal_titles: string[]` field, deduplicated —
 * what `RecipeDeleteConfirm` shows so the confirmation names the meals a
 * recipe belongs to before the user deletes it. A recipe not in any meal
 * gets `meal_titles: []`, not an absent field, so callers never need to
 * guard against undefined.
 */
export function withMealTitles<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'meal_dishes'> & { meal_titles: string[] } {
  const { meal_dishes, ...rest } = row as T & { meal_dishes?: unknown }
  const rawDishes = Array.isArray(meal_dishes) ? meal_dishes : []
  const titles = rawDishes
    .map((d) => (d as { meals?: { title?: string } | null }).meals?.title)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
  return { ...rest, meal_titles: Array.from(new Set(titles)) }
}

/**
 * List saved (or draft) meals for `GET /api/meals` — the summary shape from
 * the contract: `{ id, title, servings, is_draft, dishes: [{ role, position,
 * recipe_id, title, total_time_minutes }] }`. No full recipe rows.
 */
export async function fetchMealSummaries(
  supabase: SupabaseClient,
  userId: string,
  drafts: boolean,
): Promise<MealSummary[]> {
  const { data, error } = await supabase
    .from('meals')
    .select('id, title, servings, is_draft, meal_dishes(role, position, recipe_id, recipes(title, total_time_minutes))')
    .eq('user_id', userId)
    .eq('is_draft', drafts)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((m: Record<string, unknown>) => {
    const rawDishes = (m.meal_dishes as Array<Record<string, unknown>> | null) ?? []
    return {
      id: m.id as string,
      title: m.title as string,
      servings: m.servings as number,
      is_draft: m.is_draft as boolean,
      dishes: rawDishes
        .slice()
        .sort((a, b) => (a.position as number) - (b.position as number))
        .map((d) => {
          const recipe = d.recipes as Record<string, unknown> | null
          return {
            role: d.role,
            position: d.position,
            recipe_id: d.recipe_id,
            title: recipe?.title ?? '',
            total_time_minutes: recipe?.total_time_minutes ?? null,
          }
        }),
    } as MealSummary
  })
}
