/**
 * Household size (issue #853): how many people the user usually cooks for.
 *
 * It is the user's default servings. It lives in the Supabase auth user's
 * `user_metadata.household_size`, next to `onboarding_completed`, rather than
 * on `user_profiles.household_size`: a guest (the anonymous session a first-run
 * visitor starts with) has no `user_profiles` row, so a profile column would
 * silently drop the answer for exactly the people the first-run step is for.
 * The metadata travels with the account when a guest attaches an email.
 *
 * The picker offers 1 to 6, where 6 reads "6+".
 */
export const HOUSEHOLD_SIZES = [1, 2, 3, 4, 5, 6] as const

/** The largest picker value; it is labelled "6+". */
export const HOUSEHOLD_SIZE_MAX = 6

/** Largest servings count the rest of the app accepts as a default. */
const MAX_DEFAULT_SERVINGS = 20

export function householdSizeLabel(n: number): string {
  return n >= HOUSEHOLD_SIZE_MAX ? `${HOUSEHOLD_SIZE_MAX}+` : String(n)
}

/** An integer from 1 to 20, else null (unset, hand-edited or garbage metadata). */
export function coerceHouseholdSize(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null
  if (raw < 1 || raw > MAX_DEFAULT_SERVINGS) return null
  return raw
}
