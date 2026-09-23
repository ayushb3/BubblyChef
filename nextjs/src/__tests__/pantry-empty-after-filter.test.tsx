/**
 * Issue #465 — filtering the pantry and then deleting every item left the
 * empty state showing "No items match your filters" with the filter bar
 * hidden (it only renders while `hasItems`, per #405), so there was no
 * visible way to clear the stale filter. The empty-state copy checked
 * `search || hasActiveFacets` without also checking whether the pantry
 * itself still has items, so a search/facet combination left active from
 * before the last item was removed kept showing the "no matches" message
 * instead of the actual empty-pantry prompt.
 */

import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryPage from '@/app/pantry/page'
import type { PantryItem } from '@/types/pantry'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const ITEM: PantryItem = {
  id: 'item-1',
  name: 'Milk',
  category: 'dairy',
  location: 'fridge',
  quantity: 1,
  unit: 'gallon',
  expiry_date: null,
}

afterEach(() => {
  jest.restoreAllMocks()
})

it('shows the empty-pantry prompt, not the stale "no matches" text, once the last item is gone', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items: [ITEM] }),
  }) as unknown as typeof fetch

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <PantryPage />
    </QueryClientProvider>,
  )

  await screen.findByText('Milk')

  // Set an active search term (a stale filter carried over from before the
  // pantry emptied out) — it still matches the one item that exists so far.
  fireEvent.change(screen.getByPlaceholderText('Search items...'), {
    target: { value: 'Milk' },
  })

  // Simulate the last item being deleted (mirrors the resolve/delete
  // mutation's `invalidateQueries` landing a re-fetch with zero items),
  // while the search box above still holds "Milk".
  act(() => {
    queryClient.setQueryData(['pantry', {}], { items: [] })
  })

  expect(await screen.findByText('Your pantry is empty!')).toBeInTheDocument()
  expect(screen.queryByText('No items match your filters')).not.toBeInTheDocument()
})
