/**
 * Read the signed-in user's id from the Supabase auth cookie(s) a browser
 * context holds — used by the guest-walkthrough e2e to find (and later
 * delete) the anonymous user it created.
 *
 * Pure (no Playwright import) so it can be unit-tested from jest:
 * src/__tests__/e2e-guest-auth-cookie.test.ts.
 */

export interface CookieLike {
  name: string
  value: string
}

const BASE64_PREFIX = 'base64-'

/**
 * The cookie's full value. @supabase/ssr writes `<key>` when the encoded
 * session fits in one cookie, and splits it into `<key>.0`, `<key>.1`, … once
 * it is longer than its chunk size (3180 chars). Chunks are numbered from 0
 * with no gaps and are joined in order; a gap means the set is incomplete.
 */
function joinedCookieValue(cookies: CookieLike[], key: string): string | null {
  const whole = cookies.find((c) => c.name === key)
  if (whole) return whole.value

  const byName = new Map(cookies.map((c) => [c.name, c.value]))
  const parts: string[] = []
  for (let i = 0; byName.has(`${key}.${i}`); i++) {
    parts.push(byName.get(`${key}.${i}`) as string)
  }
  if (parts.length === 0) return null
  // A higher-numbered chunk with a hole before it: incomplete, don't guess.
  const chunkIndexes = cookies
    .filter((c) => c.name.startsWith(`${key}.`))
    .map((c) => Number(c.name.slice(key.length + 1)))
    .filter(Number.isInteger)
  if (Math.max(...chunkIndexes) !== parts.length - 1) return null
  return parts.join('')
}

/** Decode a JWT's payload without verifying it; we only need `sub`. */
function jwtSub(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1]
    // Node's base64 decoder also accepts the base64url alphabet JWTs use.
    const parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as { sub?: string }
    return parsed.sub ?? null
  } catch {
    return null
  }
}

/**
 * The user id in the session stored under `key`, or null if there is no
 * complete, readable session cookie.
 *
 * A session written by @supabase/ssr is `base64-` + base64url(JSON). The
 * pre-authenticated fixture (global-setup.ts) writes raw JSON by hand, so that
 * shape (and its URI-encoded form) is accepted too.
 */
export function guestUidFromCookies(cookies: CookieLike[], key: string): string | null {
  const value = joinedCookieValue(cookies, key)
  if (value === null) return null

  const candidates = value.startsWith(BASE64_PREFIX)
    ? [Buffer.from(value.slice(BASE64_PREFIX.length), 'base64').toString('utf-8')]
    : [value, decodeURIComponent(value)]

  for (const candidate of candidates) {
    try {
      const session = JSON.parse(candidate) as { access_token?: string } | [string]
      const accessToken = Array.isArray(session) ? session[0] : session.access_token
      return accessToken ? jwtSub(accessToken) : null
    } catch {
      // try the next candidate
    }
  }
  return null
}
