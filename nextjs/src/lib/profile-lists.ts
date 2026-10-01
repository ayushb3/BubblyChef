/**
 * Validation for the profile's free-text ingredient lists (issue #500):
 * `allergies` and `disliked_ingredients`. Shared by the profile PUT route and
 * the profile UI so both agree on what a stored entry looks like.
 */

export const MAX_TERM_LENGTH = 60
export const MAX_TERMS = 50

/** The case-insensitive key two entries are considered "the same" by. */
export function termKey(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Clean a list of ingredient strings: trim, drop blanks, de-duplicate
 * case-insensitively (first spelling wins), keep order.
 *
 * Returns null when the value isn't a list of strings, or an entry / the list is
 * over-long — the route answers 400 rather than silently truncating an allergy.
 */
export function sanitizeTermList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const term = entry.trim().replace(/\s+/g, ' ')
    if (!term) continue
    if (term.length > MAX_TERM_LENGTH) return null
    const key = termKey(term)
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(term)
  }
  return cleaned.length > MAX_TERMS ? null : cleaned
}
