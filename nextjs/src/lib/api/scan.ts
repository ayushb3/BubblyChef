/**
 * Scan API client — calls the Next.js proxy routes (not AI service directly).
 *
 * Receipt scanning is non-streaming, so it goes through the proxy
 * to benefit from server-side auth forwarding.
 */

import type { ScanResult, ConfirmedItem } from '@/types/scan'

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // 4MB — stay under Vercel's 4.5MB limit

/**
 * Resize image to stay under the upload limit.
 * Scales down progressively until the file is small enough.
 */
async function compressImage(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file

  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      // Scale down proportionally until estimated size is under limit
      const scale = Math.sqrt(MAX_UPLOAD_BYTES / file.size) * 0.9
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => resolve(new File([blob!], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        0.85,
      )
    }
    img.src = url
  })
}

/**
 * Upload a receipt image for OCR + AI parsing.
 */
export async function uploadReceipt(
  file: File,
  options?: { preprocess?: boolean; preprocess_mode?: string },
): Promise<ScanResult> {
  const formData = new FormData()
  formData.append('file', await compressImage(file))
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
