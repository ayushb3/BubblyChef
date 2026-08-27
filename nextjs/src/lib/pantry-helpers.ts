/**
 * Pantry helper functions.
 * Computes derived fields that were previously @computed_field in Pydantic.
 */

export interface PantryItemRow {
  id: string
  user_id: string
  name: string
  name_normalized: string
  category: string
  location: string
  quantity: number
  unit: string
  expiry_date: string | null
  slot_index: number | null
  added_at: string
  updated_at: string
}

export interface EnrichedPantryItem extends PantryItemRow {
  storage_location: string
  days_until_expiry: number | null
  is_expired: boolean
  is_expiring_soon: boolean
}

/**
 * Parse a stored expiry date as a *local* calendar date.
 *
 * `new Date("2026-08-25")` is specified to parse as UTC midnight, while the
 * "today" it gets compared against is local midnight. West of UTC that made
 * items read as expiring a day early (#244). Date-only strings are split
 * explicitly; anything carrying a time component is left to the normal parser.
 */
export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return new Date(value)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/**
 * Whole days from today (local midnight) until `expiry_date`.
 *
 * The single source of truth for expiry maths. `pantry/page.tsx` used to carry
 * its own copy that subtracted `Date.now()` rather than local midnight, so a
 * badge could read "Today" for an item the API reported as one day out — the
 * two disagreed after roughly 18:00 (#244).
 */
export function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = parseLocalDate(expiryDate).getTime() - today.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

export function enrichPantryItem(row: PantryItemRow): EnrichedPantryItem {
  let days_until_expiry: number | null = null
  let is_expired = false
  let is_expiring_soon = false

  if (row.expiry_date) {
    const expiry = parseLocalDate(row.expiry_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diffMs = expiry.getTime() - today.getTime()
    days_until_expiry = Math.round(diffMs / (1000 * 60 * 60 * 24))
    is_expired = days_until_expiry < 0
    is_expiring_soon = days_until_expiry >= 0 && days_until_expiry <= 3
  }

  return {
    ...row,
    storage_location: row.location, // alias for frontend compatibility
    days_until_expiry,
    is_expired,
    is_expiring_soon,
  }
}

export function buildPantryListResponse(items: EnrichedPantryItem[]) {
  return {
    items,
    total_count: items.length,
    expiring_soon_count: items.filter((i) => i.is_expiring_soon).length,
    expired_count: items.filter((i) => i.is_expired).length,
  }
}
