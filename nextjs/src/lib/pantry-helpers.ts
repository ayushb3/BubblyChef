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

export function enrichPantryItem(row: PantryItemRow): EnrichedPantryItem {
  let days_until_expiry: number | null = null
  let is_expired = false
  let is_expiring_soon = false

  if (row.expiry_date) {
    const expiry = new Date(row.expiry_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diffMs = expiry.getTime() - today.getTime()
    days_until_expiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
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
