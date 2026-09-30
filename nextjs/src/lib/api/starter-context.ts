/**
 * Starter-context API client (issue #651, §1d/§7).
 *
 * A same-origin CRUD read (`GET /api/chat/starter-context`), kept out of the
 * AI-service client (`lib/api/chat.ts`) — this never leaves the Next.js
 * server. `fetchStarterContext` normalises the response defensively even
 * though the route itself already degrades field by field, so
 * `rankStarterPills` (`lib/starter-pills.ts`) never has to guard against a
 * malformed field itself.
 */
'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { StarterContext, StarterExpiringItem, StarterRecentCook } from '@/types/chat'

/**
 * Sits under `['pantry']` so it rides the existing pantry invalidations
 * rather than needing new ones on every recipe/meal write — staleness of the
 * recipe-derived fields is bounded by the 5-minute `staleTime` below.
 *
 * This key is not user-scoped — the query cache itself is a single
 * per-browser-tab store shared across whoever is signed in. Sign-out already
 * clears it; the login page (`app/login/page.tsx`) also calls
 * `queryClient.clear()` on a successful sign-in/sign-up, so a guest who signs
 * into a real account in the same tab can't see the guest's cached pills for
 * the remainder of this `staleTime`.
 */
export const STARTER_CONTEXT_KEY = ['pantry', 'starter-context'] as const

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function normaliseExpiring(raw: unknown): StarterExpiringItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is StarterExpiringItem => {
    if (!item || typeof item !== 'object') return false
    const r = item as Record<string, unknown>
    return typeof r.name === 'string' && typeof r.expiry_date === 'string'
  })
}

function normaliseRecentCooks(raw: unknown): StarterRecentCook[] {
  if (!Array.isArray(raw)) return []
  const out: StarterRecentCook[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    // A blank/whitespace-only title would still pass the `typeof === 'string'`
    // check below and reach the starter ranker, which renders it as
    // "Make the  again" (code review, PR A) — drop it here instead.
    if (typeof r.recipe_id !== 'string' || typeof r.title !== 'string' || r.title.trim().length === 0) continue
    out.push({
      recipe_id: r.recipe_id,
      title: r.title,
      last_cooked_at: typeof r.last_cooked_at === 'string' ? r.last_cooked_at : '',
      cuisine: typeof r.cuisine === 'string' ? r.cuisine : null,
    })
  }
  return out
}

function normaliseCuisines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function normalisePantryCount(raw: unknown): number | null {
  return isNonNegativeInt(raw) ? raw : null
}

function normaliseDefaultServings(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 20 ? raw : 2
}

/**
 * Fetch the starter context. Throws on `!res.ok` — the query then errors and
 * `rankStarterPills` gets `null`, which is its documented fallback. On a
 * `2xx`, every field is normalised independently: a malformed field becomes
 * its safe default rather than failing the whole response.
 */
export async function fetchStarterContext(): Promise<StarterContext> {
  const res = await fetch('/api/chat/starter-context')
  if (!res.ok) {
    throw new Error(`Failed to load starter context: ${res.status}`)
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

  return {
    expiring: normaliseExpiring(body.expiring),
    pantry_count: normalisePantryCount(body.pantry_count),
    recent_cooks: normaliseRecentCooks(body.recent_cooks),
    recent_cuisines: normaliseCuisines(body.recent_cuisines),
    default_servings: normaliseDefaultServings(body.default_servings),
  }
}

/**
 * `enabled` gates the fetch to the empty-chat condition the caller already
 * computes (`app/chat/page.tsx`) — no network wait before the first render:
 * the caller falls back to `rankStarterPills(null, now)` while this is
 * pending.
 */
export function useStarterContext(enabled: boolean): UseQueryResult<StarterContext> {
  return useQuery({
    queryKey: STARTER_CONTEXT_KEY,
    queryFn: fetchStarterContext,
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}
