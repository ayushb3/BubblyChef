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
import { PLACE_SLOTS } from '@/lib/kitchen/sprite-layout'
import { SPRITE_KINDS, spriteKindFor, type SpriteKind } from '@/lib/kitchen/sprites/category'

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

// ---------------------------------------------------------------------------
// What the wall draws in each place (issue #751)
// ---------------------------------------------------------------------------

/** A pantry row as the sprites read it: the summary's slice plus what it is. */
export interface StockItem extends PlaceItem {
  id?: string
  name?: string | null
  category?: string | null
  /** A used-up row (0) is resolved: nothing is drawn for it. Missing counts as stocked. */
  quantity?: number
}

/** At most this many items wilt on the wall, overall. */
export const MAX_WILTING = 3

/** An item drawn by itself, drooped, with its time-left tag. */
export interface WiltingItem {
  id: string
  name: string
  place: PlaceKey
  kind: SpriteKind
  /** Negative once expired. */
  daysLeft: number
  /** The pixel-lettered tag: "today", "1 day", "2 days", "expired". */
  tag: string
}

/** What one place draws: its representative category sprites, then its wilting items. */
export interface PlaceStock {
  kinds: SpriteKind[]
  wilting: WiltingItem[]
}

export type KitchenStock = Record<PlaceKey, PlaceStock>

/** "today", "1 day", "2 days" (and "3 days": Use Soon's window is 3), "expired". */
export function wiltTag(daysLeft: number): string {
  if (daysLeft < 0) return 'expired'
  if (daysLeft === 0) return 'today'
  return daysLeft === 1 ? '1 day' : `${daysLeft} days`
}

interface Candidate {
  item: StockItem
  id: string
  place: PlaceKey
  daysLeft: number
}

/**
 * The items that wilt, most urgent first, by the Use Soon view's own rule (expired,
 * or within 3 days; expired first, the most overdue first, then soonest). A used-up
 * row is resolved and does not count. The cap is `MAX_WILTING` overall, and a place
 * can only draw as many items as it has slots: an item with no room left is passed
 * over for the next that fits.
 */
function pickWilting(items: readonly StockItem[], today: string): Candidate[] {
  const candidates: Candidate[] = []
  items.forEach((item, index) => {
    if (item.quantity !== undefined && !(item.quantity > 0)) return
    const daysLeft = daysUntilExpiryOn(item.expiry_date ?? null, today)
    if (daysLeft === null || !(isExpired(daysLeft) || isExpiringSoon(daysLeft))) return
    candidates.push({
      item,
      id: item.id ?? `item-${index}`,
      place: placeForLocation(item.location),
      daysLeft,
    })
  })
  // The name and id only make equally urgent items come out in a stable order.
  candidates.sort(
    (a, b) =>
      a.daysLeft - b.daysLeft ||
      (a.item.name ?? '').localeCompare(b.item.name ?? '') ||
      a.id.localeCompare(b.id),
  )
  const room = Object.fromEntries(PLACES.map((p) => [p.key, PLACE_SLOTS[p.key].length])) as Record<
    PlaceKey,
    number
  >
  const picked: Candidate[] = []
  for (const c of candidates) {
    if (picked.length >= MAX_WILTING) break
    if (room[c.place] <= 0) continue
    room[c.place] -= 1
    picked.push(c)
  }
  return picked
}

function toWilting(c: Candidate): WiltingItem {
  return {
    id: c.id,
    name: c.item.name ?? '',
    place: c.place,
    kind: spriteKindFor(c.item, c.place),
    daysLeft: c.daysLeft,
    tag: wiltTag(c.daysLeft),
  }
}

/** The up-to-3 items drawn wilting, most urgent first. Empty when nothing needs attention. */
export function wiltingItems(
  items: readonly StockItem[],
  today: string = localDateString(),
): WiltingItem[] {
  return pickWilting(items, today).map(toWilting)
}

/**
 * What each place draws. The wilting items are drawn by themselves; every other
 * row is tallied by sprite (its category, refined by its name) and the place shows
 * its most-stocked few, as many as it has slots for, most stocked first (ties in the
 * sprite sheet's order). So an 80-item pantry is a few sprites per place plus the
 * count badge, never one sprite per item.
 */
export function kitchenStock(
  items: readonly StockItem[],
  today: string = localDateString(),
): KitchenStock {
  const picked = pickWilting(items, today)
  const wilting = new Set(picked.map((c) => c.item))

  const tallies = Object.fromEntries(PLACES.map((p) => [p.key, new Map<SpriteKind, number>()])) as Record<
    PlaceKey,
    Map<SpriteKind, number>
  >
  for (const item of items) {
    if (wilting.has(item)) continue
    if (item.quantity !== undefined && !(item.quantity > 0)) continue
    const place = placeForLocation(item.location)
    const kind = spriteKindFor(item, place)
    tallies[place].set(kind, (tallies[place].get(kind) ?? 0) + 1)
  }

  return Object.fromEntries(
    PLACES.map((p) => {
      const wiltingHere = picked.filter((c) => c.place === p.key).map(toWilting)
      const room = PLACE_SLOTS[p.key].length - wiltingHere.length
      const kinds = [...tallies[p.key]]
        .sort((a, b) => b[1] - a[1] || SPRITE_KINDS.indexOf(a[0]) - SPRITE_KINDS.indexOf(b[0]))
        .slice(0, Math.max(0, room))
        .map(([kind]) => kind)
      return [p.key, { kinds, wilting: wiltingHere }]
    }),
  ) as KitchenStock
}
