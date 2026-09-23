/**
 * Maps a scan failure code to user-facing copy (issue #396).
 *
 * The AI service sends a sanitized `{ message, code }` for scan failures
 * (see `ai-service/bubbly_chef/services/scan_errors.py`) so raw provider
 * strings never reach the browser, and `uploadReceipt` (`lib/api/scan.ts`)
 * adds one more code client-side for a request that timed out before the
 * server ever responded. This file is the single place that turns any of
 * those codes into copy — never render `err.message` from the server
 * directly, and never string-match on it.
 *
 * The code strings below match `scan_errors.py` exactly; this file is the
 * only place that needs updating if the contract changes.
 */

import { SCAN_CLIENT_TIMEOUT_CODE } from '@/lib/api/scan'

const TIMEOUT_COPY = 'That scan is taking too long. Try again, or add items manually.'

const GENERIC_COPY = "Couldn't read that receipt — try again, or add items manually."

const COPY_BY_CODE: Record<string, string> = {
  // Client-side abort and a server-reported timeout are the same thing to a
  // user: the scan took too long. Different codes, one message.
  [SCAN_CLIENT_TIMEOUT_CODE]: TIMEOUT_COPY,
  scan_timeout: TIMEOUT_COPY,
  vision_provider_unavailable:
    "Scanning is temporarily unavailable. Try again in a moment, or add items manually.",
  unreadable_image:
    "We couldn't read that photo. Try a clearer picture of the receipt, or add items manually.",
  scan_failed: GENERIC_COPY,
}

/**
 * Turn a scan error into copy safe to show the user. Falls back to generic
 * friendly copy for unrecognized codes — never the raw server/error message.
 */
export function scanErrorCopy(code: string | undefined): string {
  if (!code) return GENERIC_COPY
  return COPY_BY_CODE[code] ?? GENERIC_COPY
}
