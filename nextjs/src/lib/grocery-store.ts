/**
 * The grocery list's browser storage (issue #497 / Spec B.5).
 *
 * Check-off and manual-add state is client-side by the issue's decision: it
 * survives a reload for the trip to the store, it is explicitly NOT synced
 * across devices, and there is no table behind it. Keyed by user id so two
 * accounts in one browser never share a list. Every storage access is wrapped
 * in try/catch (private windows, blocked site data, quota): a broken store
 * reads as "no saved list" and writes as a no-op, never a crash.
 */

import type { GroceryLine, GrocerySource, ManualLineInput } from '@/lib/grocery'
import { addManualLines } from '@/lib/grocery'

const PREFIX = 'bubblychef:grocery:'
const VERSION = 1
/** Fired on `window` after a save in this tab (the native `storage` event only
 *  reaches other tabs). */
const CHANGE_EVENT = 'bubblychef:grocery-changed'

const SOURCES: readonly GrocerySource[] = ['depleted', 'expiring', 'manual']

export function groceryStorageKey(userId: string): string {
  return `${PREFIX}${userId}`
}

function isLine(value: unknown): value is GroceryLine {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.key === 'string' &&
    typeof v.name === 'string' &&
    (v.quantity === null || (typeof v.quantity === 'number' && Number.isFinite(v.quantity))) &&
    (v.unit === null || typeof v.unit === 'string') &&
    typeof v.category === 'string' &&
    SOURCES.includes(v.source as GrocerySource) &&
    typeof v.checked === 'boolean'
  )
}

/** The raw stored string for the user's list ('' when none or unreadable).
 *  A primitive, so `useSyncExternalStore` can compare snapshots by value. */
export function readGroceryRaw(userId: string): string {
  if (!userId || typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(groceryStorageKey(userId)) ?? ''
  } catch {
    return ''
  }
}

/** Parse a stored value into lines: `[]` when absent or unreadable; malformed
 *  lines are dropped, good ones kept. */
export function parseGroceryLines(raw: string): GroceryLine[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const lines = (parsed as { lines?: unknown }).lines
    return Array.isArray(lines) ? lines.filter(isLine) : []
  } catch {
    return []
  }
}

/** The user's saved list, or `[]` when there is none, it is unreadable, or
 *  storage is unavailable. */
export function loadGroceryLines(userId: string): GroceryLine[] {
  return parseGroceryLines(readGroceryRaw(userId))
}

/** Persist the list. Returns false (and changes nothing) when it can't. */
export function saveGroceryLines(userId: string, lines: GroceryLine[]): boolean {
  if (!userId || typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(
      groceryStorageKey(userId),
      JSON.stringify({ v: VERSION, lines })
    )
  } catch {
    return false
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // A listener threw; the save itself succeeded.
  }
  return true
}

/**
 * Append to the user's manual set and save: the pantry item's "Add to list"
 * helper, and what the meal screen calls with a saved meal's to-buy names
 * (`string[]`) after its confirm. A food already on the list is adopted, not
 * duplicated. Returns the list as saved (or as it would be, if storage failed).
 */
export function addToGroceryList(
  userId: string,
  items: Array<string | ManualLineInput>
): GroceryLine[] {
  const next = addManualLines(loadGroceryLines(userId), items)
  saveGroceryLines(userId, next)
  return next
}

/** Call `callback` whenever the saved list may have changed, in this tab or
 *  another. Returns the unsubscribe function. */
export function subscribeGrocery(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) callback()
  }
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}
