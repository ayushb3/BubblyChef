/**
 * SaveAccountBanner (issue #382 — guest mode via Supabase anonymous auth).
 *
 * Covers: hidden for a real user, shown + collapsible for a guest, and
 * that submitting the form calls the SDK's identity-linking path
 * (`supabase.auth.updateUser({ email, password })`) rather than some
 * invented custom endpoint. Real Supabase network behavior (whether the
 * confirmation email actually lands, the callback route flipping
 * `is_anonymous` to false) is browser-only unverified here — mocked below.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getUser = jest.fn()
const onAuthStateChange = jest.fn()
const updateUser = jest.fn()
const unsubscribe = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser,
      onAuthStateChange,
      updateUser,
    },
  }),
}))

import SaveAccountBanner from '@/components/auth/SaveAccountBanner'

beforeEach(() => {
  jest.clearAllMocks()
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
})

describe('SaveAccountBanner', () => {
  it('renders nothing for a real, already-authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: { is_anonymous: false } } })

    const { container } = render(<SaveAccountBanner />)

    await waitFor(() => expect(getUser).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the collapsed prompt for an anonymous guest', async () => {
    getUser.mockResolvedValue({ data: { user: { is_anonymous: true } } })

    render(<SaveAccountBanner />)

    expect(await screen.findByText(/save your account/i)).toBeInTheDocument()
  })

  it('can be dismissed for now', async () => {
    getUser.mockResolvedValue({ data: { user: { is_anonymous: true } } })

    const { container } = render(<SaveAccountBanner />)

    const dismiss = await screen.findByLabelText(/dismiss for now/i)
    fireEvent.click(dismiss)

    expect(container).toBeEmptyDOMElement()
  })

  it('expands to a form and calls supabase.auth.updateUser with email + password on submit', async () => {
    getUser.mockResolvedValue({ data: { user: { is_anonymous: true } } })
    updateUser.mockResolvedValue({ data: { user: { is_anonymous: true } }, error: null })

    render(<SaveAccountBanner />)

    const pill = await screen.findByText(/save your account/i)
    fireEvent.click(pill)

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'guest@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } })
    fireEvent.click(screen.getByRole('button', { name: /save my account/i }))

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ email: 'guest@example.com', password: 'hunter22' })
    )
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument()
  })

  it('surfaces an error instead of silently failing', async () => {
    getUser.mockResolvedValue({ data: { user: { is_anonymous: true } } })
    updateUser.mockResolvedValue({ data: { user: null }, error: new Error('Email already in use') })

    render(<SaveAccountBanner />)

    const pill = await screen.findByText(/save your account/i)
    fireEvent.click(pill)

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'taken@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } })
    fireEvent.click(screen.getByRole('button', { name: /save my account/i }))

    expect(await screen.findByText(/email already in use/i)).toBeInTheDocument()
  })
})
