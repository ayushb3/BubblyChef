/**
 * Share / copy the grocery list as plain text (issue #497, user story 10).
 *
 * Web Share API when the browser has it, otherwise copy to the clipboard. The
 * text comes from `formatGroceryShareText` (the unchecked lines only).
 */

export type ShareResult =
  /** The share sheet was used. */
  | 'shared'
  /** The share sheet was opened and dismissed; nothing to report as an error. */
  | 'cancelled'
  /** Copied to the clipboard (no Web Share API, or sharing failed). */
  | 'copied'
  /** Neither sharing nor copying is available here. */
  | 'unavailable'
  /** There was nothing to share. */
  | 'empty'

export async function shareGroceryText(text: string): Promise<ShareResult> {
  if (!text.trim()) return 'empty'
  if (typeof navigator === 'undefined') return 'unavailable'

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Grocery list', text })
      return 'shared'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // Any other failure (not allowed, unsupported payload): fall through to copy.
    }
  }

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    // Clipboard blocked (permissions, insecure context).
  }
  return 'unavailable'
}
