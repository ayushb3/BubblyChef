/**
 * ProfilePage (issue #587): a guest "signing out" only discards the
 * anonymous user (the middleware mints a new one on the next request), so
 * Sign out is shown to real accounts only.
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
// Needs the app-level TourProvider (onboarding tour, #390), which this
// server-page render doesn't mount.
jest.mock('@/components/profile/TakeTourButton', () => ({
  __esModule: true,
  default: () => <button>Take the tour</button>,
}))
jest.mock('@/components/ui/ThemePicker', () => ({
  __esModule: true,
  default: () => <div data-testid="theme-picker" />,
}))

import ProfilePage from '@/app/profile/page'

afterEach(() => {
  jest.clearAllMocks()
})

async function renderProfile() {
  const jsx = await ProfilePage()
  render(<QueryClientProvider client={new QueryClient()}>{jsx}</QueryClientProvider>)
}

describe('ProfilePage sign-out visibility (#587)', () => {
  it('hides Sign out for a guest session', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'guest-1', email: null, is_anonymous: true } } })
    single.mockResolvedValue({ data: null })

    await renderProfile()

    expect(screen.queryByText('Sign out')).not.toBeInTheDocument()
    expect(screen.getByTestId('save-account-banner')).toBeInTheDocument()
  })

  it('shows Sign out for a real account', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@example.com', is_anonymous: false } },
    })
    single.mockResolvedValue({ data: { id: 'profile-1', dietary_preferences: [] } })

    await renderProfile()

    expect(screen.getByText('Sign out')).toBeInTheDocument()
  })
})
