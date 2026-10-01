import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxies `POST /v1/pantry/match-ingredients` to the AI service (issue #784):
 * have / low / missing for each recipe ingredient line against the caller's
 * pantry, for the recipe card's food tags. Deterministic (the cook matcher's
 * synonym path and base-unit lot sum, no model call) and read-only.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))

  const res = await aiProxyFetch('/v1/pantry/match-ingredients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // aiProxyFetch returns a NextResponse directly when there's no session (401).
  if (res instanceof NextResponse) return res

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
