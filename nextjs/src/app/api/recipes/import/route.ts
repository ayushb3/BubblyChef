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
import { aiProxyJson } from '@/lib/api/ai-proxy'

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  return aiProxyJson('/v1/ingest/recipe-url', body)
}
