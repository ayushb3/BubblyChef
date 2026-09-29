import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxies `POST /v1/meals/side-alternatives` to the AI service (issue #652 /
 * spec #647), following the `app/api/ai/recipes/[id]/steps/ensure` proxy
 * pattern: forward the body with the caller's auth, pass the AI service's
 * status and JSON body straight through on both success and failure so
 * `fetchSideAlternatives()` in `lib/api/meals.ts` can read `detail.message`
 * directly on a non-ok response (404 unknown meal, 502
 * `{ detail: { error_kind, message } }` on a model failure).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))

  const res = await aiProxyFetch('/v1/meals/side-alternatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // aiProxyFetch returns a NextResponse directly when there's no session (401).
  if (res instanceof NextResponse) return res

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
