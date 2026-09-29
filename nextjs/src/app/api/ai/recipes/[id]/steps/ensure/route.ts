import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxies `POST /v1/recipes/{recipe_id}/steps/ensure` to the AI service
 * (issue #648). No request body — the AI service resolves everything from
 * the recipe id plus the caller's JWT (`aiProxyFetch` forwards the session's
 * access token, same as every other `/api/ai/*` route).
 *
 * Passes the AI service's status and body straight through on both success
 * and failure: a 404 (recipe not found) or 502
 * (`{ detail: { error_kind, message } }` on a model failure) reach the
 * client exactly as the AI service sent them, so `ensureSteps()` in
 * `lib/api/recipes.ts` can read `detail.message` directly.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const res = await aiProxyFetch(`/v1/recipes/${id}/steps/ensure`, {
    method: 'POST',
  })

  // aiProxyFetch returns a NextResponse directly when there's no session (401).
  if (res instanceof NextResponse) return res

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
