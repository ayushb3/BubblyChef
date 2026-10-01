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

// ─── The storage sheet (issue #749) ──────────────────────────────────────────

/** The slice of a pantry row the storage sheet reads. */
export interface StoredItem extends PlaceItem {
  id: string
  name: string
  category?: string | null
  quantity: number
  unit: string
}

/** The stored `pantry_items.location` a place saves: what "Add to the Freezer" writes. */
export function placeLocation(key: PlaceKey): PlaceDef['location'] {
  return placeDef(key).location
}

/** The rows stored in one place. */
export function itemsInPlace<T extends PlaceItem>(items: readonly T[], key: PlaceKey): T[] {
  return items.filter((item) => placeForLocation(item.location) === key)
}

/** The Use Soon view's window: expired, or expiring within this many days. */
const USE_SOON_DAYS = 3

/** The most the "Use first" row shows; the rest stay in their category group. */
export const USE_FIRST_LIMIT = 6

function daysOf(item: PlaceItem, today: string): number | null {
  return daysUntilExpiryOn(item.expiry_date ?? null, today)
}

/** Soonest first (expired most of all), no date last, then by name. */
function bySoonest<T extends StoredItem>(today: string) {
  return (a: T, b: T): number => {
    const da = daysOf(a, today)
    const db = daysOf(b, today)
    if (da !== db) {
      if (da === null) return 1
      if (db === null) return -1
      return da - db
    }
    return a.name.localeCompare(b.name)
  }
}

/** Sorted soonest first, as the list and the groups show them. Does not mutate. */
export function sortSoonestFirst<T extends StoredItem>(
  items: readonly T[],
  today: string = localDateString(),
): T[] {
  return [...items].sort(bySoonest<T>(today))
}

/**
 * The items that need attention, by the existing Use Soon rules (`needsAttention`:
 * expired, or expiring within 3 days), soonest first and capped at `limit`.
 */
export function pickUseFirst<T extends StoredItem>(
  items: readonly T[],
  today: string = localDateString(),
  limit: number = USE_FIRST_LIMIT,
): T[] {
  return items
    .filter((item) => {
      const days = daysOf(item, today)
      return days !== null && days <= USE_SOON_DAYS
    })
    .sort(bySoonest<T>(today))
    .slice(0, limit)
}

// Heading order and wording. Several stored categories share a heading (meat and
// seafood are "Meat and fish"); anything unknown is titled from its own key and
// sorts after the known ones, with "Other" last.
const CATEGORY_HEADINGS: ReadonlyArray<readonly [label: string, keys: readonly string[]]> = [
  ['Produce', ['produce']],
  ['Dairy and eggs', ['dairy']],
  ['Meat and fish', ['meat', 'seafood']],
  ['Frozen', ['frozen']],
  ['Dry goods', ['dry_goods', 'pantry', 'grains', 'bakery']],
  ['Cans', ['canned']],
  ['Jars and sauces', ['condiments']],
  ['Snacks', ['snacks']],
  ['Drinks', ['beverages']],
]

const HEADING_BY_KEY = new Map<string, string>(
  CATEGORY_HEADINGS.flatMap(([label, keys]) => keys.map((k) => [k, label] as const)),
)
const HEADING_ORDER = CATEGORY_HEADINGS.map(([label]) => label)

/** The heading a stored food category sits under: "Produce", "Dairy and eggs", ... */
export function categoryHeading(category: string | null | undefined): string {
  const key = (category ?? '').trim().toLowerCase()
  if (!key || key === 'other') return 'Other'
  const known = HEADING_BY_KEY.get(key)
  if (known) return known
  const words = key.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface CategoryGroup<T> {
  /** The heading, which is also the group's stable key. */
  label: string
  items: T[]
}

/** Items under food-category headings in a fixed order, soonest first inside each. */
export function categoryGroups<T extends StoredItem>(
  items: readonly T[],
  today: string = localDateString(),
): CategoryGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const item of sortSoonestFirst(items, today)) {
    const label = categoryHeading(item.category)
    const list = groups.get(label)
    if (list) list.push(item)
    else groups.set(label, [item])
  }
  const rank = (label: string): number => {
    if (label === 'Other') return HEADING_ORDER.length + 1
    const i = HEADING_ORDER.indexOf(label)
    return i === -1 ? HEADING_ORDER.length : i
  }
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([label, list]) => ({ label, items: list }))
}

export interface PlaceSearchGroup<T> {
  key: PlaceKey
  label: string
  items: T[]
}

export interface PlaceSearchResult<T> {
  /** Matches across every place. */
  total: number
  /** All four places in wall order; a place with no match stays, empty. */
  groups: PlaceSearchGroup<T>[]
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** Where `query` sits inside `name` (`[start, end)`), or `null`: for the highlight. */
export function matchRange(name: string, query: string): [number, number] | null {
  const q = normalizeQuery(query)
  if (!q) return null
  const start = name.toLowerCase().indexOf(q)
  return start === -1 ? null : [start, start + q.length]
}

/**
 * Search every place at once, by name. A blank query matches nothing. Each
 * place's matches are soonest first, so what needs using still leads.
 */
export function searchPlaces<T extends StoredItem>(
  items: readonly T[],
  query: string,
  today: string = localDateString(),
): PlaceSearchResult<T> {
  const q = normalizeQuery(query)
  const hits = q ? items.filter((item) => item.name.toLowerCase().includes(q)) : []
  const groups = PLACES.map((p) => ({
    key: p.key,
    label: p.label,
    items: sortSoonestFirst(itemsInPlace(hits, p.key), today),
  }))
  return { total: hits.length, groups }
}
