/**
 * Issue #497 (Spec B.5): `useGroceryCount()`, the hook Spec B.4's inbox uses to
 * show "N items on your list". The count is what the list shows after a
 * Regenerate: the saved list (checked and manual lines kept) merged with what
 * the pantry says is depleted or expiring, counting the unchecked lines.
 */

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { addToGroceryList, saveGroceryLines, saveGroceryState } from '@/lib/grocery-store'
import { addManualLines, dismissalsFor, setLineChecked } from '@/lib/grocery'

const mockGetUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } }),
}))

const mockFetchPantry = jest.fn()
jest.mock('@/lib/api/pantry', () => ({
  fetchPantryItems: (...a: unknown[]) => mockFetchPantry(...a),
}))

import { useGroceryCount } from '@/hooks/useGroceryCount'

const ALICE = 'user-alice'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const PANTRY = [
  { name: 'eggs', category: 'dairy', quantity: 0, unit: 'item', days_until_expiry: null, is_expired: false },
  { name: 'milk', category: 'dairy', quantity: 1, unit: 'L', days_until_expiry: 1, is_expired: false },
  { name: 'rice', category: 'dry_goods', quantity: 3, unit: 'kg', days_until_expiry: 200, is_expired: false },
]

beforeEach(() => {
  window.localStorage.clear()
  mockGetUser.mockReset()
  mockFetchPantry.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: ALICE } } })
  mockFetchPantry.mockResolvedValue(PANTRY)
})

describe('useGroceryCount', () => {
  it('counts what the pantry says to buy when nothing is saved yet', async () => {
    const { result } = renderHook(() => useGroceryCount(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(2) // eggs (depleted) + milk (expiring); fresh rice is not listed
  })

  it('adds manual lines and skips checked ones', async () => {
    let lines = addManualLines([], ['paper towels', 'eggs'])
    lines = setLineChecked(lines, 'egg', true) // got the eggs: not counted, and not duplicated
    saveGroceryLines(ALICE, lines)

    const { result } = renderHook(() => useGroceryCount(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(2) // paper towels + milk
  })

  it('updates when an item is added from elsewhere in the app ("Add to list")', async () => {
    const { result } = renderHook(() => useGroceryCount(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(2)

    act(() => {
      addToGroceryList(ALICE, ['basil'])
    })
    await waitFor(() => expect(result.current.count).toBe(3))
  })

  it('does not count a suggestion the user dismissed', async () => {
    saveGroceryState(ALICE, [], dismissalsFor(['egg'], PANTRY))
    const { result } = renderHook(() => useGroceryCount(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(1) // milk only
  })

  it("ignores another user's saved list", async () => {
    saveGroceryLines('user-bob', addManualLines([], ['caviar', 'truffles']))
    const { result } = renderHook(() => useGroceryCount(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(2) // Alice's own pantry-derived lines only
  })

  it('falls back to the saved list alone when the pantry cannot be read', async () => {
    mockFetchPantry.mockRejectedValue(new Error('boom'))
    saveGroceryLines(ALICE, addManualLines([], ['paper towels']))
    const { result } = renderHook(() => useGroceryCount(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(1)
  })

  it('is 0 with no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { result } = renderHook(() => useGroceryCount(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.count).toBe(0)
  })
})
