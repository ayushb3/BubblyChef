import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxies `POST /v1/grocery/meal-to-buy` to the AI service (issue #497): a saved
 * meal's missing ingredients, computed against the current pantry with the cook
 * matcher (a saved meal doesn't store them). Deterministic and read-only; the
 * client puts the names on the grocery list after the user confirms.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))

  const res = await aiProxyFetch('/v1/grocery/meal-to-buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // aiProxyFetch returns a NextResponse directly when there's no session (401).
  if (res instanceof NextResponse) return res

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
