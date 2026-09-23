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
})
