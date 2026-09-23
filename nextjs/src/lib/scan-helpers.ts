import type { ScannedItem, ScanResult } from '@/types/scan'
import type { BulkAddItem } from '@/lib/api/pantry'

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
    storage_location: item.location ?? 'pantry',
    expiry_date: null,
    source: 'scan',
  }
}
