import type { ScannedItem } from '@/types/scan'
import type { BulkAddItem } from '@/lib/api/pantry'

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
  }
}
