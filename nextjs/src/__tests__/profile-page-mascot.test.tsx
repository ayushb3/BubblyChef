/**
 * ProfilePage (issue #832): the header avatar must be the shared
 * `BubblesMascot` (happy state, 80px), not a raw <img>. A raw image skips the
 * mascot's reduced-motion handling and its state -> art mapping.
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
jest.mock('@/components/profile/TakeTourButton', () => ({
  __esModule: true,
  default: () => <button>Take the tour</button>,
}))
// Opens the app-level TourProvider's staples sheet (#853), which this render doesn't mount.
jest.mock('@/components/profile/SetUpStaplesButton', () => ({
  __esModule: true,
  default: () => <button>Staples &amp; household size</button>,
}))
jest.mock('@/components/ui/ThemePicker', () => ({
  __esModule: true,
  default: () => <div data-testid="theme-picker" />,
}))

import ProfilePage from '@/app/profile/page'

afterEach(() => {
  jest.clearAllMocks()
})

describe('ProfilePage mascot (#832)', () => {
  it('renders Bubbles through BubblesMascot in the happy state at 80px', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } })
    single.mockResolvedValue({ data: { id: 'profile-1', dietary_preferences: [] } })

    const jsx = await ProfilePage()
    render(<QueryClientProvider client={new QueryClient()}>{jsx}</QueryClientProvider>)

    // BubblesMascot labels its image `Bubbles <state>`; a raw <img> says just "Bubbles".
    const bubbles = screen.getByAltText('Bubbles happy')
    expect(bubbles).toHaveAttribute('width', '80')
    expect(bubbles).toHaveAttribute('height', '80')
    expect(bubbles.getAttribute('src')).toContain('bubbles-happy.png')
  })
})
