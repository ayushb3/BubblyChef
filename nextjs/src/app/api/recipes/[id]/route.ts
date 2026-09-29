import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { mergeTags, instructionsChanged, sanitizeSteps } from '@/lib/recipe-helpers'
import { awardBubbles } from '@/lib/bubbles'
import { withMealTitles } from '@/lib/meal-helpers'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  // `meal_dishes(meals(title))` (issue #650) — the meal(s) this recipe is a
  // dish in, so the delete confirmation can name them. A recipe not in any
  // meal gets an empty array, not an absent field.
  const { data, error } = await supabase
    .from('recipes')
    .select('*, meal_dishes(meals(title))')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return notFound('Recipe')

  return NextResponse.json(withMealTitles(data))
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const body = await request.json()

  const updates: Record<string, unknown> = {}
  const fields = [
    'title', 'description', 'ingredients', 'instructions',
    'prep_time_minutes', 'cook_time_minutes', 'total_time_minutes',
    'servings', 'source_url', 'tags', 'difficulty', 'source_type',
    'source_title', 'thumbnail_url', 'is_draft', 'cuisine', 'meal_type',
    'is_favorite', 'steps',
  ]
  for (const field of fields) {
    if (body[field] !== undefined) updates[field] = body[field]
  }
  // Never store client-supplied steps unvalidated (PR #655 review).
  if (body.steps !== undefined) updates.steps = sanitizeSteps(body.steps, body.instructions)

  // If dietary_tags are present alongside (or instead of) tags, merge them.
  // This covers any client that forwards the raw AI response shape.
  if (body.dietary_tags !== undefined || body.tags !== undefined) {
    updates.tags = mergeTags(
      body.tags as string[] | undefined,
      body.dietary_tags as string[] | undefined,
    )
  }

  // Structured steps (issue #648): editing a recipe's instruction text
  // invalidates its structured steps, so the next use re-derives them. Only
  // an actual text change clears them — resubmitting the same instructions
  // (e.g. every RecipeEditModal save, which always sends the full array)
  // must leave existing steps alone. This runs after the `fields` loop above
  // so it wins over any `steps` the caller explicitly sent alongside changed
  // instructions.
  if (body.instructions !== undefined) {
    const { data: current } = await supabase
      .from('recipes')
      .select('instructions')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (current && instructionsChanged(current.instructions, body.instructions)) {
      updates.steps = null
    }
  }

  const { data, error } = await supabase
    .from('recipes')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return errorResponse(error.message)
  if (!data) return notFound('Recipe')

  // A draft being promoted to a real save earns the same recipe_save bubbles
  // a fresh non-draft POST does (#520). The unique (user_id, event_type,
  // ref_key) constraint means a recipe earns once no matter which path saves
  // it — using the recipe id as the ref covers both POST and this PUT.
  if (updates.is_draft === false) {
    await awardBubbles(user.id, 'recipe_save', data.id)
  }

  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  // Issue #650 / spec #647 "Deleting": find every meal this recipe is the
  // *main* of, before the delete cascades its meal_dishes row away — a meal
  // left with no main is deleted too. A recipe that's only a *side* in a
  // meal needs no special handling here: the cascade alone removes its
  // meal_dishes row and the meal (still having its main) stays intact.
  const { data: mainOf } = await supabase
    .from('meal_dishes')
    .select('meal_id')
    .eq('recipe_id', id)
    .eq('user_id', user.id)
    .eq('role', 'main')

  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return errorResponse(error.message)

  const mainlessMealIds = (mainOf ?? []).map((row) => row.meal_id as string)
  if (mainlessMealIds.length > 0) {
    // Deleting the meal cascades its remaining meal_dishes rows (the sides'
    // links) — the side recipes themselves are left untouched, whether
    // draft or saved, same as any other recipe not referenced by a meal.
    await supabase.from('meals').delete().in('id', mainlessMealIds).eq('user_id', user.id)
  }

  return NextResponse.json({ deleted: true })
}
