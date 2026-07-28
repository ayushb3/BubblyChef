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
 * Days between today and an expiry date (negative when already past).
 * Null when there is no expiry date. Shared by `enrichPantryItem` and the
 * resolve route, which records this at the moment an item is used/tossed.
 */
export function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null

  const expiry = new Date(expiryDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = expiry.getTime() - today.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

export function enrichPantryItem(row: PantryItemRow): EnrichedPantryItem {
  const days_until_expiry = daysUntilExpiry(row.expiry_date)
  const is_expired = days_until_expiry !== null && days_until_expiry < 0
  const is_expiring_soon =
    days_until_expiry !== null && days_until_expiry >= 0 && days_until_expiry <= 3

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
