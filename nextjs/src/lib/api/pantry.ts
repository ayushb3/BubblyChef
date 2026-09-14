/**
 * Pantry API client.
 *
 * CRUD goes through the Next.js routes (same-origin), never the AI service —
 * see the "two API surfaces" rule in CLAUDE.md.
 */

/** Item shape accepted by `POST /api/pantry/bulk`. */
export interface BulkAddItem {
  name: string
  quantity: number
  unit: string
  category: string
  storage_location: string
  expiry_date: string | null
}

export interface BulkAddResult {
  count: number
  items: Array<Record<string, unknown>>
}

/**
 * Add multiple pantry items in one request — the single write path for
 * confirmed scan/type items (issue #259: one confirm implementation, not one
 * per entry point). Nothing is written until this is called explicitly by a
 * user confirm action; callers must never invoke it automatically.
 */
export async function bulkAddPantryItems(items: BulkAddItem[]): Promise<BulkAddResult> {
  const res = await fetch('/api/pantry/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to add items' }))
    throw new Error(data.error ?? `Failed to add items: ${res.status}`)
  }

  return res.json()
}

/** Must match the CHECK constraint on pantry_events and the resolve route. */
export type ResolveOutcome = 'used' | 'tossed' | 'cooked'

export interface ResolveResult {
  id: string
  name: string
  outcome: ResolveOutcome
  resolved: boolean
}

/**
 * Record what happened to a pantry item and remove it from the pantry.
 *
 * The server writes the event before deleting the row, so a failure here means
 * the item is still there — the caller can simply let the user try again.
 */
export async function resolvePantryItem(
  itemId: string,
  outcome: ResolveOutcome
): Promise<ResolveResult> {
  const res = await fetch(`/api/pantry/${itemId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome }),
  })

  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error ?? `Could not resolve item (${res.status})`)
  }

  return res.json()
}
