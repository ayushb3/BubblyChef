import type { ScannedItem, ScanResult } from '@/types/scan'
import type { BulkAddItem } from '@/lib/api/pantry'
import { placeDef, placeForLocation, type PlaceKey } from '@/lib/kitchen/places'

/**
 * A `ScannedItem` stamped with a stable, frontend-only identity. `ScannedItem`
 * itself is a frozen backend contract (types/scan.ts, pinned to
 * docs/plans/2026-08-19-receipt-scan-rework.md) — `_id` never comes from the
 * server and is never sent back to it. It exists purely so the review UI can
 * key/check items by identity instead of by array position, which used to
 * shift (and silently drop checked state) whenever an earlier item was
 * dismissed (issue #470).
 */
export type ScannedItemWithId = ScannedItem & { _id: string }

/**
 * Stamp every item across all three tiers of a `ScanResult` with a stable
 * `_id`, once, right when the result comes back from the upload. Callers
 * (ScanTab, `/scan`) should call this exactly once per scan and store the
 * three arrays as `ScannedItemWithId[]` from then on — the id rides along on
 * every edit/dismiss because those flows already pass whole items through.
 */
export function assignScanIds(result: ScanResult): {
  ready_to_add: ScannedItemWithId[]
  needs_review: ScannedItemWithId[]
  skipped: ScannedItemWithId[]
} {
  const stamp = (item: ScannedItem): ScannedItemWithId => ({ ...item, _id: crypto.randomUUID() })
  return {
    ready_to_add: result.ready_to_add.map(stamp),
    needs_review: result.needs_review.map(stamp),
    skipped: result.skipped.map(stamp),
  }
}

/**
 * True when a scan came back successfully but parsed nothing in any tier. The
 * containers treat this as a friendly "nothing found" state rather than
 * rendering an empty review list (issue #642).
 */
export function isEmptyScan(result: {
  ready_to_add: unknown[]
  needs_review: unknown[]
  skipped: unknown[]
}): boolean {
  return result.ready_to_add.length + result.needs_review.length + result.skipped.length === 0
}

/**
 * Convert a scanned/OCR'd item into the shape `POST /api/pantry/bulk`
 * expects. Shared by every container that lets a user confirm scan results
 * (the pantry add sheet's scan tab, the `/scan` route) so there is exactly
 * one mapping from "what OCR found" to "what gets written" (issue #259).
 */
export function scannedToBulkAddItem(item: ScannedItem): BulkAddItem {
  return {
    name: item.name,
    quantity: item.quantity ?? 1,
    unit: item.unit ?? 'item',
    category: item.category ?? 'other',
    // The place the item is displayed under (put-away, issue #753): an unknown
    // or missing location is Shelves, the column's own default.
    storage_location: placeDef(scanItemPlace(item)).location,
    expiry_date: null,
    source: 'scan',
  }
}

/** The place a scanned item is headed to (an unknown location is Shelves). */
export function scanItemPlace(item: Pick<ScannedItem, 'location'>): PlaceKey {
  return placeForLocation(item.location)
}

/** The item, moved to `place`: writes the place's stored location. */
export function withScanPlace<T extends ScannedItem>(item: T, place: PlaceKey): T {
  return { ...item, location: placeDef(place).location }
}

const PLAIN_UNITS = new Set(['', 'item', 'items', 'pc', 'pcs', 'piece', 'pieces', 'each', 'ea'])

/**
 * How a quantity reads on a put-away card: "2" for plain items, "1 box" for a
 * measured one. Not an editable value: the number is, the unit rides along.
 */
export function scanQuantityLabel(item: Pick<ScannedItem, 'quantity' | 'unit'>): string {
  const unit = (item.unit ?? '').trim()
  return PLAIN_UNITS.has(unit.toLowerCase()) ? `${item.quantity}` : `${item.quantity} ${unit}`
}

const NOT_A_STORE = /\b(receipt|invoice|thank|welcome|please|survey|tel|phone|cashier|order)\b|www\.|\.com|store\s*#/i

/**
 * The store's name, read off the top of the receipt text, for the put-away
 * header ("Trader Joe's · 11 items"). The scan response has no store field, so
 * this is a guess: the first non-blank line, if it looks like a name (mostly
 * letters, no prices or dates, short). `null` when it does not, and the header
 * then leaves the store out rather than show a wrong one.
 */
export function guessStoreName(ocrText: string | null | undefined): string | null {
  const first = (ocrText ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!first || first.length < 3 || first.length > 32) return null
  if (NOT_A_STORE.test(first)) return null
  if (/\d+[.,]\d{2}|\d{1,2}[/:-]\d{1,2}/.test(first)) return null
  const letters = (first.match(/\p{L}/gu) ?? []).length
  if (letters < 3 || letters / first.length < 0.7) return null
  // All-caps receipts read better as names; mixed case is already a name.
  if (first !== first.toUpperCase()) return first
  return first
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}
