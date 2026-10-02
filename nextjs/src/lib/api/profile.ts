/**
 * Profile client — updates to the `user_profiles` row via the Next.js CRUD
 * route (issue #394: wire up the dietary preference chips for real).
 */

import { createClient } from '@/lib/supabase/client'
import { coerceHouseholdSize } from '@/lib/household'
import type { ExpiryPriority } from '@/lib/expiry-priority'

/**
 * Persist the caller's dietary preferences. Stores the exact display
 * strings shown in the UI (e.g. "Vegetarian", "Gluten-Free") — this is the
 * shared contract with ai-service's recipe/chat grounding, which reads
 * `profiles.dietary_preferences` verbatim, no casing or format transform.
 */
export async function updateDietaryPreferences(
  profileId: string,
  dietaryPreferences: string[],
): Promise<void> {
  const res = await fetch(`/api/profile/${profileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dietary_preferences: dietaryPreferences }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to save dietary preferences' }))
    throw new Error(err.error ?? `Failed to save dietary preferences: ${res.status}`)
  }
}

/**
 * Persist the caller's expiry-priority setting (issue #502): how hard recipe
 * suggestions push food that is about to expire.
 */
export async function updateExpiryPriority(
  profileId: string,
  expiryPriority: ExpiryPriority,
): Promise<void> {
  const res = await fetch(`/api/profile/${profileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiry_priority: expiryPriority }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to save' }))
    throw new Error(err.error ?? `Failed to save: ${res.status}`)
  }
}

/**
 * Persist the caller's allergies and/or disliked ingredients (issue #500).
 *
 * Only the fields present in `fields` are sent, so saving one row never
 * overwrites the other. Allergies are a hard "never suggest" for the AI
 * service; dislikes are left out of suggestions unless a message asks for one.
 */
export async function updateFoodExclusions(
  profileId: string,
  fields: { allergies?: string[]; disliked_ingredients?: string[] },
): Promise<void> {
  const res = await fetch(`/api/profile/${profileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to save' }))
    throw new Error(err.error ?? `Failed to save: ${res.status}`)
  }
}

/**
 * Persist the caller's household size, their default servings (issue #853).
 *
 * Stored in the auth user's `user_metadata` (not `user_profiles`): a guest has
 * no profile row, and the first-run step is mostly shown to guests. See
 * `lib/household.ts`. Rejects so the caller can show the failure.
 */
export async function saveHouseholdSize(size: number): Promise<void> {
  const { error } = await createClient().auth.updateUser({ data: { household_size: size } })
  if (error) throw new Error(error.message || 'Could not save household size')
}

/**
 * Record that the first-run staples step has been seen (done or skipped), so it
 * is not offered again on its own. Non-fatal by design, like the tour's flag: it
 * is UX, not data, so a failed write never blocks the user.
 */
export async function markStaplesStepDone(): Promise<void> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.auth.updateUser({ data: { staples_step_done: true } })
  } catch {
    // non-fatal
  }
}

/** The household size saved on the caller's account, or null when none was set. */
export async function fetchHouseholdSize(): Promise<number | null> {
  try {
    const {
      data: { user },
    } = await createClient().auth.getUser()
    return coerceHouseholdSize(user?.user_metadata?.household_size)
  } catch {
    return null
  }
}
