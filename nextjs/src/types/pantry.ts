/**
 * Shared pantry types.
 *
 * `PantryItem` is the shape the `/api/pantry` list route returns to the client.
 * It lived as a private interface inside `app/pantry/page.tsx` until the Use
 * Soon view (#139) needed the same shape; two copies of a row type that the API
 * defines is how they drift apart.
 *
 * This is deliberately narrower than `EnrichedPantryItem` in `lib/pantry-helpers`:
 * that one is the server-side row plus computed fields, while pages compute
 * expiry from `expiry_date` themselves via `daysUntilExpiry` so the badge can
 * never disagree with the server flags (#244).
 */
export interface PantryItem {
  id: string
  name: string
  category: string
  location: string
  quantity: number
  unit: string
  expiry_date: string | null
}
