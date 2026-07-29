import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { mergeTags } from '@/lib/recipe-helpers'

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
    'is_favorite',
  ]
  for (const field of fields) {
    if (body[field] !== undefined) updates[field] = body[field]
  }

  // If dietary_tags are present alongside (or instead of) tags, merge them.
  // This covers any client that forwards the raw AI response shape.
  if (body.dietary_tags !== undefined || body.tags !== undefined) {
    updates.tags = mergeTags(
      body.tags as string[] | undefined,
      body.dietary_tags as string[] | undefined,
    )
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
