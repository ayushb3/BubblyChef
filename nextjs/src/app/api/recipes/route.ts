import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')
  const cuisine = searchParams.get('cuisine')
  const mealType = searchParams.get('meal_type')
  const maxTime = searchParams.get('max_time')
  const isDraft = searchParams.get('is_draft')
  const limit = parseInt(searchParams.get('limit') || '50', 10)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  let query = supabase
    .from('recipes')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)

  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
  if (cuisine) query = query.eq('cuisine', cuisine)
  if (mealType) query = query.eq('meal_type', mealType)
  if (maxTime) query = query.lte('total_time_minutes', parseInt(maxTime, 10))
  if (isDraft !== null && isDraft !== undefined) query = query.eq('is_draft', isDraft === 'true')

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) return errorResponse(error.message)

  return NextResponse.json({
    recipes: data,
    total_count: count || 0,
    limit,
    offset,
  })
}

export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const body = await request.json()

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id: user.id,
      title: body.title,
      description: body.description,
      ingredients: body.ingredients || [],
      instructions: body.instructions || [],
      prep_time_minutes: body.prep_time_minutes,
      cook_time_minutes: body.cook_time_minutes,
      total_time_minutes: body.total_time_minutes,
      servings: body.servings,
      source_url: body.source_url,
      tags: body.tags || [],
      difficulty: body.difficulty,
      source_type: body.source_type || 'chat',
      source_title: body.source_title,
      thumbnail_url: body.thumbnail_url,
      is_draft: body.is_draft || false,
      cuisine: body.cuisine,
      meal_type: body.meal_type,
    })
    .select()
    .single()

  if (error) return errorResponse(error.message)

  return NextResponse.json(data, { status: 201 })
}
