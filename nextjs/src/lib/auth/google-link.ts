/**
 * Helpers for the guest -> Google "link identity" flow on /login (issue #389).
 *
 * A guest (Supabase anonymous user) who taps "Continue with Google" calls
 * `linkIdentity` so the Google identity attaches to their existing user id and
 * their pantry, recipes, chat and bubbles stay. The edge case is a Google
 * account that already belongs to another BubblyChef user: Supabase refuses the
 * link with one of the codes below, and /login then signs the guest in to that
 * existing account instead. Accounts are never merged; the guest's data is left
 * under the untouched anonymous user id.
 *
 * That automatic switch only runs for a link this browser started from /login
 * (a short-lived sessionStorage marker). A collision from anywhere else, such as
 * the profile banner's own Google link or a hand-made /login?error_code=... URL,
 * never redirects on its own.
 */

/**
 * Both codes mean "this Google account maps to another BubblyChef user":
 * `identity_already_exists` = the Google identity is linked to someone else;
 * `email_exists` = its email matches an existing (e.g. email/password) user.
 */
const COLLISION_CODES = new Set(['identity_already_exists', 'email_exists'])

export function isLinkCollisionCode(code: string | null | undefined): boolean {
  return !!code && COLLISION_CODES.has(code)
}

/**
 * `supabase.auth.getUser()` returns `AuthSessionMissingError` when there is no
 * session at all, which is a genuine "not a guest". Any other error (network
 * failure, expired token) says nothing about who the user is.
 */
export function isSessionMissingError(error: { name?: string } | null | undefined): boolean {
  return error?.name === 'AuthSessionMissingError'
}

// One-shot guard: the automatic switch to the existing account survives a
// full-page OAuth redirect, so it lives in sessionStorage.
const SWITCH_TRIED_KEY = 'bubblychef:collision-switch-tried'

export function hasTriedAccountSwitch(): boolean {
  try {
    return window.sessionStorage.getItem(SWITCH_TRIED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Record that an automatic switch is about to start. Returns false when the
 * flag could not be stored, in which case the caller must not switch: without
 * the flag a deterministic collision would loop forever.
 */
export function markAccountSwitchTried(): boolean {
  try {
    window.sessionStorage.setItem(SWITCH_TRIED_KEY, '1')
    return window.sessionStorage.getItem(SWITCH_TRIED_KEY) === '1'
  } catch {
    return false
  }
}

export function clearAccountSwitchTried(): void {
  try {
    window.sessionStorage.removeItem(SWITCH_TRIED_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}

// Marker: "this browser started a Google link from /login". Set just before
// linkIdentity, consumed when the collision is handled, and expires so a
// link that was abandoned at Google can't arm a much later, unrelated collision.
const LINK_STARTED_KEY = 'bubblychef:login-link-started-at'
const LINK_STARTED_TTL_MS = 10 * 60 * 1000

export function markLoginLinkStarted(): boolean {
  try {
    window.sessionStorage.setItem(LINK_STARTED_KEY, String(Date.now()))
    return true
  } catch {
    return false
  }
}

/** True once, and only while the marker is fresh. Always removes it. */
export function consumeLoginLinkStarted(): boolean {
  try {
    const raw = window.sessionStorage.getItem(LINK_STARTED_KEY)
    window.sessionStorage.removeItem(LINK_STARTED_KEY)
    const startedAt = Number(raw)
    if (!raw || !Number.isFinite(startedAt)) return false
    return Date.now() - startedAt <= LINK_STARTED_TTL_MS
  } catch {
    return false
  }
}

export function clearLoginLinkStarted(): void {
  try {
    window.sessionStorage.removeItem(LINK_STARTED_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}
