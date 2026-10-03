import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Create the `user_profiles` row a guest never got (issue #914).
 *
 * Anonymous sign-ins skip the profile trigger (00009), so a guest had no row and
 * the profile settings that live on it (dietary preferences, allergies/dislikes,
 * expiry priority) refused to save. A guest has a real user id and RLS lets them
 * own a row, so we make one on demand: `guest-<id8>` username, no email (column
 * made nullable by 00020). Linking an account later fills the email in.
 *
 * Returns the row, or null if it could not be created (e.g. migration 00020 not
 * applied yet), in which case the controls fall back to their "no profile" state.
 */
export async function ensureProfile(
  supabase: SupabaseClient,
  user: { id: string },
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .insert({
      user_id: user.id,
      username: `guest-${user.id.slice(0, 8)}`,
      email: null,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as Record<string, unknown>
}
