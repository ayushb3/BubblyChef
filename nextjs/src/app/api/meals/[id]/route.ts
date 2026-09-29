import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import {
  addSide,
  fetchFullMeal,
  isDishOpFailure,
  normalizeConstraints,
  promoteMealDishes,
  removeSide,
  replaceDish,
} from '@/lib/meal-helpers'
import type { UpdateMealRequest } from '@/types/meals'

/**
 * `GET /api/meals/[id]` — the meal plus every dish's full recipe row,
 * including `steps` (issue #650 / spec #647 "API contracts").
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const meal = await fetchFullMeal(supabase, user.id, id)
  if (!meal) return notFound('Meal')

  return NextResponse.json(meal)
}

/**
 * `PUT /api/meals/[id]` — `{ title?, servings?, constraints?, promote? }`,
 * plus at most one of `replace_dish` / `add_side` / `remove_side` (issue
 * #652 / spec #647 "PUT /api/meals/[id]: dish operations"). Two dish ops in
 * one body → 400.
 *
 * `promote` sets `is_draft = false` on the meal and cascades to its draft
 * dish recipes (each earns the same `recipe_save` bubbles a fresh non-draft
 * save does, mirroring `PUT /api/recipes/[id]`'s promote path — the
 * ref-keyed unique constraint on `bubble_events` keeps this idempotent no
 * matter which path promotes a given recipe).
 *
 * The dish op (when present) runs *after* the title/servings/constraints/
 * promote update, so a request that both promotes and swaps a side inserts
 * the new dish recipe with the meal's final `is_draft`/`servings`, not its
 * pre-update ones. It needs the meal's `is_draft`/`servings` regardless of
 * whether the plain-field update block ran (a dish-op-only request skips
 * that block entirely), so it fetches the meal row itself and 404s there
 * when the meal doesn't exist or isn't this user's.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const body = (await request.json()) as UpdateMealRequest

  const dishOps = [body.replace_dish, body.add_side, body.remove_side].filter(
    (op) => op !== undefined,
  )
  if (dishOps.length > 1) {
    return errorResponse('Only one dish operation is allowed per request.', 400)
  }

  // Servings is a CHECK-free INT column that the meal page divides by to
  // scale every dish's quantities, so 0, negatives, fractions and strings
  // are rejected here rather than stored (PR #659 review).
  if (
    body.servings !== undefined &&
    !(Number.isInteger(body.servings) && body.servings >= 1 && body.servings <= 100)
  ) {
    return errorResponse('servings must be a whole number from 1 to 100', 400)
  }

  const updates: Record<string, unknown> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.servings !== undefined) updates.servings = body.servings
  if (body.constraints !== undefined) updates.constraints = normalizeConstraints(body.constraints)
  if (body.promote) updates.is_draft = false

  if (Object.keys(updates).length > 0) {
    const { error, data } = await supabase
      .from('meals')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle()
    if (error) return errorResponse(error.message)
    if (!data) return notFound('Meal')
  }

  if (body.promote) await promoteMealDishes(supabase, user.id, id)

  if (body.replace_dish || body.add_side || body.remove_side) {
    const { data: mealRow, error: mealError } = await supabase
      .from('meals')
      .select('id, is_draft, servings')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    if (mealError || !mealRow) return notFound('Meal')

    const opResult = body.replace_dish
      ? await replaceDish(supabase, user.id, id, mealRow.is_draft, mealRow.servings, body.replace_dish)
      : body.add_side
        ? await addSide(supabase, user.id, id, mealRow.is_draft, mealRow.servings, body.add_side)
        : await removeSide(supabase, user.id, id, body.remove_side!)

    if (isDishOpFailure(opResult)) return errorResponse(opResult.error, opResult.status)
  }

  const meal = await fetchFullMeal(supabase, user.id, id)
  if (!meal) return notFound('Meal')

  return NextResponse.json(meal)
}

/**
 * `DELETE /api/meals/[id]` — deletes the meal and its *draft* dish recipes,
 * and keeps the saved ones in the library (spec #647 "Deleting").
 *
 * Draft dish recipes are deleted directly (which cascades their own
 * `meal_dishes` row via `recipe_id ON DELETE CASCADE`); the meal row is then
 * deleted, cascading whatever `meal_dishes` rows are left — the links to the
 * saved recipes, never the recipes themselves.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const { data: dishes, error: dishesError } = await supabase
    .from('meal_dishes')
    .select('recipe_id, recipes(is_draft)')
    .eq('meal_id', id)
    .eq('user_id', user.id)

  if (dishesError) return errorResponse(dishesError.message)
  if (!dishes) return notFound('Meal')

  const draftRecipeIds = dishes
    .filter((d) => {
      const recipe = d.recipes as { is_draft?: boolean } | { is_draft?: boolean }[] | null
      const isDraft = Array.isArray(recipe) ? recipe[0]?.is_draft : recipe?.is_draft
      return isDraft === true
    })
    .map((d) => d.recipe_id as string)

  if (draftRecipeIds.length > 0) {
    const { error: recipeDeleteError } = await supabase
      .from('recipes')
      .delete()
      .in('id', draftRecipeIds)
      .eq('user_id', user.id)
    if (recipeDeleteError) return errorResponse(recipeDeleteError.message)
  }

  const { error, count } = await supabase
    .from('meals')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return errorResponse(error.message)
  if (!count) return notFound('Meal')

  return NextResponse.json({ deleted: true })
}
