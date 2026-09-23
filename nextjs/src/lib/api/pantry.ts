/**
 * Pantry API client.
 *
 * CRUD goes through the Next.js routes (same-origin), never the AI service —
 * see the "two API surfaces" rule in CLAUDE.md.
 */

import type { PantryItem } from '@/types/pantry'

/** Item shape accepted by `POST /api/pantry/bulk`. */
export interface BulkAddItem {
  name: string
  quantity: number
  unit: string
  category: string
  /**
   * Kitchen location. Nothing in the UI asks the user for one any more
   * (issue #397); the scan path still forwards the value the AI service
   * derived from the category (the server's expiry heuristic scales by it —
   * freezer ×6), and the manual path omits it so the server default applies.
   */
  storage_location?: string
  expiry_date: string | null
  /**
   * Where this item came from. Drives the `scan_confirm` bubbles award
   * (#520) — a request with at least one `source: 'scan'` item earns the
   * scan award once, in addition to the per-item `pantry_add` award every
   * item earns regardless of source. The award's ref_key is derived
   * server-side from the date and item names (see `/api/pantry/bulk`), not
   * from anything sent here, so it can't be farmed by resubmitting.
   */
  source?: 'scan' | 'manual'
  /**
   * Explicit override for whether `expiry_date` is an estimate rather than
   * a date the user actually chose (issue #398, mirrors #363's precedence
   * on the server: an explicit flag from the client always wins). Omit for
   * a genuinely user-typed date; the server's own heuristic-derived flag is
   * used as a fallback only when this is absent.
   */
  estimated_expiry?: boolean
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

/**
 * Fields the edit modal can change on a single pantry item. Every field is
 * optional — `PUT /api/pantry/[id]` only touches the keys that are present.
 * Kitchen location is deliberately not among them (issue #397): the edit
 * modal no longer shows it, and omitting the key leaves the stored value
 * untouched.
 */
export interface UpdatePantryItemInput {
  name?: string
  quantity?: number
  unit?: string
  category?: string
  expiry_date?: string | null
}

const NETWORK_ERROR_COPY = 'Network problem — check your connection and try again.'

/**
 * `fetch`, with a network failure (it rejects with a bare
 * `TypeError: Failed to fetch`) turned into copy a user can act on.
 */
async function fetchOrNetworkError(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error(NETWORK_ERROR_COPY)
  }
}

/**
 * Update one pantry item in place — the only single-item write path in the
 * app (issue #478: the edit modal is the sole consumer, and it was calling
 * `fetch` directly). Rejects with a message the caller can show as-is: a 401
 * is called out specifically because the fix ("sign in again") is different
 * from every other failure, and a raw server/DB error string is never
 * surfaced.
 */
export async function updatePantryItem(
  itemId: string,
  updates: UpdatePantryItemInput,
): Promise<PantryItem> {
  const res = await fetchOrNetworkError(`/api/pantry/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Your session expired — sign in again to save.')
    }
    throw new Error("Couldn't save that item. Please try again.")
  }

  return res.json()
}

/**
 * Delete one pantry item outright, without recording an outcome. For "used
 * it up" / "tossed it", which the pantry tracks as events, use
 * `resolvePantryItem` instead.
 */
export async function deletePantryItem(itemId: string): Promise<void> {
  const res = await fetchOrNetworkError(`/api/pantry/${itemId}`, { method: 'DELETE' })

  if (!res.ok) {
    throw new Error("Couldn't delete that item. Please try again.")
  }
}
