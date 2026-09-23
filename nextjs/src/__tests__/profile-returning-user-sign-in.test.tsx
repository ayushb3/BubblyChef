/**
 * Issue #588: the profile's "Save your account" card converts the current
 * guest, so it had no path for a returning user. It now links to /login,
 * and an already-registered email points there instead of showing raw
 * Supabase text. The typed email is handed to /login via sessionStorage.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getUser = jest.fn()
const onAuthStateChange = jest.fn()
const updateUser = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser,
      onAuthStateChange,
      updateUser,
      signInWithPassword: jest.fn(),
      signInWithOAuth: jest.fn(),
      signUp: jest.fn(),
    },
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

import SaveAccountBanner from '@/components/auth/SaveAccountBanner'
import LoginPage from '@/app/login/page'
import { stashLoginEmail, takeLoginEmail } from '@/lib/auth/login-prefill'

beforeEach(() => {
  jest.clearAllMocks()
  window.sessionStorage.clear()
  getUser.mockResolvedValue({ data: { user: { is_anonymous: true } } })
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } })
})

async function fillAndSubmit(email: string) {
  render(<SaveAccountBanner persistent />)
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } })
  fireEvent.click(screen.getByText('Save my account'))
}

describe('profile card: returning users (#588)', () => {
  it('shows an "Already have an account? Sign in" link to /login for a guest', async () => {
    render(<SaveAccountBanner persistent />)

    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link).toHaveAttribute('href', '/login')
  })

  it.each(['email_exists', 'user_already_exists'])(
    'points to /login instead of raw text when updateUser fails with %s',
    async (code) => {
      updateUser.mockResolvedValue({
        error: Object.assign(new Error('A user with this email address has already been registered'), { code }),
      })

      await fillAndSubmit('me@example.com')

      const link = await screen.findByRole('link', { name: 'Sign in to it instead' })
      expect(link).toHaveAttribute('href', '/login')
      expect(screen.getByText(/already has a BubblyChef account/)).toBeInTheDocument()
      expect(
        screen.queryByText('A user with this email address has already been registered')
      ).not.toBeInTheDocument()
    }
  )

  it('still shows other updateUser errors as-is', async () => {
    updateUser.mockResolvedValue({ error: Object.assign(new Error('Password too weak'), { code: 'weak_password' }) })

    await fillAndSubmit('me@example.com')

    expect(await screen.findByText('Password too weak')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign in to it instead' })).not.toBeInTheDocument()
  })

  it('hands the typed email to /login when a sign-in link is clicked', async () => {
    updateUser.mockResolvedValue({ error: Object.assign(new Error('taken'), { code: 'email_exists' }) })
    await fillAndSubmit('me@example.com')

    fireEvent.click(await screen.findByRole('link', { name: 'Sign in to it instead' }))

    expect(takeLoginEmail()).toBe('me@example.com')
  })

  it('/login prefills the handed-over email once', async () => {
    stashLoginEmail('me@example.com')

    render(<LoginPage />)

    await waitFor(() => expect(screen.getByPlaceholderText('you@email.com')).toHaveValue('me@example.com'))
    expect(takeLoginEmail()).toBeNull()
  })
})
