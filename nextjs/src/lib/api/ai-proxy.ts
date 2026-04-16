/**
 * Server-side helper for proxying requests to the AI microservice.
 *
 * Reads the Supabase session from cookies, extracts the JWT access_token,
 * and forwards requests with Authorization: Bearer <token>.
 *
 * Used by /api/ai/* routes. Chat streaming goes direct (browser → AI service)
 * via lib/api/chat.ts — only non-streaming calls are proxied here.
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL ||
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ||
  'http://localhost:8888'

/**
 * Proxy a request to the AI service with auth forwarding.
 *
 * Extracts the Supabase JWT from the server-side session and
 * sends it as a Bearer token to the AI microservice.
 */
export async function aiProxyFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = `${AI_SERVICE_URL}${path}`

  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  })
}

/**
 * Proxy a JSON POST to the AI service and return the JSON response.
 */
export async function aiProxyJson(
  path: string,
  body: unknown,
): Promise<NextResponse> {
  const res = await aiProxyFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // If aiProxyFetch returned a NextResponse (401), pass it through
  if (res instanceof NextResponse) return res

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json(
      { error: data.detail ?? data.error ?? 'AI service error' },
      { status: res.status },
    )
  }

  return NextResponse.json(data)
}
