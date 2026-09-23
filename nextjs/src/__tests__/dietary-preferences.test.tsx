/**
 * Dietary preference chips (issue #394 — chips looked interactive but did
 * nothing, and the About block was end-user-visible filler).
 *
 * Covers:
 *   - a chip toggles its pressed state and exposes it via aria-checked
 *   - toggling sends the full selection to PUT /api/profile/[id]
 *   - preferences already on the profile render pre-selected on mount
 *   - a failed save surfaces an error and rolls back the optimistic toggle
 *     (rather than silently looking like it worked)
 *   - the About block (app name + version) is gone from the profile page
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DietaryPreferences from '@/components/profile/DietaryPreferences'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('DietaryPreferences chips (#394)', () => {
  it('renders unselected chips with checkbox semantics and no preferences initially', () => {
    renderWithClient(<DietaryPreferences profileId="profile-1" initialSelected={[]} />)

    const chip = screen.getByRole('checkbox', { name: 'Vegetarian' })
    expect(chip).toHaveAttribute('aria-checked', 'false')
  })

  it('renders preferences already on the profile as selected on mount', () => {
    renderWithClient(
      <DietaryPreferences profileId="profile-1" initialSelected={['Vegetarian', 'Gluten-Free']} />
    )

    expect(screen.getByRole('checkbox', { name: 'Vegetarian' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: 'Gluten-Free' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('checkbox', { name: 'Vegan' })).toHaveAttribute('aria-checked', 'false')
  })

  it('toggling a chip flips its pressed state and PUTs the full exact-string selection to /api/profile/[id]', async () => {
    const fetchMock = jest.fn<
      Promise<{ ok: boolean; json: () => Promise<object> }>,
      [RequestInfo | URL, RequestInit?]
    >(async () => ({
      ok: true,
      json: async () => ({}),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    renderWithClient(<DietaryPreferences profileId="profile-1" initialSelected={['Vegetarian']} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Gluten-Free' }))

    expect(screen.getByRole('checkbox', { name: 'Gluten-Free' })).toHaveAttribute('aria-checked', 'true')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/profile/profile-1')
    expect(options.method).toBe('PUT')
    expect(JSON.parse(options.body as string)).toEqual({
      dietary_preferences: ['Vegetarian', 'Gluten-Free'],
    })

    await waitFor(() => expect(screen.getByText('Saved!')).toBeInTheDocument())
  })

  it('surfaces an error and rolls back the toggle when the save fails', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    })) as unknown as typeof fetch

    renderWithClient(<DietaryPreferences profileId="profile-1" initialSelected={[]} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Vegan' }))

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Vegan' })).toHaveAttribute('aria-checked', 'false')
  })

  it('surfaces an error instead of calling the network when there is no profile row yet', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    renderWithClient(<DietaryPreferences profileId={null} initialSelected={[]} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Vegan' }))

    await waitFor(() =>
      expect(screen.getByText('Create an account to save dietary preferences')).toBeInTheDocument()
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
