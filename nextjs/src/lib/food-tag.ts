import { isExpired, isExpiringSoon } from '@/lib/pantry-helpers'

/** The expiry tones of the food tag. They map onto the theme-invariant expiry tokens. */
export type ExpiryTone = 'fresh' | 'expiring' | 'expired'

export interface ExpiryTag {
  tone: ExpiryTone
  /** Short label: "Today", "1 day", "3 days", "Expired". */
  label: string
}

/**
 * Days until expiry -> the food tag's tone and short label (issue #741).
 * Uses the same 0-3 day "expiring soon" window and "strictly past is expired"
 * rule as the pantry (`isExpiringSoon` / `isExpired`), so a tag can never
 * disagree with the pantry list. `null` / `undefined` (no expiry known) has no
 * tag.
 */
export function expiryTag(days: number | null | undefined): ExpiryTag | null {
  if (days === null || days === undefined || Number.isNaN(days)) return null
  if (isExpired(days)) return { tone: 'expired', label: 'Expired' }
  const label = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`
  return { tone: isExpiringSoon(days) ? 'expiring' : 'fresh', label }
}
