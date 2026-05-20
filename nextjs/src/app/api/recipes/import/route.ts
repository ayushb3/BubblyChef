/**
 * POST /api/recipes/import
 *
 * Proxy to the AI microservice POST /v1/ingest/recipe-url.
 * Extracts a structured RecipeCard from a recipe page URL.
 *
 * Body: { url: string }
 * Returns: RecipeCard JSON (same shape as a saved recipe)
 */

import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const res = await aiProxyFetch('/v1/ingest/recipe-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (res instanceof NextResponse) return res

  const data = await res.json() as Record<string, unknown>

  if (!res.ok) {
    console.log('[import] AI service error: status=%d detail=%s', res.status, data?.detail ?? data?.error)
    return NextResponse.json(
      { error: data?.detail ?? data?.error ?? 'AI service error' },
      { status: res.status },
    )
  }

  console.log('[import] AI service ok: title=%s thumbnail_url=%s image_url=%s',
    data?.title, data?.thumbnail_url, data?.image_url)
  return NextResponse.json(data)
}
