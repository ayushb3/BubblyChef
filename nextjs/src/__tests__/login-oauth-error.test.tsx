/**
 * `/auth/callback` redirects a failed Google OAuth attempt back to
 * `/login?error=<message>` (issue #383). Nothing read that query param —
 * the redirect's payload was inert and a failed sign-in showed no error at
 * all. This covers the page picking it up on mount, displaying it, and
 * stripping it from the URL so a refresh doesn't re-show a stale error.
 */
import { render, screen, waitFor } from '@testing-library/react'
import LoginPage from '@/app/login/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

// Default mock: no active session (getUser resolves to a null user), so the
// guest-vs-real-user branch added for issue #389 takes the "not a guest"
// path and behaves like today's signed-out sign-in flow.
const mockGetUser = jest.fn().mockResolvedValue({ data: { user: null } })
const mockLinkIdentity = jest.fn().mockResolvedValue({ error: null })
const mockSignInWithOAuth = jest.fn().mockResolvedValue({ error: null })

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signInWithOAuth: mockSignInWithOAuth,
      getUser: mockGetUser,
      linkIdentity: mockLinkIdentity,
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
  }),
}))

function setUrl(search: string) {
  window.history.pushState({}, '', `/login${search}`)
}

afterEach(() => {
  window.history.pushState({}, '', '/login')
  window.sessionStorage.clear()
  mockGetUser.mockResolvedValue({ data: { user: null } })
})

describe('login page reads the OAuth callback error (#383)', () => {
  it('shows the error message from ?error=... on mount', () => {
    setUrl('?error=' + encodeURIComponent('Could not sign in with Google'))
    render(<LoginPage />)
    expect(screen.getByText('Could not sign in with Google')).toBeInTheDocument()
  })

  it('strips the error param from the URL after reading it', () => {
    setUrl('?error=' + encodeURIComponent('Something went wrong'))
    render(<LoginPage />)
    expect(window.location.search).toBe('')
  })

  it('shows no error when there is none in the URL', () => {
    setUrl('')
    render(<LoginPage />)
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })
})

describe('guest Google sign-in should link identity, not fork a new account (#389)', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockLinkIdentity.mockReset().mockResolvedValue({ error: null })
    mockSignInWithOAuth.mockReset().mockResolvedValue({ error: null })
  })

  it('calls linkIdentity (not signInWithOAuth) when the active session is a guest', async () => {
    // An anonymous (guest) session, per lib/auth/guest.ts's isGuestUser check.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } } })
    render(<LoginPage />)

    screen.getByText('Continue with Google').click()

    // Let the getUser() promise the click handler awaits resolve.
    await waitFor(() => expect(mockGetUser).toHaveBeenCalled())

    await waitFor(() => {
      expect(mockLinkIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' })
      )
    })
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
  })

  it('calls signInWithOAuth (not linkIdentity) when there is no active session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    render(<LoginPage />)

    screen.getByText('Continue with Google').click()

    await waitFor(() => expect(mockGetUser).toHaveBeenCalled())

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' })
      )
    })
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  it('fails closed when the session check errors: no signInWithOAuth, no new account (#389 review)', async () => {
    // A network error or expired token returns a null user WITH an error.
    // Treating that as "not a guest" would fork a new account and orphan the
    // guest's pantry, so nothing may be called and the user sees a retry.
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed' },
    })
    render(<LoginPage />)

    screen.getByText('Continue with Google').click()

    expect(await screen.findByText(/Couldn't check your current session/)).toBeInTheDocument()
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  it('still signs in normally when getUser reports no session at all', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
    })
    render(<LoginPage />)

    screen.getByText('Continue with Google').click()

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' })
      )
    })
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  it('calls signInWithOAuth (not linkIdentity) when the active session is a real (non-guest) user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'real-1', is_anonymous: false } },
    })
    render(<LoginPage />)

    screen.getByText('Continue with Google').click()

    await waitFor(() => expect(mockGetUser).toHaveBeenCalled())

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' })
      )
    })
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  const SWITCHING =
    "You already have a BubblyChef account with that Google login — signing you in. Your guest pantry stays behind."
  const FALLBACK =
    "That Google account already belongs to a different BubblyChef account. You can sign in to it instead, but your guest pantry won't move over."

  it('auto-signs in to the existing account on a synchronous identity_already_exists error from linkIdentity', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } } })
    mockLinkIdentity.mockResolvedValue({
      error: { code: 'identity_already_exists', message: 'Identity is already linked to another user' },
    })
    mockSignInWithOAuth.mockClear()
    render(<LoginPage />)

    screen.getByText('Continue with Google').click()

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' })
      )
    })
    expect(screen.getByText(SWITCHING)).toBeInTheDocument()
    expect(screen.queryByText('Identity is already linked to another user')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign in to that account instead')).not.toBeInTheDocument()
  })

  it.each(['identity_already_exists', 'email_exists'])(
    'auto-signs in when the redirect back from Google carries error_code=%s',
    async (code) => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } } })
      mockSignInWithOAuth.mockClear()
      setUrl(
        '?error=' +
          encodeURIComponent('A user with this email address has already been registered') +
          `&error_code=${code}`
      )
      render(<LoginPage />)

      await waitFor(() => {
        expect(mockSignInWithOAuth).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'google' })
        )
      })
      expect(screen.getByText(SWITCHING)).toBeInTheDocument()
      expect(
        screen.queryByText('A user with this email address has already been registered')
      ).not.toBeInTheDocument()
      expect(window.location.search).toBe('')
    }
  )

  it('falls back to the friendly message and manual button when the auto sign-in cannot start', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } } })
    mockSignInWithOAuth.mockResolvedValueOnce({ error: new Error('popup blocked') })
    setUrl('?error=x&error_code=email_exists')
    render(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByText(FALLBACK)).toBeInTheDocument()
    })
    expect(screen.queryByText(SWITCHING)).not.toBeInTheDocument()

    mockSignInWithOAuth.mockClear()
    screen.getByText('Sign in to that account instead').click()
    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' })
      )
    })
  })
  const EXISTING_EMAIL =
    'That email already has a BubblyChef account. Sign in with your email and password instead.'

  it('does not auto-switch a signed-out visitor, and says nothing about a guest pantry', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockSignInWithOAuth.mockClear()
    setUrl('?error=x&error_code=email_exists')
    render(<LoginPage />)

    expect(await screen.findByText(EXISTING_EMAIL)).toBeInTheDocument()
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    expect(screen.queryByText(/guest pantry/)).not.toBeInTheDocument()
  })

  it('does not loop: a second collision after an auto-switch stops with the email hint', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'guest-1', is_anonymous: true } } })
    mockSignInWithOAuth.mockClear()

    setUrl('?error=x&error_code=email_exists')
    const first = render(<LoginPage />)
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1))
    first.unmount()

    // The switch came back with the same collision.
    setUrl('?error=x&error_code=email_exists')
    render(<LoginPage />)

    expect(await screen.findByText(EXISTING_EMAIL)).toBeInTheDocument()
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1)
  })
})
