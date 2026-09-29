import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { mergeTags, instructionsChanged, sanitizeSteps } from '@/lib/recipe-helpers'
import { awardBubbles } from '@/lib/bubbles'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return notFound('Recipe')

  return NextResponse.json(data)
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

  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return errorResponse(error.message)

  return NextResponse.json({ deleted: true })
}
