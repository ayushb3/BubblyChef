/**
 * POST /api/recipes/import
 *
 * Proxy to the AI microservice POST /v1/ingest (unified dispatcher).
 * Extracts a structured RecipeCard from a recipe page URL.
 *
 * Body: { url: string }
 * Returns: RecipeCard JSON (same shape as a saved recipe)
 *
 * The unified endpoint accepts multipart form data; we send the URL as the
 * `text` field so the server dispatcher auto-detects URL modality. The
 * response is a ProposalEnvelope; we unwrap envelope.proposal.recipe to
 * return the bare RecipeCard the UI expects.
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

  const url = (body as Record<string, unknown>)?.url
  if (typeof url !== 'string' || !url) {
    return NextResponse.json({ error: 'Missing url field' }, { status: 400 })
  }

  // Send as multipart form so the unified /ingest dispatcher can auto-detect
  // URL modality from the `text` field.
  const form = new FormData()
  form.append('text', url)

  const res = await aiProxyFetch('/v1/ingest', {
    method: 'POST',
    body: form,
  })

  if (res instanceof NextResponse) return res

  const envelope = await res.json() as Record<string, unknown>

  if (!res.ok) {
    console.log('[import] AI service error: status=%d detail=%s', res.status, envelope?.detail ?? envelope?.error)
    return NextResponse.json(
      { error: envelope?.detail ?? envelope?.error ?? 'AI service error' },
      { status: res.status },
    )
  }

  // Unwrap ProposalEnvelope → proposal → recipe to preserve the bare
  // RecipeCard contract the UI has always consumed.
  const proposal = (envelope?.proposal ?? {}) as Record<string, unknown>
  const recipe = (proposal?.recipe ?? {}) as Record<string, unknown>

  console.log('[import] AI service ok: title=%s thumbnail_url=%s image_url=%s',
    recipe?.title, recipe?.thumbnail_url, recipe?.image_url)
  return NextResponse.json(recipe)
}
