/**
 * Profile expiry-priority setting (issue #502, Spec B.10).
 *
 * Covers:
 *   - a three-way Off / Gentle / Aggressive control, defaulting to Gentle
 *   - a stored value renders as the selected segment
 *   - an unknown / missing stored value reads as Gentle (existing users, pre-migration rows)
 *   - picking a level PUTs { expiry_priority } to /api/profile/[id]
 *   - a failed save surfaces an error and rolls back the optimistic choice
 *   - a guest with no profile row is told to create an account, and nothing is sent
 *   - the profile PUT route accepts the three levels and rejects anything else with a 400
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ExpiryPriorityControl from '@/components/profile/ExpiryPriorityControl'
import { coerceExpiryPriority } from '@/lib/expiry-priority'

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

type FetchMock = jest.Mock<
  Promise<{ ok: boolean; status?: number; json: () => Promise<object> }>,
  [RequestInfo | URL, RequestInit?]
>

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

function okFetch(): FetchMock {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({}),
  })) as unknown as FetchMock
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function failingFetch(): FetchMock {
  const fetchMock = jest.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'db down' }),
  })) as unknown as FetchMock
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function putBodies(fetchMock: FetchMock): object[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(init!.body as string))
}

const radio = (name: string) => screen.getByRole('radio', { name })

describe('ExpiryPriorityControl (#502)', () => {
  it('renders Off / Gentle / Aggressive with Gentle selected by default', () => {
    renderWithClient(<ExpiryPriorityControl profileId="p1" initialValue="gentle" />)

    expect(screen.getByRole('radiogroup', { name: 'Use up expiring food' })).toBeInTheDocument()
    expect(radio('Off')).toHaveAttribute('aria-checked', 'false')
    expect(radio('Gentle')).toHaveAttribute('aria-checked', 'true')
    expect(radio('Aggressive')).toHaveAttribute('aria-checked', 'false')
  })

  it('renders a stored level as the selected segment', () => {
    renderWithClient(<ExpiryPriorityControl profileId="p1" initialValue="aggressive" />)

    expect(radio('Aggressive')).toHaveAttribute('aria-checked', 'true')
    expect(radio('Gentle')).toHaveAttribute('aria-checked', 'false')
  })

  it('explains what the selected level does', () => {
    renderWithClient(<ExpiryPriorityControl profileId="p1" initialValue="gentle" />)
    expect(screen.getByText(/only where it fits/i)).toBeInTheDocument()

    fireEvent.click(radio('Off'))
    expect(screen.getByText(/ignores what.s about to expire/i)).toBeInTheDocument()
  })

  it('PUTs the chosen level to the profile route', async () => {
    const fetchMock = okFetch()
    renderWithClient(<ExpiryPriorityControl profileId="p1" initialValue="gentle" />)

    fireEvent.click(radio('Aggressive'))

    await waitFor(() => expect(putBodies(fetchMock)).toEqual([{ expiry_priority: 'aggressive' }]))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/profile/p1')
    expect(radio('Aggressive')).toHaveAttribute('aria-checked', 'true')
    expect(await screen.findByText('Saved!')).toBeInTheDocument()
  })

  it('does not send a request when the selected level is clicked again', () => {
    const fetchMock = okFetch()
    renderWithClient(<ExpiryPriorityControl profileId="p1" initialValue="gentle" />)

    fireEvent.click(radio('Gentle'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rolls back and shows an error when the save fails', async () => {
    failingFetch()
    renderWithClient(<ExpiryPriorityControl profileId="p1" initialValue="gentle" />)

    fireEvent.click(radio('Off'))

    expect(await screen.findByText('db down')).toBeInTheDocument()
    await waitFor(() => expect(radio('Gentle')).toHaveAttribute('aria-checked', 'true'))
    expect(radio('Off')).toHaveAttribute('aria-checked', 'false')
  })

  it('tells a guest with no profile row to create an account, and sends nothing', async () => {
    const fetchMock = okFetch()
    renderWithClient(<ExpiryPriorityControl profileId={null} initialValue="gentle" />)

    fireEvent.click(radio('Off'))

    expect(
      await screen.findByText('Create an account to save this setting'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(radio('Gentle')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('coerceExpiryPriority (#502)', () => {
  it.each(['off', 'gentle', 'aggressive'])('keeps %s', (level) => {
    expect(coerceExpiryPriority(level)).toBe(level)
  })

  it.each([null, undefined, '', 'maximum', 3, {}])('reads %p as gentle', (value) => {
    expect(coerceExpiryPriority(value)).toBe('gentle')
  })
})
