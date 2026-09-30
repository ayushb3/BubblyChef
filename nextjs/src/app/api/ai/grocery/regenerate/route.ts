import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxies `POST /v1/grocery/regenerate` to the AI service (issue #497).
 *
 * Regeneration runs there because it needs the Python pantry model and is
 * deterministic (no LLM): depleted, low and expiring stock become lines;
 * manual and checked lines are kept. The AI service writes the list itself,
 * scoped to the caller's JWT; this route only forwards auth and the response.
 */
export async function POST() {
  const res = await aiProxyFetch('/v1/grocery/regenerate', { method: 'POST' })

  // aiProxyFetch returns a NextResponse directly when there's no session (401).
  if (res instanceof NextResponse) return res

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
