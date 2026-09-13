/**
 * @jest-environment node
 *
 * Tests for `app/auth/callback/route.ts` (issue #383 — Google OAuth sign-in).
 *
 * The actual `exchangeCodeForSession` round-trip against a live Google/Supabase
 * OAuth flow can't be exercised in a sandbox (it requires a real Google account
 * and a real browser redirect). This file covers the logic that *is*
 * deterministic: how the route routes based on query params and the mocked
 * result of the exchange call.
 */
import { GET } from '@/app/auth/callback/route'

const mockExchangeCodeForSession = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) =>
        mockExchangeCodeForSession(...args),
    },
  }),
}))

afterEach(() => {
  jest.clearAllMocks()
})

describe('GET /auth/callback (#383)', () => {
  it('exchanges a valid code and redirects to the app root by default', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })

    const request = new Request('http://localhost/auth/callback?code=abc123')
    const res = await GET(request)

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('abc123')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/')
  })

  it('honours a `next` param on success', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })

    const request = new Request(
      'http://localhost/auth/callback?code=abc123&next=/pantry'
    )
    const res = await GET(request)

    expect(res.headers.get('location')).toBe('http://localhost/pantry')
  })

  it('redirects to /login with the error when the exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: 'invalid grant' },
    })

    const request = new Request('http://localhost/auth/callback?code=bad')
    const res = await GET(request)

    expect(res.headers.get('location')).toBe(
      'http://localhost/login?error=invalid%20grant'
    )
  })

  it('redirects to /login with the provider error when Google returns error_description, without attempting an exchange', async () => {
    const request = new Request(
      'http://localhost/auth/callback?error_description=access_denied'
    )
    const res = await GET(request)

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(
      'http://localhost/login?error=access_denied'
    )
  })

  it('redirects to /login when there is no code and no error_description', async () => {
    const request = new Request('http://localhost/auth/callback')
    const res = await GET(request)

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBe(
      'http://localhost/login?error=Missing%20authorization%20code'
    )
  })
})
