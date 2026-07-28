/**
 * Pantry client — calls the Next.js CRUD routes (not the AI service).
 */

export type ResolveOutcome = 'used' | 'tossed'

export interface ResolveResponse {
  resolved: true
  id: string
  outcome: ResolveOutcome
  event_id: string
}

/**
 * Resolve an expiring pantry item: record what happened to it (used it up /
 * tossed it) and remove it from the pantry. Issue #140.
 */
export async function resolvePantryItem(
  itemId: string,
  outcome: ResolveOutcome,
): Promise<ResolveResponse> {
  const res = await fetch(`/api/pantry/${itemId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Resolve failed' }))
    throw new Error(err.error ?? `Resolve failed: ${res.status}`)
  }

  return res.json()
}
