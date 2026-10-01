/**
 * Server-side helpers shared by the meals CRUD routes (issue #650 / spec
 * #647 "Meal schema", "API contracts"). Kept out of the route files so
 * `GET /api/meals/[id]` and the post-create fetch in `POST /api/meals` build
 * the same `Meal` shape from one place.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { awardBubbles } from '@/lib/bubbles'
import { mergeTags, sanitizeSteps } from '@/lib/recipe-helpers'
import type {
  AddSideOp,
  Meal,
  MealConstraints,
  MealSummary,
  NewDishRecipePayload,
  RemoveSideOp,
  ReplaceDishOp,
} from '@/types/meals'

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
 * A meal needs exactly one main (at position 0) and up to two sides (at
 * positions 1-2; none is valid, issue #758: the planner may offer a main that is
 * already a whole plate), matching the DB's own CHECK/unique constraints
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
  if (sides.length > 2) return 'A meal can have at most two sides.'
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
 * Promotes a meal: `is_draft = false` on the meal and on its draft dish
 * recipes, each promoted recipe earning the same `recipe_save` bubbles a
 * fresh non-draft save does (idempotent by reference via `bubble_events`'
 * unique constraint). Shared by `PUT /api/meals/[id] { promote }` and the
 * idempotent `POST /api/meals` path that finds an existing draft for the
 * same `source_ref`. Returns false when the meal isn't this user's.
 */
export async function promoteMeal(
  supabase: SupabaseClient,
  userId: string,
  mealId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('meals')
    .update({ is_draft: false })
    .eq('id', mealId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return false

  await promoteMealDishes(supabase, userId, mealId)
  return true
}

/** The dish half of `promoteMeal`, for callers that already updated the meal row. */
export async function promoteMealDishes(
  supabase: SupabaseClient,
  userId: string,
  mealId: string,
): Promise<void> {
  const { data: dishRows } = await supabase
    .from('meal_dishes')
    .select('recipe_id')
    .eq('meal_id', mealId)
    .eq('user_id', userId)

  const recipeIds = (dishRows ?? []).map((d) => d.recipe_id as string)
  if (recipeIds.length === 0) return

  const { data: promoted } = await supabase
    .from('recipes')
    .update({ is_draft: false })
    .in('id', recipeIds)
    .eq('user_id', userId)
    .eq('is_draft', true)
    .select('id')

  for (const recipe of promoted ?? []) {
    await awardBubbles(userId, 'recipe_save', recipe.id as string)
  }
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

// ---------------------------------------------------------------------------
// PUT /api/meals/[id] dish operations (issue #652 / spec #647)
// ---------------------------------------------------------------------------

export interface DishOpFailure {
  error: string
  status: number
}

export type DishOpResult = { ok: true } | DishOpFailure

export function isDishOpFailure(result: DishOpResult): result is DishOpFailure {
  return 'error' in result
}

type DishRow = { position: number; role: string; recipe_id: string; recipes: unknown }

/** True when a `meal_dishes` row's joined `recipes(is_draft)` select says the dish recipe is a draft. */
function isDraftRecipe(recipe: unknown): boolean {
  const r = recipe as { is_draft?: boolean } | { is_draft?: boolean }[] | null
  const val = Array.isArray(r) ? r[0]?.is_draft : r?.is_draft
  return val === true
}

/**
 * Inserts one new dish recipe row — the same column set `POST /api/meals`
 * writes for a `{ recipe: NewDishRecipePayload }` dish, factored out so the
 * dish-op helpers below (`replaceDish` / `addSide`) build it identically.
 */
async function insertDishRecipe(
  supabase: SupabaseClient,
  userId: string,
  recipe: NewDishRecipePayload,
  opts: { isDraft: boolean; servingsFallback: number; sourceType?: string },
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id: userId,
      title: recipe.title,
      description: recipe.description ?? null,
      ingredients: recipe.ingredients ?? [],
      instructions: recipe.instructions ?? [],
      steps: sanitizeSteps(recipe.steps, recipe.instructions),
      cuisine: recipe.cuisine ?? null,
      meal_type: recipe.meal_type ?? null,
      tags: mergeTags(undefined, recipe.dietary_tags),
      difficulty: recipe.difficulty ?? null,
      prep_time_minutes: recipe.prep_time_minutes ?? null,
      cook_time_minutes: recipe.cook_time_minutes ?? null,
      total_time_minutes: recipe.total_time_minutes ?? null,
      servings: recipe.servings ?? opts.servingsFallback,
      source_type: opts.sourceType ?? 'chat',
      is_draft: opts.isDraft,
    })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message ?? 'Failed to create dish recipe' }
  return { id: data.id as string }
}

/** The concurrency-guard error shared by `replaceDish` and `removeSide`. */
const CONFLICT_ERROR = { error: 'That side changed since you loaded this meal.', status: 409 } as const

/**
 * `replace_dish`: sides only (contract — position 0, the main, is rejected).
 * Inserts the new recipe first, points the position's `meal_dishes` row at
 * it, then deletes the old recipe if it was a draft (kept if saved) — in
 * that order, so a failed insert never touches the existing dish and a
 * failed re-point cleans up the just-inserted recipe rather than leaving an
 * orphan.
 *
 * `op.expected_recipe_id`, when present, is enforced *at the update itself*
 * (an extra `.eq('recipe_id', ...)`, not just the initial read above it) —
 * the real guard against a concurrent `remove_side` renumbering a different
 * side into this position between this function's read and its write. The
 * update's `.select('id')` is what lets a zero-row result (position no
 * longer exists, or its recipe no longer matches) be told apart from a
 * silent no-op: either way, the just-inserted recipe is cleaned up and this
 * returns 409 rather than reporting success for a write that didn't happen.
 */
export async function replaceDish(
  supabase: SupabaseClient,
  userId: string,
  mealId: string,
  mealIsDraft: boolean,
  mealServings: number,
  op: ReplaceDishOp,
): Promise<DishOpResult> {
  if (op.position !== 1 && op.position !== 2) {
    return { error: 'Only a side can be replaced.', status: 400 }
  }

  const { data: dishes, error: dishesError } = await supabase
    .from('meal_dishes')
    .select('position, role, recipe_id, recipes(is_draft)')
    .eq('meal_id', mealId)
    .eq('user_id', userId)
  if (dishesError) return { error: dishesError.message, status: 500 }

  const target = ((dishes ?? []) as DishRow[]).find((d) => d.position === op.position)
  if (!target) return { error: `No dish at position ${op.position}.`, status: 400 }
  if (op.expected_recipe_id && target.recipe_id !== op.expected_recipe_id) {
    return CONFLICT_ERROR
  }

  const inserted = await insertDishRecipe(supabase, userId, op.recipe, {
    isDraft: mealIsDraft,
    servingsFallback: mealServings,
  })
  if ('error' in inserted) return { error: inserted.error, status: 400 }

  let updateQuery = supabase
    .from('meal_dishes')
    .update({ recipe_id: inserted.id })
    .eq('meal_id', mealId)
    .eq('position', op.position)
    .eq('user_id', userId)
  if (op.expected_recipe_id) updateQuery = updateQuery.eq('recipe_id', op.expected_recipe_id)

  const { data: updatedRows, error: updateError } = await updateQuery.select('id')
  if (updateError) {
    await supabase.from('recipes').delete().eq('id', inserted.id).eq('user_id', userId)
    return { error: updateError.message, status: 500 }
  }
  if (!updatedRows || updatedRows.length === 0) {
    await supabase.from('recipes').delete().eq('id', inserted.id).eq('user_id', userId)
    return CONFLICT_ERROR
  }

  if (isDraftRecipe(target.recipes)) {
    await supabase.from('recipes').delete().eq('id', target.recipe_id).eq('user_id', userId)
  }

  return { ok: true }
}

/**
 * `add_side`: 400 when the meal already has two sides. The new side lands
 * at whichever of position 1/2 is free, keeping positions compact.
 */
export async function addSide(
  supabase: SupabaseClient,
  userId: string,
  mealId: string,
  mealIsDraft: boolean,
  mealServings: number,
  op: AddSideOp,
): Promise<DishOpResult> {
  const { data: dishes, error: dishesError } = await supabase
    .from('meal_dishes')
    .select('position, role')
    .eq('meal_id', mealId)
    .eq('user_id', userId)
  if (dishesError) return { error: dishesError.message, status: 500 }

  const sidePositions = new Set(
    ((dishes ?? []) as DishRow[]).filter((d) => d.role === 'side').map((d) => d.position),
  )
  if (sidePositions.size >= 2) return { error: 'A meal can have at most two sides.', status: 400 }
  const nextPosition = sidePositions.has(1) ? 2 : 1

  const inserted = await insertDishRecipe(supabase, userId, op.recipe, {
    isDraft: mealIsDraft,
    servingsFallback: mealServings,
  })
  if ('error' in inserted) return { error: inserted.error, status: 400 }

  const { error: insertDishError } = await supabase.from('meal_dishes').insert({
    meal_id: mealId,
    recipe_id: inserted.id,
    user_id: userId,
    role: 'side',
    position: nextPosition,
  })
  if (insertDishError) {
    await supabase.from('recipes').delete().eq('id', inserted.id).eq('user_id', userId)
    return { error: insertDishError.message, status: 500 }
  }

  return { ok: true }
}

/**
 * `remove_side`: 400 when the meal has only one side, or when `position`
 * isn't a side. Removing position 1 while position 2 exists renumbers 2 to
 * 1 — done *after* the delete, so the still-unique `(meal_id, position)`
 * constraint is never violated mid-way.
 *
 * `op.expected_recipe_id`, when present, is enforced at the delete itself
 * (an extra `.eq('recipe_id', ...)`, not just the initial read above it),
 * same reasoning as `replaceDish` — a concurrent op could have changed what
 * sits at `position` between the read and the write. `.select('id')` on the
 * delete is what makes a zero-row result (nothing actually matched)
 * distinguishable from "deleted one row", so that race reports 409 instead
 * of silently reporting success for a write that didn't happen.
 */
export async function removeSide(
  supabase: SupabaseClient,
  userId: string,
  mealId: string,
  op: RemoveSideOp,
): Promise<DishOpResult> {
  const { data: dishes, error: dishesError } = await supabase
    .from('meal_dishes')
    .select('position, role, recipe_id, recipes(is_draft)')
    .eq('meal_id', mealId)
    .eq('user_id', userId)
  if (dishesError) return { error: dishesError.message, status: 500 }

  const rows = (dishes ?? []) as DishRow[]
  const target = rows.find((d) => d.position === op.position)
  if (!target || target.role !== 'side') {
    return { error: 'That position is not a side.', status: 400 }
  }
  if (op.expected_recipe_id && target.recipe_id !== op.expected_recipe_id) {
    return CONFLICT_ERROR
  }
  const sideCount = rows.filter((d) => d.role === 'side').length
  if (sideCount <= 1) return { error: 'A meal needs at least one side.', status: 400 }

  let deleteQuery = supabase
    .from('meal_dishes')
    .delete()
    .eq('meal_id', mealId)
    .eq('position', op.position)
    .eq('user_id', userId)
  if (op.expected_recipe_id) deleteQuery = deleteQuery.eq('recipe_id', op.expected_recipe_id)

  const { data: deletedRows, error: deleteError } = await deleteQuery.select('id')
  if (deleteError) return { error: deleteError.message, status: 500 }
  if (!deletedRows || deletedRows.length === 0) return CONFLICT_ERROR

  if (op.position === 1 && rows.some((d) => d.position === 2)) {
    const { error: renumberError } = await supabase
      .from('meal_dishes')
      .update({ position: 1 })
      .eq('meal_id', mealId)
      .eq('position', 2)
      .eq('user_id', userId)
    if (renumberError) return { error: renumberError.message, status: 500 }
  }

  if (isDraftRecipe(target.recipes)) {
    await supabase.from('recipes').delete().eq('id', target.recipe_id).eq('user_id', userId)
  }

  return { ok: true }
}
