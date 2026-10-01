/**
 * The profile's expiry-priority setting (issue #502, Spec B.10): how hard recipe
 * suggestions push food that is about to expire. Stored as `user_profiles.expiry_priority`.
 *
 * Shared by the profile PUT route and the profile UI so both agree on the allowed values.
 */

export const EXPIRY_PRIORITIES = ['off', 'gentle', 'aggressive'] as const

export type ExpiryPriority = (typeof EXPIRY_PRIORITIES)[number]

/** What a profile without the setting (an existing user, a row from before the column) gets. */
export const DEFAULT_EXPIRY_PRIORITY: ExpiryPriority = 'gentle'

export function isExpiryPriority(value: unknown): value is ExpiryPriority {
  return typeof value === 'string' && (EXPIRY_PRIORITIES as readonly string[]).includes(value)
}

/** A stored value as a level, or Gentle when it is missing or not a known level. */
export function coerceExpiryPriority(value: unknown): ExpiryPriority {
  return isExpiryPriority(value) ? value : DEFAULT_EXPIRY_PRIORITY
}
