/**
 * Scan API client — calls the Next.js proxy routes (not AI service directly).
 *
 * Receipt scanning is non-streaming, so it goes through the proxy
 * to benefit from server-side auth forwarding.
 */

import type { ScanResult, ConfirmedItem } from '@/types/scan'

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // 4MB — stay under Vercel's 4.5MB limit

// Gemini Vision OCR on a receipt photo is genuinely slow — multi-second
// round trips are normal, not a sign anything is wrong. This needs to be
// long enough that a real (if sluggish) scan is never cut off, while still
// giving the UI a bounded worst case instead of hanging forever if the
// provider wedges (issue #396 / #402). 45s is comfortably above observed
// scan latency plus headroom for a cold provider connection.
const SCAN_TIMEOUT_MS = 45_000

/**
 * Error thrown by `uploadReceipt`. `code` lets callers distinguish failure
 * kinds (client-side timeout vs. a sanitized code from the AI service, see
 * `nextjs/src/app/api/ai/scan/route.ts`) without string-matching on
 * `message`, which is user-facing copy and not a stable identifier.
 */
export class ScanError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'ScanError'
    this.code = code
  }
}

/** Stable code for a scan aborted client-side by `SCAN_TIMEOUT_MS`. */
export const SCAN_CLIENT_TIMEOUT_CODE = 'client_timeout'

/**
 * Codes this client derives itself, for failures where the AI service never
 * got to send one (issue #642): the fetch threw, the proxy/platform answered
 * with a bare status or a non-JSON body, or the file was refused before any
 * upload. The copy for each lives in `lib/scan-error-copy.ts`.
 */
export const SCAN_NETWORK_ERROR_CODE = 'scan_network_error'
export const SCAN_NOT_AN_IMAGE_CODE = 'scan_not_an_image'

/**
 * Fall back to the HTTP status when an error response carries no sanitized
 * code — e.g. a platform-generated HTML 502/504, a 429, or an expired
 * session. A code the AI service did send always wins over this.
 */
function codeForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'scan_auth_expired'
    case 413:
      return 'scan_file_too_large'
    case 429:
      return 'scan_rate_limited'
    case 408:
    case 504:
      return 'scan_timeout'
    case 502:
    case 503:
      return 'vision_provider_unavailable'
    default:
      return 'scan_failed'
  }
}

/** Coerce a 200 body into a `ScanResult`, or throw if it is not one. */
function toScanResult(body: unknown): ScanResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ScanError('Malformed scan response', 'scan_failed')
  }
  const b = body as Partial<ScanResult>
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    ocr_text: typeof b.ocr_text === 'string' ? b.ocr_text : '',
    ready_to_add: list(b.ready_to_add),
    needs_review: list(b.needs_review),
    skipped: list(b.skipped),
    total_items: typeof b.total_items === 'number' ? b.total_items : 0,
    warnings: list(b.warnings),
    // Only an explicit false is a verdict; an older service omits it (#856).
    is_receipt: b.is_receipt !== false,
  }
}

/**
 * Resize image to stay under the upload limit.
 * Scales down progressively until the file is small enough.
 */
async function compressImage(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file

  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file) // upload original; let server reject if too large
    }
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      const scale = Math.sqrt(MAX_UPLOAD_BYTES / file.size) * 0.9
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file) // fall back to original on canvas failure
            return
          }
          resolve(new File([blob], file.name, { type: 'image/jpeg' }))
        },
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
  options?: { preprocess?: boolean; preprocess_mode?: string; signal?: AbortSignal },
): Promise<ScanResult> {
  // Refuse a clearly-not-an-image file before spending an upload on it. An
  // empty MIME type is let through: some pickers report none for HEIC.
  if (file.type && !file.type.startsWith('image/')) {
    throw new ScanError('Not an image', SCAN_NOT_AN_IMAGE_CODE)
  }

  const formData = new FormData()
  formData.append('file', await compressImage(file))
  if (options?.preprocess !== undefined) {
    formData.append('preprocess', String(options.preprocess))
  }
  if (options?.preprocess_mode) {
    formData.append('preprocess_mode', options.preprocess_mode)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
  // Lets a caller (ScanTab, on unmount/abandonment — issue #439) tear down
  // the request early too, not just the SCAN_TIMEOUT_MS deadline.
  const onExternalAbort = () => controller.abort()
  options?.signal?.addEventListener('abort', onExternalAbort)

  try {
    const res = await fetch('/api/ai/scan', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => null)
      const message: string = err?.error ?? `Scan failed: ${res.status}`
      const code: string | undefined = err?.code
      throw new ScanError(message, code ?? codeForStatus(res.status))
    }

    // A 200 with a non-JSON / wrong-shaped body is a failure the user should
    // see as a friendly one, not a raw SyntaxError or a TypeError downstream.
    // (Abort mid-read is still an AbortError, handled in the catch below.)
    const body: unknown = await res.json().catch((e: unknown) => {
      if ((e as DOMException)?.name === 'AbortError') throw e
      throw new ScanError('Malformed scan response', 'scan_failed')
    })
    return toScanResult(body)
  } catch (err) {
    // Covers an abort firing at any point in the request — while `fetch`
    // itself is still in flight, or while the response body is still being
    // read by `res.json()` (issue #439: the previous code only wrapped the
    // `fetch` call, so a slow body read that got aborted mid-parse leaked a
    // raw `AbortError` instead of this friendly, code-bearing `ScanError`).
    if (err instanceof ScanError) throw err
    if ((err as DOMException)?.name === 'AbortError') {
      throw new ScanError('Scan timed out', SCAN_CLIENT_TIMEOUT_CODE)
    }
    // `fetch` itself throwing is a network failure (offline, DNS, the
    // connection dropping) — never let the raw TypeError reach a caller.
    throw new ScanError('Network error', SCAN_NETWORK_ERROR_CODE)
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Confirm scanned items and add them to the pantry.
 *
 * Throws if the request itself fails (network error or non-2xx status).
 * Also throws on a `success: false` envelope (partial or total failure) so
 * callers get a consistent error signal — matching how the chat flow handles
 * the same `/api/ai/workflows/apply` endpoint.
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
          action: item.action,
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

  const data = await res.json().catch(() => null) as {
    success?: boolean
    failed_count?: number
    errors?: string[]
  } | null

  if (data && data.success === false) {
    const failedCount = data.failed_count ?? 0
    const errors = data.errors ?? []
    const detail = errors[0] ?? `${failedCount} item${failedCount !== 1 ? 's' : ''} could not be added`
    throw new Error(detail)
  }
}
