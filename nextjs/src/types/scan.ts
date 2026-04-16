/**
 * Types for the receipt scanning workflow.
 */

export interface ScannedItem {
  name: string
  quantity: number
  unit: string
  category: string
  location: string
  confidence: number
}

export interface ScanResult {
  ocr_text: string
  ready_to_add: ScannedItem[]
  needs_review: ScannedItem[]
  skipped: ScannedItem[]
  total_items: number
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
