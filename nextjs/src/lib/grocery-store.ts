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
import { addManualLines, groceryFoodKey } from '@/lib/grocery'

const PREFIX = 'bubblychef:grocery:'
/** 2: records carry `dismissed`. A version 1 record (no such field) still reads. */
const VERSION = 2
/** A cap so dismissals can never grow the record without bound. */
const MAX_DISMISSED = 500
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

/** The dismissed suggestions' fingerprints (`lib/grocery.ts` `dismissalsFor`):
 *  `[]` when absent, unreadable, or from a record saved before they existed. */
export function parseGroceryDismissed(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const dismissed = (parsed as { dismissed?: unknown }).dismissed
    return Array.isArray(dismissed)
      ? dismissed.filter((d): d is string => typeof d === 'string')
      : []
  } catch {
    return []
  }
}

export function loadGroceryDismissed(userId: string): string[] {
  return parseGroceryDismissed(readGroceryRaw(userId))
}

/** Persist the list, keeping the user's dismissals as they are. */
export function saveGroceryLines(userId: string, lines: GroceryLine[]): boolean {
  return saveGroceryState(userId, lines, loadGroceryDismissed(userId))
}

/**
 * Persist the list and the dismissed suggestions as one record, so they can't
 * drift apart. A dismissal outlives the line the user removed: it is what stops
 * the next regenerate from re-adding it (issue #497 review).
 * Returns false (and changes nothing) when it can't.
 */
export function saveGroceryState(
  userId: string,
  lines: GroceryLine[],
  dismissed: readonly string[]
): boolean {
  if (!userId || typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(
      groceryStorageKey(userId),
      JSON.stringify({ v: VERSION, lines, dismissed: [...new Set(dismissed)].slice(-MAX_DISMISSED) })
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

/**
 * Put a meal's or recipe's missing items on the list without disturbing what
 * the user has already done with it (issue #787). `addToGroceryList` /
 * `addManualLines` un-ticks a food that is already listed, which is right for
 * a pantry item's "Add to list" (the user just asked for it again). A ticked
 * line from a recipe's missing items means it was bought at the shop, so it is
 * left ticked; unticked and new names are added (or adopted) as usual. Writes
 * nothing when every name is already ticked. An item may carry its amount, unit
 * and category (issue #850), which `addManualLines` keeps on the line.
 */
export function addMissingToGroceryList(
  userId: string,
  items: Array<string | ManualLineInput>
): void {
  const ticked = new Set(
    loadGroceryLines(userId)
      .filter((l) => l.checked)
      .map((l) => l.key)
  )
  const fresh = items.filter((i) => !ticked.has(groceryFoodKey(typeof i === 'string' ? i : i.name)))
  if (fresh.length > 0) addToGroceryList(userId, fresh)
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
