/**
 * Issue #405 — the pantry filter bar renders on an empty pantry, where it
 * looks broken (nothing to filter). It should only render once there is at
 * least one item in the pantry (`allItems.length > 0`), not merely once the
 * *filtered* list is empty — a search/facet combination that matches zero
 * items must still show the bar so the user can change their filters.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
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

function mockPantryFetch(items: PantryItem[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ items }),
  }) as unknown as typeof fetch
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PantryPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  jest.restoreAllMocks()
})

it('hides the facet filter bar when the pantry has zero items', async () => {
  mockPantryFetch([])
  renderPage()

  expect(await screen.findByText('Your pantry is empty!')).toBeInTheDocument()

  expect(screen.queryByLabelText(/Filter by location/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Filter by category/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Filter by expiry status/)).not.toBeInTheDocument()
})

it('still shows the facet filter bar when items exist but filters match zero', async () => {
  mockPantryFetch([ITEM])
  renderPage()

  // Wait for the item to render, then the facet bar must already be present.
  await screen.findByText('Milk')

  expect(screen.getByLabelText(/Filter by location/)).toBeInTheDocument()
  expect(screen.getByLabelText(/Filter by category/)).toBeInTheDocument()
  expect(screen.getByLabelText(/Filter by expiry status/)).toBeInTheDocument()
})
