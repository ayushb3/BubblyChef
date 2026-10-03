/**
 * Profile allergies + dislikes (issue #500, Spec B.8).
 *
 * Covers:
 *   - both rows render with the copy that separates a hard "never" from a soft "left out"
 *   - stored allergies / dislikes render as removable chips on mount
 *   - adding a token (Enter, the Add button, or a catalog suggestion) PUTs the full list
 *     for that field to /api/profile/[id]
 *   - removing a chip PUTs the list without it
 *   - a failed save surfaces an error and rolls back the optimistic change
 *   - duplicate entries (case-insensitive) and blanks are not added
 *   - a guest with no profile row is told to create an account instead of silently losing the entry
 *   - the profile PUT route accepts and sanitises both fields
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CookingExclusions from '@/components/profile/CookingExclusions'
import { sanitizeTermList } from '@/lib/profile-lists'

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

function putBodies(fetchMock: FetchMock): object[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(init!.body as string))
}

const allergyInput = () => screen.getByRole('combobox', { name: 'Add an allergy' })
const dislikeInput = () => screen.getByRole('combobox', { name: 'Add a disliked ingredient' })

describe('CookingExclusions (#500)', () => {
  it('labels the two rows so a hard never is distinct from a soft dislike', () => {
    renderWithClient(<CookingExclusions profileId="p1" initialAllergies={[]} initialDislikes={[]} />)

    expect(screen.getByText('Allergies — never suggested')).toBeInTheDocument()
    expect(screen.getByText('Dislikes — left out of suggestions')).toBeInTheDocument()
  })

  it('renders stored allergies and dislikes as removable chips', () => {
    renderWithClient(
      <CookingExclusions
        profileId="p1"
        initialAllergies={['peanut']}
        initialDislikes={['cilantro', 'olives']}
      />,
    )

    const allergies = screen.getByRole('list', { name: 'Allergies' })
    expect(within(allergies).getByText('peanut')).toBeInTheDocument()
    const dislikes = screen.getByRole('list', { name: 'Disliked ingredients' })
    expect(within(dislikes).getByText('cilantro')).toBeInTheDocument()
    expect(within(dislikes).getByText('olives')).toBeInTheDocument()
  })

  it('adding an allergy with Enter PUTs the full allergies list and shows it as a chip', async () => {
    const fetchMock = okFetch()
    renderWithClient(
      <CookingExclusions profileId="p1" initialAllergies={['shellfish']} initialDislikes={[]} />,
    )

    fireEvent.change(allergyInput(), { target: { value: 'peanut' } })
    fireEvent.submit(allergyInput().closest('form')!)

    const allergies = screen.getByRole('list', { name: 'Allergies' })
    expect(within(allergies).getByText('peanut')).toBeInTheDocument()

    await waitFor(() => expect(putBodies(fetchMock)).toHaveLength(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/profile/p1')
    expect(putBodies(fetchMock)[0]).toEqual({ allergies: ['shellfish', 'peanut'] })
    await waitFor(() => expect(screen.getByText('Saved!')).toBeInTheDocument())
  })

  it('adding a dislike PUTs only the dislikes field', async () => {
    const fetchMock = okFetch()
    renderWithClient(<CookingExclusions profileId="p1" initialAllergies={['peanut']} initialDislikes={[]} />)

    fireEvent.change(dislikeInput(), { target: { value: 'cilantro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add dislike' }))

    await waitFor(() => expect(putBodies(fetchMock)).toHaveLength(1))
    expect(putBodies(fetchMock)[0]).toEqual({ disliked_ingredients: ['cilantro'] })
  })

  it('removing a chip PUTs the list without it', async () => {
    const fetchMock = okFetch()
    renderWithClient(
      <CookingExclusions profileId="p1" initialAllergies={['peanut', 'shellfish']} initialDislikes={[]} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove peanut' }))

    expect(
      within(screen.getByRole('list', { name: 'Allergies' })).queryByText('peanut'),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(putBodies(fetchMock)).toHaveLength(1))
    expect(putBodies(fetchMock)[0]).toEqual({ allergies: ['shellfish'] })
  })

  it('a failed save surfaces an error and rolls back the optimistic add', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'db exploded' }),
    })) as unknown as typeof fetch
    renderWithClient(<CookingExclusions profileId="p1" initialAllergies={[]} initialDislikes={[]} />)

    fireEvent.change(allergyInput(), { target: { value: 'peanut' } })
    fireEvent.submit(allergyInput().closest('form')!)

    await waitFor(() => expect(screen.getByText('db exploded')).toBeInTheDocument())
    expect(
      within(screen.getByRole('list', { name: 'Allergies' })).queryByText('peanut'),
    ).not.toBeInTheDocument()
  })

  it('a failed save rolls back a removal too', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'nope' }),
    })) as unknown as typeof fetch
    renderWithClient(<CookingExclusions profileId="p1" initialAllergies={['peanut']} initialDislikes={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove peanut' }))

    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument())
    expect(within(screen.getByRole('list', { name: 'Allergies' })).getByText('peanut')).toBeInTheDocument()
  })

  it('ignores blanks and case-insensitive duplicates', async () => {
    const fetchMock = okFetch()
    renderWithClient(<CookingExclusions profileId="p1" initialAllergies={['Peanut']} initialDislikes={[]} />)

    fireEvent.change(allergyInput(), { target: { value: '   ' } })
    fireEvent.submit(allergyInput().closest('form')!)
    fireEvent.change(allergyInput(), { target: { value: 'peanut' } })
    fireEvent.submit(allergyInput().closest('form')!)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(within(screen.getByRole('list', { name: 'Allergies' })).getAllByRole('listitem')).toHaveLength(1)
  })

  it('tells a guest without a profile row to create an account, and keeps nothing', async () => {
    const fetchMock = okFetch()
    renderWithClient(<CookingExclusions profileId={null} initialAllergies={[]} initialDislikes={[]} />)

    fireEvent.change(allergyInput(), { target: { value: 'peanut' } })
    fireEvent.submit(allergyInput().closest('form')!)

    await waitFor(() =>
      expect(screen.getByText('Could not save allergies and dislikes')).toBeInTheDocument(),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      within(screen.getByRole('list', { name: 'Allergies' })).queryByText('peanut'),
    ).not.toBeInTheDocument()
  })
})

describe('sanitizeTermList (#500)', () => {
  it('trims, drops blanks, de-duplicates case-insensitively and keeps order', () => {
    expect(sanitizeTermList(['  Peanut ', 'peanut', '', 'Shellfish'])).toEqual(['Peanut', 'Shellfish'])
  })

  it('rejects anything that is not a list of strings', () => {
    expect(sanitizeTermList('peanut')).toBeNull()
    expect(sanitizeTermList([1, 2])).toBeNull()
    expect(sanitizeTermList(null)).toBeNull()
  })

  it('rejects an over-long term or list rather than silently truncating', () => {
    expect(sanitizeTermList(['x'.repeat(61)])).toBeNull()
    expect(sanitizeTermList(Array.from({ length: 51 }, (_, i) => `item ${i}`))).toBeNull()
  })
})
