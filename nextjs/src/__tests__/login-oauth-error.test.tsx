/**
 * `/auth/callback` redirects a failed Google OAuth attempt back to
 * `/login?error=<message>` (issue #383). Nothing read that query param —
 * the redirect's payload was inert and a failed sign-in showed no error at
 * all. This covers the page picking it up on mount, displaying it, and
 * stripping it from the URL so a refresh doesn't re-show a stale error.
 */
import { render, screen } from '@testing-library/react'
import LoginPage from '@/app/login/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signInWithOAuth: jest.fn(),
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
