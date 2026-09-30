import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'

/**
 * Proxies `POST /v1/grocery/from-meal` to the AI service (issue #497): put a
 * saved meal's missing ingredients on the grocery list. The to-buy list is
 * computed there, against the current pantry, with the cook matcher (a saved
 * meal doesn't store it). The client confirms with the user before calling.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))

  const res = await aiProxyFetch('/v1/grocery/from-meal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (res instanceof NextResponse) return res

  const data = await res.json().catch(() => ({}))
  return NextResponse.json(data, { status: res.status })
}
