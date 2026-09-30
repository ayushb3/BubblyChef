/**
 * Grocery client (issue #497 / Spec B.5, backend half) — the per-domain wrapper
 * over the grocery routes. No ad hoc `fetch` in components; the held `/grocery`
 * page, the meal screen's "Add missing to grocery list" action and the pantry
 * item menu's "Add to list" all go through here.
 *
 * Two API surfaces, never mixed: plain CRUD is Next.js `/api/grocery/*`;
 * regenerate and add-from-meal need the AI service's pantry model and cook
 * matcher, so they go through the `/api/ai/grocery/*` proxies (deterministic,
 * no LLM).
 */

import type {
  GroceryFromMealResponse,
  GroceryItem,
  GroceryItemPatch,
  GroceryListResponse,
  NewGroceryItem,
  RegenerateGroceryResponse,
  SharedGroceryResponse,
} from '@/types/grocery'

export { formatGroceryShareText, groupGroceryByCategory } from '@/lib/grocery-helpers'

/** A readable message from a non-2xx body: the CRUD routes send `{ error }`,
 *  the AI service sends `{ detail }`. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null)
  const detail = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const message =
    (typeof detail.error === 'string' && detail.error) ||
    (typeof detail.detail === 'string' && detail.detail) ||
    `${fallback} (${res.status})`
  return new Error(message)
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw await failure(res, fallback)
  return (await res.json()) as T
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** `GET /api/grocery` — the list and its lines (`list` is null when untouched). */
export async function fetchGroceryList(): Promise<GroceryListResponse> {
  return json(await fetch('/api/grocery'), 'Failed to load the grocery list')
}

/**
 * `POST /api/grocery/items` — add lines. Takes plain names (`string[]`, what the
 * meal screen and pantry menu have) or full line objects. A food already on the
 * list is adopted as a manual line rather than duplicated. Returns the lines
 * added or adopted.
 */
export async function addGroceryItems(
  items: Array<string | NewGroceryItem>
): Promise<GroceryItem[]> {
  const body = { items: items.map((i) => (typeof i === 'string' ? { name: i } : i)) }
  const data = await json<{ items: GroceryItem[] }>(
    await fetch('/api/grocery/items', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
    'Failed to add to the grocery list'
  )
  return data.items
}

async function patchItem(id: string, patch: GroceryItemPatch): Promise<GroceryItem> {
  const data = await json<{ item: GroceryItem }>(
    await fetch(`/api/grocery/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    }),
    'Failed to update the grocery item'
  )
  return data.item
}

/** Check (got it) or uncheck one line. */
export function setGroceryItemChecked(id: string, checked: boolean): Promise<GroceryItem> {
  return patchItem(id, { checked })
}

/** Edit quantity / unit / name. The line becomes the user's own (manual). */
export function updateGroceryItem(id: string, patch: GroceryItemPatch): Promise<GroceryItem> {
  return patchItem(id, patch)
}

/** Remove one line. */
export async function removeGroceryItem(id: string): Promise<void> {
  await json(
    await fetch(`/api/grocery/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    'Failed to remove the grocery item'
  )
}

/** Clear every checked ("got it") line. Returns how many were removed. */
export async function clearCheckedGroceryItems(): Promise<number> {
  const data = await json<{ deleted: number }>(
    await fetch('/api/grocery/items?checked=1', { method: 'DELETE' }),
    'Failed to clear checked items'
  )
  return data.deleted
}

/**
 * `POST /api/ai/grocery/regenerate` — refresh the list from depletions and
 * low/expiring stock. Manual and checked lines are kept; the rest is refreshed.
 */
export async function regenerateGroceryList(): Promise<RegenerateGroceryResponse> {
  return json(
    await fetch('/api/ai/grocery/regenerate', { method: 'POST' }),
    'Failed to regenerate the grocery list'
  )
}

/**
 * `POST /api/ai/grocery/from-meal` — put a saved meal's missing ingredients on
 * the list (computed against the current pantry; a saved meal doesn't store
 * them). Confirm with the user first: it writes.
 */
export async function addMealToGroceryList(mealId: string): Promise<GroceryFromMealResponse> {
  return json(
    await fetch('/api/ai/grocery/from-meal', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ meal_id: mealId }),
    }),
    'Failed to add the meal to the grocery list'
  )
}

/** Turn sharing on and get the read-only token (`rotate` replaces it). */
export async function shareGroceryList(options?: { rotate?: boolean }): Promise<string> {
  const data = await json<{ token: string }>(
    await fetch('/api/grocery/share', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(options?.rotate ? { rotate: true } : {}),
    }),
    'Failed to share the grocery list'
  )
  return data.token
}

/** Stop sharing; every link handed out stops working. */
export async function stopSharingGroceryList(): Promise<void> {
  await json(await fetch('/api/grocery/share', { method: 'DELETE' }), 'Failed to stop sharing')
}

/** The public, read-only view behind a share token (unchecked lines + text). */
export async function fetchSharedGroceryList(token: string): Promise<SharedGroceryResponse> {
  return json(
    await fetch(`/api/grocery/shared/${encodeURIComponent(token)}`),
    'Failed to load the shared list'
  )
}
