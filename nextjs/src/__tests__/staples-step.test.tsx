/**
 * First-run "tick what you usually have" step (issue #853).
 *
 * Completing the step adds exactly the ticked items and sets the default servings;
 * skipping adds nothing. It is shown once, before the tour, and can be reopened
 * from Profile without adding what is already stocked a second time.
 */

import React from 'react'
import { render, screen, act, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TourProvider, useTour } from '@/components/onboarding/TourProvider'
import StaplesStep from '@/components/onboarding/StaplesStep'
import { STAPLE_GROUPS, ALL_STAPLES } from '@/lib/staples'

let mockPathname = '/'
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
}))

const getUserMock = jest.fn()
const updateUserMock = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: getUserMock, updateUser: updateUserMock } }),
}))

const bulkAddMock = jest.fn()
const fetchPantryMock = jest.fn()
jest.mock('@/lib/api/pantry', () => ({
  bulkAddPantryItems: (...args: unknown[]) => bulkAddMock(...args),
  fetchPantryItems: () => fetchPantryMock(),
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  })
})

beforeEach(() => {
  mockPathname = '/'
  getUserMock.mockReset()
  updateUserMock.mockReset().mockResolvedValue({ error: null })
  bulkAddMock.mockReset().mockResolvedValue({ count: 0, items: [] })
  fetchPantryMock.mockReset().mockResolvedValue([])
})

function Probe() {
  const { isOpen, staplesOpen, openStaples } = useTour()
  return (
    <div>
      <div data-testid="tour-open">{String(isOpen)}</div>
      <div data-testid="staples-open">{String(staplesOpen)}</div>
      <button onClick={openStaples}>open-from-profile</button>
    </div>
  )
}

async function renderApp(metadata: Record<string, unknown>) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: metadata } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <TourProvider>
          <Probe />
          <StaplesStep />
        </TourProvider>
      </QueryClientProvider>,
    )
  })
}

const sheet = () => screen.getByTestId('staples-step')
const names = (items: Array<{ name: string }>) => items.map((i) => i.name).sort()

describe('first-run gating', () => {
  it('opens the staples sheet, not the tour, on a first run', async () => {
    await renderApp({})
    await waitFor(() => expect(screen.getByTestId('staples-open').textContent).toBe('true'))
    expect(screen.getByTestId('tour-open').textContent).toBe('false')
    expect(screen.getByRole('dialog', { name: /tick what you usually have/i })).toBeTruthy()
  })

  it('goes straight to the tour when the staples step was already seen', async () => {
    await renderApp({ staples_step_done: true })
    await waitFor(() => expect(screen.getByTestId('tour-open').textContent).toBe('true'))
    expect(screen.getByTestId('staples-open').textContent).toBe('false')
  })

  it('shows neither once onboarding is complete', async () => {
    await renderApp({ onboarding_completed: true })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.getByTestId('staples-open').textContent).toBe('false')
    expect(screen.getByTestId('tour-open').textContent).toBe('false')
  })
})

describe('the staples list', () => {
  it('offers about two dozen staples in four groups', async () => {
    await renderApp({})
    await screen.findByTestId('staples-step')
    expect(STAPLE_GROUPS.map((g) => g.title)).toEqual([
      'Oils & condiments',
      'Spices',
      'Dry goods',
      'Fridge basics',
    ])
    expect(ALL_STAPLES).toHaveLength(24)
    for (const group of STAPLE_GROUPS) {
      const section = screen.getByRole('heading', { name: group.title }).closest('section')!
      for (const item of group.items) {
        expect(within(section as HTMLElement).getByRole('button', { name: item.name })).toBeTruthy()
      }
    }
  })
})

describe('completing the step', () => {
  it('adds exactly the ticked items, sets the household size, then starts the tour', async () => {
    const user = userEvent.setup()
    await renderApp({})
    await screen.findByTestId('staples-step')

    await user.click(within(sheet()).getByRole('button', { name: 'Olive oil' }))
    await user.click(within(sheet()).getByRole('button', { name: 'Salt' }))
    await user.click(within(sheet()).getByRole('button', { name: 'Eggs' }))
    await user.click(within(sheet()).getByRole('button', { name: '4 people' }))

    const add = screen.getByRole('button', { name: 'Add 3' })
    await user.click(add)

    await waitFor(() => expect(bulkAddMock).toHaveBeenCalledTimes(1))
    const items = bulkAddMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(names(items as Array<{ name: string }>)).toEqual(['Eggs', 'Olive oil', 'Salt'])

    const byName = Object.fromEntries(items.map((i) => [i.name as string, i]))
    // Shelf-stable: no expiry, never estimated.
    expect(byName['Olive oil']).toMatchObject({ no_expiry: true, storage_location: 'pantry' })
    expect(byName['Salt']).toMatchObject({ no_expiry: true, storage_location: 'pantry' })
    // Fridge basics keep the normal estimate.
    expect(byName['Eggs']).toMatchObject({ storage_location: 'fridge', expiry_date: null })
    expect(byName['Eggs'].no_expiry).toBeUndefined()

    expect(updateUserMock).toHaveBeenCalledWith({ data: { household_size: 4 } })
    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith({ data: { staples_step_done: true } }),
    )

    await waitFor(() => expect(screen.getByTestId('staples-open').textContent).toBe('false'))
    expect(screen.getByTestId('tour-open').textContent).toBe('true')
  })

  it('un-ticking removes an item from the add', async () => {
    const user = userEvent.setup()
    await renderApp({})
    await screen.findByTestId('staples-step')

    await user.click(within(sheet()).getByRole('button', { name: 'Rice' }))
    await user.click(within(sheet()).getByRole('button', { name: 'Pasta' }))
    await user.click(within(sheet()).getByRole('button', { name: 'Rice' }))
    await user.click(screen.getByRole('button', { name: 'Add 1' }))

    await waitFor(() => expect(bulkAddMock).toHaveBeenCalledTimes(1))
    expect(names(bulkAddMock.mock.calls[0][0])).toEqual(['Pasta'])
  })

  it('household size alone saves without adding anything', async () => {
    const user = userEvent.setup()
    await renderApp({})
    await screen.findByTestId('staples-step')

    await user.click(within(sheet()).getByRole('button', { name: '6 or more people' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith({ data: { household_size: 6 } }),
    )
    expect(bulkAddMock).not.toHaveBeenCalled()
  })

  it('writes nothing and stays open when the add fails, then retries without re-saving a failure', async () => {
    const user = userEvent.setup()
    bulkAddMock.mockRejectedValueOnce(new Error('boom'))
    await renderApp({})
    await screen.findByTestId('staples-step')

    await user.click(within(sheet()).getByRole('button', { name: 'Flour' }))
    await user.click(screen.getByRole('button', { name: 'Add 1' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByTestId('staples-open').textContent).toBe('true')
    expect(updateUserMock).not.toHaveBeenCalledWith({ data: { staples_step_done: true } })

    await user.click(screen.getByRole('button', { name: 'Add 1' }))
    await waitFor(() => expect(bulkAddMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('staples-open').textContent).toBe('false'))
  })
})

describe('skipping', () => {
  it('adds nothing and sets nothing, but marks the step seen and starts the tour', async () => {
    const user = userEvent.setup()
    await renderApp({})
    await screen.findByTestId('staples-step')

    // Ticking and picking a size, then skipping, still writes none of it.
    await user.click(within(sheet()).getByRole('button', { name: 'Salt' }))
    await user.click(within(sheet()).getByRole('button', { name: '3 people' }))
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    await waitFor(() => expect(screen.getByTestId('staples-open').textContent).toBe('false'))
    expect(bulkAddMock).not.toHaveBeenCalled()
    expect(updateUserMock).not.toHaveBeenCalledWith({ data: { household_size: 3 } })
    expect(updateUserMock).toHaveBeenCalledWith({ data: { staples_step_done: true } })
    expect(screen.getByTestId('tour-open').textContent).toBe('true')
  })

  it('Escape counts as skip', async () => {
    const user = userEvent.setup()
    await renderApp({})
    await screen.findByTestId('staples-step')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByTestId('staples-open').textContent).toBe('false'))
    expect(bulkAddMock).not.toHaveBeenCalled()
  })
})

describe('reopened from Profile', () => {
  it('prefills the saved household size, skips what is already stocked, and does not start the tour', async () => {
    const user = userEvent.setup()
    fetchPantryMock.mockResolvedValue([
      { id: 'p1', name: 'olive oil', quantity: 1, unit: 'bottle' },
      { id: 'p2', name: 'Salt', quantity: 0, unit: 'item' },
    ])
    await renderApp({ onboarding_completed: true, household_size: 3 })
    await user.click(screen.getByRole('button', { name: 'open-from-profile' }))
    await screen.findByTestId('staples-step')

    await waitFor(() =>
      expect(within(sheet()).getByRole('button', { name: '3 people' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    )
    // Stocked: shown but not toggleable. Used up (quantity 0): offered again.
    await waitFor(() =>
      expect(within(sheet()).queryByRole('button', { name: 'Olive oil' })).toBeNull(),
    )
    expect(within(sheet()).getByRole('button', { name: 'Salt' })).toBeTruthy()
    expect(within(sheet()).getByText(/already in your kitchen/i)).toBeTruthy()

    await user.click(within(sheet()).getByRole('button', { name: 'Salt' }))
    await user.click(screen.getByRole('button', { name: 'Add 1' }))

    await waitFor(() => expect(bulkAddMock).toHaveBeenCalledTimes(1))
    expect(names(bulkAddMock.mock.calls[0][0])).toEqual(['Salt'])
    await waitFor(() => expect(screen.getByTestId('staples-open').textContent).toBe('false'))
    expect(screen.getByTestId('tour-open').textContent).toBe('false')
  })
})
