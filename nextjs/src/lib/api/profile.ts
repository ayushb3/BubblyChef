/**
 * Profile client — updates to the `user_profiles` row via the Next.js CRUD
 * route (issue #394: wire up the dietary preference chips for real).
 */

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
