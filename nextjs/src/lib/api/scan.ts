/**
 * Scan API client — calls the Next.js proxy routes (not AI service directly).
 *
 * Receipt scanning is non-streaming, so it goes through the proxy
 * to benefit from server-side auth forwarding.
 */

import type { ScanResult, ConfirmedItem } from '@/types/scan'

/**
 * Upload a receipt image for OCR + AI parsing.
 */
export async function uploadReceipt(
  file: File,
  options?: { preprocess?: boolean; preprocess_mode?: string },
): Promise<ScanResult> {
  const formData = new FormData()
  formData.append('file', file)
  if (options?.preprocess !== undefined) {
    formData.append('preprocess', String(options.preprocess))
  }
  if (options?.preprocess_mode) {
    formData.append('preprocess_mode', options.preprocess_mode)
  }

  const res = await fetch('/api/ai/scan', {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Scan failed' }))
    throw new Error(err.error ?? `Scan failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Confirm scanned items and add them to the pantry.
 */
export async function confirmScanItems(items: ConfirmedItem[]): Promise<void> {
  const res = await fetch('/api/ai/workflows/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      intent: 'pantry_update',
      proposal: {
        actions: items.map((item) => ({
          action_type: item.action,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category,
          location: item.location,
        })),
      },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to add items' }))
    throw new Error(err.error ?? `Failed to add items: ${res.status}`)
  }
}
