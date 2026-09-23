/**
 * Unit check for the guest-walkthrough e2e's cookie reader (#552 review).
 *
 * @supabase/ssr stores the session as `sb-<ref>-auth-token`, but once the
 * encoded value passes MAX_CHUNK_SIZE (3180) it splits it into
 * `sb-<ref>-auth-token.0`, `.1`, … instead. The spec's cleanup reads the guest
 * uid from this cookie; if it only looks for the unchunked name, a large
 * session yields no uid and the anonymous user is silently orphaned in the
 * hosted project.
 */
import { guestUidFromCookies } from '../../e2e/support/guest-auth-cookie'

const KEY = 'sb-abcdefgh-auth-token'
const UID = '0b5e8c3a-1d2f-4c6b-9a7e-5f4d3c2b1a09'

function base64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fakeJwt(sub: string): string {
  return `${base64url(JSON.stringify({ alg: 'HS256' }))}.${base64url(JSON.stringify({ sub, role: 'authenticated' }))}.sig`
}

/** What @supabase/ssr writes: `base64-` + base64url(JSON session). */
function ssrCookieValue(extra = ''): string {
  return 'base64-' + base64url(JSON.stringify({ access_token: fakeJwt(UID), refresh_token: 'r', padding: extra }))
}

describe('guestUidFromCookies', () => {
  it('reads the uid from a single unchunked cookie', () => {
    expect(guestUidFromCookies([{ name: KEY, value: ssrCookieValue() }], KEY)).toBe(UID)
  })

  it('reassembles a session @supabase/ssr split into .0/.1/.2 chunks', () => {
    const whole = ssrCookieValue('x'.repeat(7000)) // well past the 3180-char chunk size
    const chunks = [whole.slice(0, 3180), whole.slice(3180, 6360), whole.slice(6360)]
    const cookies = [
      // Deliberately out of order, with an unrelated cookie mixed in.
      { name: `${KEY}.2`, value: chunks[2] },
      { name: 'other', value: 'nope' },
      { name: `${KEY}.0`, value: chunks[0] },
      { name: `${KEY}.1`, value: chunks[1] },
    ]
    expect(guestUidFromCookies(cookies, KEY)).toBe(UID)
  })

  it('still reads a raw-JSON cookie (the pre-authenticated fixture writes one)', () => {
    const raw = JSON.stringify({ access_token: fakeJwt(UID) })
    expect(guestUidFromCookies([{ name: KEY, value: raw }], KEY)).toBe(UID)
  })

  it('returns null when there is no auth cookie at all', () => {
    expect(guestUidFromCookies([{ name: 'other', value: 'x' }], KEY)).toBeNull()
  })

  it('returns null when a chunk is missing from the middle', () => {
    const whole = ssrCookieValue('x'.repeat(7000))
    const cookies = [
      { name: `${KEY}.0`, value: whole.slice(0, 3180) },
      { name: `${KEY}.2`, value: whole.slice(6360) },
    ]
    expect(guestUidFromCookies(cookies, KEY)).toBeNull()
  })
})
