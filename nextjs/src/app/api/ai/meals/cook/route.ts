import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxies `POST /v1/meals/cook` to the AI service (issue #654 / spec #647).
 * Read-only — the route never writes. Follows the `side-alternatives` proxy
 * pattern: forward the body with the caller's auth, parse the upstream body
 * once, and pass the AI service's status and JSON straight through on both
 * success and failure (404 unknown meal, 409 `dish_mismatch`, 422 duplicate
 * dish ids, 500 on a matcher crash).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))

  const res = await aiProxyFetch('/v1/meals/cook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // aiProxyFetch returns a NextResponse directly when there's no session (401).
  if (res instanceof NextResponse) return res

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
