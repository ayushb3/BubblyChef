import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireAuth, errorResponse } from '@/lib/response-helpers'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Fetch an external image URL and upload it to Supabase Storage.
 * Returns the public Supabase URL, or null if anything fails.
 * Keeps the file small by capping at 1 MB download.
 */
async function proxyThumbnail(externalUrl: string, userId: string): Promise<string | null> {
  try {
    const res = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    })
    console.log('[proxy] fetch status=%d content-type=%s', res.status, res.headers.get('content-type'))
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    if (!contentType.startsWith('image/')) {
      console.log('[proxy] non-image content-type: %s', contentType)
      return null
    }

    const buffer = await res.arrayBuffer()
    console.log('[proxy] buffer size=%d bytes', buffer.byteLength)
    if (buffer.byteLength > 1_048_576) {
      console.log('[proxy] image too large (%d bytes), skipping', buffer.byteLength)
      return null
    }

    const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg'
    const path = `${userId}/${Date.now()}.${ext}`

    const sb = createServiceClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { error } = await sb.storage
      .from('recipe-images')
      .upload(path, buffer, { contentType, upsert: false })

    if (error) {
      console.log('[proxy] storage upload error: %s', error.message)
      return null
    }

    const { data } = sb.storage.from('recipe-images').getPublicUrl(path)
    console.log('[proxy] uploaded → %s', data.publicUrl)
    return data.publicUrl
  } catch (err) {
    console.log('[proxy] exception: %s', err)
    return null
  }
}

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

  // Duplicate detection — check for existing recipe with same source_url
  if (body.source_url) {
    const { data: existing } = await supabase
      .from('recipes')
      .select('id, title')
      .eq('user_id', user.id)
      .eq('source_url', body.source_url)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'duplicate', existing_id: existing.id, existing_title: existing.title },
        { status: 409 },
      )
    }
  }

  // Proxy external thumbnail to Supabase Storage so hotlink-blocking CDNs don't break the image
  let thumbnailUrl: string | null = body.thumbnail_url ?? null
  if (thumbnailUrl && thumbnailUrl.startsWith('http')) {
    const proxied = await proxyThumbnail(thumbnailUrl, user.id)
    console.log('[recipes POST] thumbnail proxy: %s → %s', thumbnailUrl, proxied ?? 'failed (keeping original)')
    if (proxied) thumbnailUrl = proxied
  }

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
      source_platform: body.source_platform,
      tags: [...new Set([...(body.tags || []), ...(body.dietary_tags || [])])],
      difficulty: body.difficulty,
      source_type: body.source_type || 'chat',
      source_title: body.source_title,
      thumbnail_url: thumbnailUrl,
      is_draft: body.is_draft || false,
      cuisine: body.cuisine,
      meal_type: body.meal_type,
    })
    .select()
    .single()

  if (error) return errorResponse(error.message)

  return NextResponse.json(data, { status: 201 })
}
