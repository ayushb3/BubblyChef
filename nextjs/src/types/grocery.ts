/**
 * Grocery list types (issue #497 / Spec B.5, backend half).
 *
 * Wire fields are snake_case. `source` says why a line exists: depleted /
 * expiring / low are "generated" lines that regenerate refreshes; meal lines
 * came from a saved meal's missing ingredients; manual lines are the user's.
 */

export type GrocerySource = 'depleted' | 'expiring' | 'low' | 'meal' | 'manual'

export interface GroceryItem {
  id: string
  name: string
  quantity: number | null
  unit: string | null
  category: string
  source: GrocerySource
  /** For `meal` lines: the meal id it was added for. */
  source_ref: string | null
  checked: boolean
  checked_at: string | null
}

export interface GroceryListInfo {
  id: string
  /** The read-only share token, or null when the list is private. */
  share_token: string | null
  last_regenerated_at: string | null
}

/** `GET /api/grocery` — `list` is null until the user first touches their list. */
export interface GroceryListResponse {
  list: GroceryListInfo | null
  items: GroceryItem[]
}

/** One line to add. Only `name` is required. */
export interface NewGroceryItem {
  name: string
  quantity?: number | null
  unit?: string | null
  category?: string
}

/** `PATCH /api/grocery/items/[id]` — any subset. */
export interface GroceryItemPatch {
  checked?: boolean
  quantity?: number | null
  unit?: string | null
  name?: string
}

/** `POST /v1/grocery/regenerate` (via `/api/ai/grocery/regenerate`). */
export interface RegenerateGroceryResponse {
  added: number
  updated: number
  removed: number
  items: GroceryItem[]
}

/** `POST /v1/grocery/from-meal` (via `/api/ai/grocery/from-meal`). */
export interface GroceryFromMealResponse {
  to_buy: string[]
  added: string[]
  already_on_list: string[]
  items: GroceryItem[]
}

/** `GET /api/grocery/shared/[token]` — public, read-only, unchecked lines only. */
export interface SharedGroceryResponse {
  items: Pick<GroceryItem, 'name' | 'quantity' | 'unit' | 'category'>[]
  /** The same plain text the owner's Share button produces. */
  text: string
}
