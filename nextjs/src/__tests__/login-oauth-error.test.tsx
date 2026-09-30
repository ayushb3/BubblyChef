/**
 * `/auth/callback` redirects a failed Google OAuth attempt back to
 * `/login?error=<message>` (issue #383). Nothing read that query param —
 * the redirect's payload was inert and a failed sign-in showed no error at
 * all. This covers the page picking it up on mount, displaying it, and
 * stripping it from the URL so a refresh doesn't re-show a stale error.
 *
 * The page also reads `useQueryClient()` (issue #651 code review — a
 * successful sign-in/sign-up clears the query cache so a guest's cached
 * data, e.g. the starter-context pills, can't leak into a real account
 * signed into the same tab), so every render here needs a
 * `QueryClientProvider` ancestor.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LoginPage from '@/app/login/page'

const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}))

const signInWithPassword = jest.fn()
const signUp = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signUp: (...args: unknown[]) => signUp(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signInWithOAuth: jest.fn(),
    },
  }),
}))

function setUrl(search: string) {
  window.history.pushState({}, '', `/login${search}`)
}

function renderLogin(client: QueryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <LoginPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterEach(() => {
  window.history.pushState({}, '', '/login')
})

describe('login page reads the OAuth callback error (#383)', () => {
  it('shows the error message from ?error=... on mount', () => {
    setUrl('?error=' + encodeURIComponent('Could not sign in with Google'))
    renderLogin()
    expect(screen.getByText('Could not sign in with Google')).toBeInTheDocument()
  })

  it('strips the error param from the URL after reading it', () => {
    setUrl('?error=' + encodeURIComponent('Something went wrong'))
    renderLogin()
    expect(window.location.search).toBe('')
  })

  it('shows no error when there is none in the URL', () => {
    setUrl('')
    renderLogin()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })
})

describe('login page clears the query cache on a successful sign-in (issue #651 code review)', () => {
  it('a successful password sign-in clears the query client before navigating', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    const client = new QueryClient()
    const clearSpy = jest.spyOn(client, 'clear')
    // Seed the cache the way a guest's starter-context fetch would.
    client.setQueryData(['pantry', 'starter-context'], { pantry_count: 0 })

    renderLogin(client)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'real@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(clearSpy).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['pantry', 'starter-context'])).toBeUndefined()
  })

  it('a sign-up that returns an immediate session also clears the cache', async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    const client = new QueryClient()
    const clearSpy = jest.spyOn(client, 'clear')

    renderLogin(client)
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(clearSpy).toHaveBeenCalledTimes(1)
  })

  it('a sign-up that needs email confirmation (no session) does not clear the cache or navigate', async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null })
    const client = new QueryClient()
    const clearSpy = jest.spyOn(client, 'clear')

    renderLogin(client)
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))

    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeInTheDocument())
    expect(clearSpy).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('a failed sign-in does not clear the cache', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') })
    const client = new QueryClient()
    const clearSpy = jest.spyOn(client, 'clear')

    renderLogin(client)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'real@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument())
    expect(clearSpy).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})
