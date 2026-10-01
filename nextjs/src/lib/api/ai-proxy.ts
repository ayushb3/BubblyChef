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
import { estimateExpiryFallback } from '@/lib/expiry-fallback'

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

/** How long to wait on the AI service's estimate before using the local fallback. */
const ESTIMATE_EXPIRY_TIMEOUT_MS = 5000

/**
 * Estimate an expiry date for a pantry item via the AI service's Python
 * heuristic (the single source of truth — see #158). Returns an ISO date
 * string.
 *
 * When the AI service fails, times out or answers without a date (an outage or
 * cold start), this falls back to a local, deterministic estimate by
 * category/location (`lib/expiry-fallback.ts`, a mirror of the same Python
 * table) and logs a warning, instead of returning null and letting the row be
 * saved with no expiry (#705). The add is never blocked, and never loses its
 * expiry. Callers flag the result `estimated_expiry` as before.
 */
export async function estimateExpiry(item: {
  name: string
  category?: string | null
  location?: string | null
}): Promise<string> {
  const fallback = (reason: string): string => {
    console.warn(
      `[estimateExpiry] AI service estimate unavailable (${reason}); using local fallback for "${item.name}"`,
    )
    return estimateExpiryFallback(item)
  }

  try {
    const res = await aiProxyFetch('/v1/pantry/estimate-expiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: item.name,
        category: item.category || 'other',
        location: item.location || 'pantry',
      }),
      signal: AbortSignal.timeout(ESTIMATE_EXPIRY_TIMEOUT_MS),
    })
    if (res instanceof NextResponse) return fallback(`proxy status ${res.status}`)
    if (!res.ok) return fallback(`status ${res.status}`)
    const data = (await res.json()) as { expiry_date?: string }
    return data.expiry_date || fallback('no expiry_date in response')
  } catch (err) {
    return fallback(err instanceof Error ? err.message : 'request failed')
  }
}

/**
 * Infer a food category for a pantry item name via the AI service's catalog
 * fuzzy matcher (the single source of truth — see #159). Returns a category
 * string (e.g. "dairy"), or `null` when the catalog has no confident match.
 * Callers should fall back to 'other' on null so the add is never blocked.
 */
export async function estimateCategory(name: string): Promise<string | null> {
  try {
    const res = await aiProxyFetch('/v1/pantry/estimate-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res instanceof NextResponse || !res.ok) return null
    const data = (await res.json()) as { category?: string | null }
    return data.category ?? null
  } catch {
    // Categorization is best-effort — never let it block adding the item.
    return null
  }
}

/**
 * Derive quantity_base / unit_base for a pantry row via the Python normalizer
 * (the single source of truth — see #224). Returns both values, or `null`
 * for both when conversion is impossible. Callers must leave the DB columns
 * NULL rather than blocking the write — the cook flow can derive them at
 * runtime from the raw (quantity, unit) when base values are absent.
 */
export async function normalizeBaseUnit(item: {
  name: string
  quantity: number
  unit: string
  category?: string | null
}): Promise<{ quantity_base: number | null; unit_base: string | null }> {
  try {
    const res = await aiProxyFetch('/v1/pantry/normalize-base-unit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category || 'other',
      }),
    })
    if (res instanceof NextResponse || !res.ok) return { quantity_base: null, unit_base: null }
    const data = (await res.json()) as {
      quantity_base?: number | null
      unit_base?: string | null
    }
    return {
      quantity_base: data.quantity_base ?? null,
      unit_base: data.unit_base ?? null,
    }
  } catch {
    // Base-unit derivation is best-effort — never let it block adding the item.
    return { quantity_base: null, unit_base: null }
  }
}
