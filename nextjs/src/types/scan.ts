/**
 * Types for the receipt scanning workflow.
 *
 * FROZEN CONTRACT — matches the pinned API shape from docs/plans/2026-08-19-receipt-scan-rework.md.
 * Any change here must be coordinated with the backend agent.
 */

export interface ScannedItem {
  name: string           // normalized display name  → "Italian Bomba Hot Pepper Spread"
  original_name: string  // LLM parse, pre-normalize → "italian bomba hot pepper"
  source_line: string    // raw OCR receipt line     → "ITALIAN BOMBA HOT PEPPER"
  price: number | null
  quantity: number
  unit: string
  category: string
  location: string
  confidence: number     // PER ITEM — 0..1
}

export interface ScanResult {
  ocr_text: string
  ready_to_add: ScannedItem[]   // confidence >= 0.8  → pre-checked
  needs_review: ScannedItem[]   // 0.5 .. 0.8         → unchecked
  skipped: ScannedItem[]        // < 0.5              → unchecked, collapsed
  total_items: number
  warnings: string[]            // always present, may be empty
}

/** An item confirmed by the user, ready to be added to the pantry. */
export interface ConfirmedItem {
  action: 'add'
  name: string
  quantity: number
  unit: string
  category: string
  location: string
  expiry_date?: string | null
}
