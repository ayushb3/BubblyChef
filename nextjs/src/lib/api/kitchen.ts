/**
 * Kitchen decorations API client (issue #521).
 *
 * CRUD goes through the Next.js route (same-origin) — `GET /api/decorations`
 * already exists (`app/api/decorations/route.ts`); this just gives it a
 * typed client + React Query hook, matching the `fetch`-and-throw pattern in
 * `pantry.ts`/`dashboard.ts`.
 *
 * `useDecorations` uses the `QueryClientProvider` wired in `Providers.tsx`:
 * the query key is a single-element array naming the resource, and
 * `staleTime` is left to the provider's default (1 minute).
 */
import { useQuery } from '@tanstack/react-query'

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
