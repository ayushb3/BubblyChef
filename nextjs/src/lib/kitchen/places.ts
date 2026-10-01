/**
 * Storage places (issue #748, Goal 2 of the signature PRD).
 *
 * The kitchen wall shows four places where food lives. Each maps one-to-one
 * onto the `location` value a pantry row already stores (no schema change):
 *
 *   fridge  -> Fridge
 *   freezer -> Freezer (the fridge's bottom drawer)
 *   pantry  -> Shelves
 *   counter -> Basket
 *
 * `location` defaults to `pantry` in the database, so a missing, empty or
 * unrecognised value is Shelves too: every row lands in exactly one place and
 * the four counts always add up to the pantry's total.
 *
 * Pure: no clock or storage reads of its own (`today` is injected), so it is
 * unit-tested without rendering (`kitchen-places.test.ts`).
 */
import { localDateString } from '@/lib/date'
import { daysUntilExpiryOn, isExpired, isExpiringSoon } from '@/lib/pantry-helpers'

export type PlaceKey = 'fridge' | 'freezer' | 'shelves' | 'basket'

export interface PlaceDef {
  key: PlaceKey
  /** The name drawn on the wall and spoken by screen readers. */
  label: string
  /** The stored `pantry_items.location` value this place shows. */
  location: 'fridge' | 'freezer' | 'pantry' | 'counter'
}

/** In wall order, left to right: fridge, its freezer drawer, shelves, basket. */
export const PLACES: readonly PlaceDef[] = [
  { key: 'fridge', label: 'Fridge', location: 'fridge' },
  { key: 'freezer', label: 'Freezer', location: 'freezer' },
  { key: 'shelves', label: 'Shelves', location: 'pantry' },
  { key: 'basket', label: 'Basket', location: 'counter' },
]

export const PLACE_KEYS: readonly PlaceKey[] = PLACES.map((p) => p.key)

const PLACE_BY_LOCATION = new Map<string, PlaceKey>(PLACES.map((p) => [p.location, p.key]))
const PLACE_BY_KEY = new Map<PlaceKey, PlaceDef>(PLACES.map((p) => [p.key, p]))

export function placeDef(key: PlaceKey): PlaceDef {
  // PLACES covers every PlaceKey (guarded by kitchen-places.test.ts).
  return PLACE_BY_KEY.get(key)!
}

/**
 * The place a stored location belongs to. Anything that is not one of the four
 * known locations (a missing value, an empty string, a value from an older or
 * newer client) is Shelves, the column's own default.
 */
export function placeForLocation(location: string | null | undefined): PlaceKey {
  if (!location) return 'shelves'
  return PLACE_BY_LOCATION.get(location.trim().toLowerCase()) ?? 'shelves'
}

/** The slice of a pantry row the summary reads. */
export interface PlaceItem {
  location?: string | null
  expiry_date?: string | null
}

export interface PlaceSummary {
  key: PlaceKey
  label: string
  /** Rows (not summed quantities) stored in this place. */
  count: number
  /** Rows expired or expiring within 3 days: the Use Soon view's rule. */
  useSoonCount: number
}

export type PlaceSummaries = Record<PlaceKey, PlaceSummary>

/** Zeroed summaries: the shape before any data has arrived. */
export function emptyPlaceSummaries(): PlaceSummaries {
  return Object.fromEntries(
    PLACES.map((p) => [p.key, { key: p.key, label: p.label, count: 0, useSoonCount: 0 }]),
  ) as PlaceSummaries
}

/**
 * Count the pantry's rows per place, and how many in each need using soon.
 *
 * "Use soon" is the Use Soon view's rule (`needsAttention`): expired, or
 * expiring within 3 days. `today` is a client-local `YYYY-MM-DD`, injected so
 * tests never read the real clock.
 */
export function summarizePlaces(
  items: readonly PlaceItem[],
  today: string = localDateString(),
): PlaceSummaries {
  const summaries = emptyPlaceSummaries()
  for (const item of items) {
    const summary = summaries[placeForLocation(item.location)]
    summary.count += 1
    const days = daysUntilExpiryOn(item.expiry_date ?? null, today)
    if (isExpired(days) || isExpiringSoon(days)) summary.useSoonCount += 1
  }
  return summaries
}

/**
 * The place button's accessible name: "Fridge, 23 items, 3 to use soon".
 * `summary` is `null` while the pantry is still loading: just the name, never
 * a made-up zero.
 */
export function placeAccessibleName(
  label: string,
  summary: Pick<PlaceSummary, 'count' | 'useSoonCount'> | null,
): string {
  if (summary === null) return label
  if (summary.count === 0) return `${label}, empty`
  const items = `${summary.count} ${summary.count === 1 ? 'item' : 'items'}`
  return summary.useSoonCount > 0
    ? `${label}, ${items}, ${summary.useSoonCount} to use soon`
    : `${label}, ${items}`
}
