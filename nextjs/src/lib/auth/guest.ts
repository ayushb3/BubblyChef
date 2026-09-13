import type { User } from '@supabase/supabase-js'

/**
 * True when the given session belongs to a Supabase anonymous user (a
 * guest created via `supabase.auth.signInAnonymously()` in
 * `lib/supabase/middleware.ts`, issue #382) rather than someone who has
 * signed up/in with real credentials.
 *
 * `is_anonymous` is only present on the user object in recent
 * `@supabase/supabase-js` versions and is optional in the type
 * (`is_anonymous?: boolean`), so treat a missing value as "not a guest" —
 * the safer default, since it means we never hide a save-your-account
 * prompt from someone who genuinely needs it, but also never assume a
 * real, already-authenticated user is a guest just because the field is
 * absent.
 */
export function isGuestUser(user: User | null | undefined): boolean {
  return user?.is_anonymous === true
}
