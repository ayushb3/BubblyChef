/**
 * Issue #389: a guest who taps "Continue with Google" on /login must LINK the
 * Google identity to their anonymous user id (so pantry, recipes, chat and
 * bubbles stay), not sign in as a brand-new user.
 *
 * The real Google OAuth round trip can't run here, so the Supabase client is
 * mocked at the boundary: these tests prove WHICH call the page makes
 * (linkIdentity vs signInWithOAuth) and how it reacts to the collision where
 * the Google account already belongs to another BubblyChef user.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LoginPage from '@/app/login/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const mockGetUser = jest.fn()
const mockLinkIdentity = jest.fn()
const mockSignInWithOAuth = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
      linkIdentity: (...args: unknown[]) => mockLinkIdentity(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
  }),
}))

const GUEST = { id: 'guest-1', is_anonymous: true }
const REAL = { id: 'real-1', is_anonymous: false }
const NO_SESSION = {
  data: { user: null },
  error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
}
const OAUTH_ARGS = expect.objectContaining({ provider: 'google' })

const SWITCHING =
  'You already have a BubblyChef account with that Google login. Signing you in. Your guest pantry stays behind.'
const FALLBACK =
  "That Google account already belongs to a different BubblyChef account. You can sign in to it instead, but your guest pantry won't move over."
const EXISTING_EMAIL =
  'That email already has a BubblyChef account. Sign in with your email and password instead.'
const SESSION_CHECK_FAILED = "Couldn't check your current session. Please try again."
const MANUAL_BUTTON = 'Sign in to that account instead'

function setUrl(search: string) {
  window.history.pushState({}, '', `/login${search}`)
}

function renderLogin() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginPage />
    </QueryClientProvider>,
  )
}

function clickGoogle() {
  fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
}

beforeEach(() => {
  mockGetUser.mockReset().mockResolvedValue({ data: { user: GUEST }, error: null })
  mockLinkIdentity.mockReset().mockResolvedValue({ error: null })
  mockSignInWithOAuth.mockReset().mockResolvedValue({ error: null })
})

afterEach(() => {
  window.history.pushState({}, '', '/login')
  window.sessionStorage.clear()
})

describe('guest Google sign-in links the identity (#389)', () => {
  it('a guest takes linkIdentity, never signInWithOAuth', async () => {
    renderLogin()
    clickGoogle()

    await waitFor(() => expect(mockLinkIdentity).toHaveBeenCalledWith(OAUTH_ARGS))
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
  })

  it('a signed-out visitor takes plain signInWithOAuth', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)
    renderLogin()
    clickGoogle()

    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledWith(OAUTH_ARGS))
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  it('a real (non-guest) user takes plain signInWithOAuth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: REAL }, error: null })
    renderLogin()
    clickGoogle()

    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledWith(OAUTH_ARGS))
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  it('fails closed when the session check errors: no fork, a retry message', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed' },
    })
    renderLogin()
    clickGoogle()

    expect(await screen.findByText(SESSION_CHECK_FAILED)).toBeInTheDocument()
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })
})

describe('Google account already belongs to another BubblyChef user (#389)', () => {
  it.each(['identity_already_exists', 'email_exists'])(
    'a guest whose linkIdentity fails with %s is signed in to the existing account',
    async (code) => {
      mockLinkIdentity.mockResolvedValue({ error: { code, message: 'collision' } })
      renderLogin()
      clickGoogle()

      await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledWith(OAUTH_ARGS))
      expect(screen.getByText(SWITCHING)).toBeInTheDocument()
      expect(screen.queryByText('collision')).not.toBeInTheDocument()
    },
  )

  it.each(['identity_already_exists', 'email_exists'])(
    'a guest redirected back with error_code=%s is signed in to the existing account',
    async (code) => {
      setUrl(`?error=${encodeURIComponent('raw supabase text')}&error_code=${code}`)
      renderLogin()

      await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledWith(OAUTH_ARGS))
      expect(screen.getByText(SWITCHING)).toBeInTheDocument()
      expect(screen.queryByText('raw supabase text')).not.toBeInTheDocument()
      // Neither param lingers in the URL for a refresh to re-trigger.
      expect(window.location.search).toBe('')
    },
  )

  it('never merges: the switch is a plain sign-in and linkIdentity is not retried', async () => {
    setUrl('?error=x&error_code=identity_already_exists')
    renderLogin()

    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1))
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  it('offers a manual button when the automatic switch cannot start', async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({ error: new Error('popup blocked') })
    setUrl('?error=x&error_code=email_exists')
    renderLogin()

    expect(await screen.findByText(FALLBACK)).toBeInTheDocument()
    expect(screen.queryByText(SWITCHING)).not.toBeInTheDocument()

    mockSignInWithOAuth.mockClear()
    fireEvent.click(screen.getByRole('button', { name: MANUAL_BUTTON }))
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledWith(OAUTH_ARGS))
    expect(mockLinkIdentity).not.toHaveBeenCalled()
  })

  it('does not switch a signed-out visitor and never mentions a guest pantry', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)
    setUrl('?error=x&error_code=email_exists')
    renderLogin()

    expect(await screen.findByText(EXISTING_EMAIL)).toBeInTheDocument()
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    expect(screen.queryByText(/guest pantry/)).not.toBeInTheDocument()
  })

  it('does not loop: a second collision after a switch stops with the email hint', async () => {
    setUrl('?error=x&error_code=email_exists')
    const first = renderLogin()
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1))
    first.unmount()

    // The switch came back with the same collision.
    setUrl('?error=x&error_code=email_exists')
    renderLogin()

    expect(await screen.findByText(EXISTING_EMAIL)).toBeInTheDocument()
    expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1)
  })

  it('does not auto-switch when sessionStorage is unavailable (a loop could not be guarded)', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    try {
      setUrl('?error=x&error_code=email_exists')
      renderLogin()

      expect(await screen.findByText(FALLBACK)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: MANUAL_BUTTON })).toBeInTheDocument()
      expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
    }
  })

  it('shows the manual button, not a dead end, when the session check fails on a collision', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed' },
    })
    setUrl('?error=x&error_code=email_exists')
    renderLogin()

    expect(await screen.findByRole('button', { name: MANUAL_BUTTON })).toBeInTheDocument()
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
  })

  it('a non-collision error_code still shows the raw error and does not switch', async () => {
    setUrl('?error=' + encodeURIComponent('Something odd') + '&error_code=unexpected_failure')
    renderLogin()

    expect(await screen.findByText('Something odd')).toBeInTheDocument()
    expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })
})
