/**
 * Hands an email from the profile's "Save your account" card to /login
 * (issue #588) so a returning user doesn't retype it. Uses sessionStorage
 * rather than a query param so the address never lands in the URL, history
 * or server logs. Storage can be unavailable (private mode, blocked site
 * data); prefill is a convenience, so failures are ignored.
 */
const KEY = 'bubblychef:login-email'

export function stashLoginEmail(email: string): void {
  try {
    if (email) window.sessionStorage.setItem(KEY, email)
  } catch {
    // ignore: prefill is optional
  }
}

/** Returns the stashed email once, then clears it. */
export function takeLoginEmail(): string | null {
  try {
    const email = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    return email
  } catch {
    return null
  }
}
