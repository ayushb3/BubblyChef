/**
 * ProfilePage (issue #394): the About block (app name + version) is
 * developer/meta filler and must not render for end users; dietary
 * preferences must load from the user's `user_profiles` row.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getUser = jest.fn()
const single = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          single,
        }),
      }),
    }),
  }),
}))

// These render server/client children that pull in browser-only bits
// (ThemeProvider context, Supabase browser client) irrelevant to this test.
jest.mock('@/components/auth/SaveAccountBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="save-account-banner" />,
}))
jest.mock('@/components/auth/SignOutButton', () => ({
  __esModule: true,
  default: () => <button>Sign out</button>,
}))
jest.mock('@/components/profile/DisplayNameField', () => ({
  __esModule: true,
  default: ({ initialName }: { initialName: string }) => <p>{initialName}</p>,
}))
jest.mock('@/components/ui/ThemePicker', () => ({
  __esModule: true,
  default: () => <div data-testid="theme-picker" />,
}))

import ProfilePage from '@/app/profile/page'

afterEach(() => {
  jest.clearAllMocks()
})

describe('ProfilePage (#394)', () => {
  it('does not render the About block (app name + version)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } })
    single.mockResolvedValue({ data: { id: 'profile-1', dietary_preferences: [] } })

    const jsx = await ProfilePage()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}>{jsx}</QueryClientProvider>)

    expect(screen.queryByText('About')).not.toBeInTheDocument()
    expect(screen.queryByText('0.1.0')).not.toBeInTheDocument()
    expect(screen.queryByText('BubblyChef ✨')).not.toBeInTheDocument()
  })

  it('loads existing dietary preferences from the user_profiles row as selected chips', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } })
    single.mockResolvedValue({
      data: { id: 'profile-1', dietary_preferences: ['Vegan', 'Dairy-Free'] },
    })

    const jsx = await ProfilePage()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}>{jsx}</QueryClientProvider>)

    expect(screen.getByRole('checkbox', { name: 'Vegan' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: 'Dairy-Free' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: 'Vegetarian' })).toHaveAttribute('aria-checked', 'false')
  })

  it('falls back to no profile id / empty selection when the user has no profile row yet', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'guest-1', email: null } } })
    single.mockResolvedValue({ data: null })

    const jsx = await ProfilePage()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}>{jsx}</QueryClientProvider>)

    expect(screen.getByRole('checkbox', { name: 'Vegetarian' })).toHaveAttribute('aria-checked', 'false')
  })
})
