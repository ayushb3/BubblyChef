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
  /**
   * Kitchen location (`fridge` / `freezer` / `pantry` / `counter`): the storage
   * place on the kitchen wall (`lib/kitchen/places.ts` maps it to Fridge /
   * Freezer / Shelves / Basket). Shown and edited through the storage sheet and
   * the edit sheet's Place field (issue #749). Issue #397 had removed the field
   * while the gamified kitchen was on hold.
   */
  location: string
  quantity: number
  unit: string
  expiry_date: string | null
  /**
   * True when `expiry_date` is a heuristic guess rather than one read from a
   * receipt/label or entered by hand (#182). Optional because rows fetched
   * before the backing column existed (older cached data, pre-migration
   * fixtures) simply omit it — treat a missing value as `false`, never crash.
   */
  estimated_expiry?: boolean
}
