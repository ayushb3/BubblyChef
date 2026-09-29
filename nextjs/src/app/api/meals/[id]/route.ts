import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { awardBubbles } from '@/lib/bubbles'
import { fetchFullMeal, normalizeConstraints } from '@/lib/meal-helpers'
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
 * `PUT /api/meals/[id]` — `{ title?, servings?, constraints?, promote? }`.
 * `promote` sets `is_draft = false` on the meal and cascades to its draft
 * dish recipes (each earns the same `recipe_save` bubbles a fresh non-draft
 * save does, mirroring `PUT /api/recipes/[id]`'s promote path — the
 * ref-keyed unique constraint on `bubble_events` keeps this idempotent no
 * matter which path promotes a given recipe).
 *
 * Dish replace/add/remove (spec #647) isn't implemented here — the contract
 * (`docs/plans/2026-09-29-issue-650-meal-contract.md`) marks it "not needed
 * by this ticket's UI" — so the side-count rule has nothing to re-validate
 * on this route; it's enforced on `POST /api/meals` at creation time.
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

  if (body.promote) {
    const { data: dishRows } = await supabase
      .from('meal_dishes')
      .select('recipe_id')
      .eq('meal_id', id)
      .eq('user_id', user.id)

    const recipeIds = (dishRows ?? []).map((d) => d.recipe_id as string)
    if (recipeIds.length > 0) {
      const { data: promoted } = await supabase
        .from('recipes')
        .update({ is_draft: false })
        .in('id', recipeIds)
        .eq('user_id', user.id)
        .eq('is_draft', true)
        .select('id')

      for (const recipe of promoted ?? []) {
        await awardBubbles(user.id, 'recipe_save', recipe.id as string)
      }
    }
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
