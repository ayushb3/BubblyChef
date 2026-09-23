/**
 * Kitchen decorations API client (issue #521, extended in #522).
 *
 * CRUD goes through the Next.js route (same-origin) — `GET /api/decorations`
 * already exists (`app/api/decorations/route.ts`); this just gives it a
 * typed client + React Query hook, matching the `fetch`-and-throw pattern in
 * `pantry.ts`/`dashboard.ts`.
 *
 * `useDecorations` uses the `QueryClientProvider` wired in `Providers.tsx`:
 * the query key is a single-element array naming the resource, and
 * `staleTime` is left to the provider's default (1 minute).
 *
 * #522 adds the milestone unlock offer: `GET /api/kitchen/offer` (the
 * "pick 1 of 3" prompt) and `POST /api/kitchen/unlock` (claiming one of the
 * three). Both follow the same fetch-and-throw shape.
 */
'use client'

import { useQuery } from '@tanstack/react-query'
import type { Decoration } from '@/lib/kitchen/catalog'

/** A single row from the `decorations` table, as returned by the API route. */
export interface DecorationRow {
  id: string
  user_id: string
  name: string
  decoration_type: string
  created_at: string
}

export interface DecorationsResponse {
  decorations: DecorationRow[]
  total: number
}

/**
 * Fetch the current user's unlocked decorations.
 *
 * Throws on a non-OK response — callers are expected to treat a failure the
 * same way `useQuery` does: the kitchen scene simply renders every slot
 * empty rather than crashing the dashboard.
 */
export async function fetchDecorations(): Promise<DecorationsResponse> {
  const res = await fetch('/api/decorations')

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load decorations' }))
    throw new Error(data.error ?? `Failed to load decorations: ${res.status}`)
  }

  return res.json()
}

export function useDecorations() {
  return useQuery({
    queryKey: ['decorations'],
    queryFn: fetchDecorations,
  })
}

/** `GET /api/kitchen/offer`'s success shape when a milestone has an offer. */
export interface KitchenOffer {
  milestone_key: string
  threshold: number
  options: Decoration[]
}

/**
 * Fetch the current "pick 1 of 3" offer, or `null` when no pending
 * milestone has anything left to offer.
 *
 * Throws on a non-OK response — `UnlockOffer` is expected to just render
 * nothing on failure, the same way it does while loading.
 */
export async function fetchOffer(): Promise<KitchenOffer | null> {
  const res = await fetch('/api/kitchen/offer')

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to load kitchen offer' }))
    throw new Error(data.error ?? `Failed to load kitchen offer: ${res.status}`)
  }

  return res.json()
}

export function useKitchenOffer() {
  return useQuery({
    queryKey: ['kitchen-offer'],
    queryFn: fetchOffer,
  })
}

/**
 * Claim one of the offered decorations for a milestone.
 *
 * Throws on a non-OK response (400 unknown/unreached milestone, 409 already
 * claimed or not offered) — callers surface the message inline rather than
 * treating this like a silent background fetch.
 */
export async function claimUnlock(
  milestoneKey: string,
  decorationId: string,
): Promise<DecorationRow> {
  const res = await fetch('/api/kitchen/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ milestone_key: milestoneKey, decoration_id: decorationId }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to claim decoration' }))
    throw new Error(data.error ?? `Failed to claim decoration: ${res.status}`)
  }

  return res.json()
}
