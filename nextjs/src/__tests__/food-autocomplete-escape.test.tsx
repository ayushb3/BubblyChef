/**
 * Issue #439 — Escape in the name autocomplete (`FoodAutocomplete`, used by
 * the manual "Type" pantry-add row) closed the whole `PantryAddSheet`
 * instead of just the suggestions listbox, discarding whatever the user had
 * typed. Reproduced in a running build: open the sheet, start typing an
 * ingredient name, press Escape once the dropdown appears — the sheet
 * vanished along with the typed text.
 *
 * `useModalFocusTrap` closes the sheet on any unhandled document-level
 * `Escape` keydown, so the fix has to stop that keydown from reaching
 * `document` while the listbox is open, and only let it through once the
 * listbox is already closed.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import * as foodsApi from '@/lib/api/foods'

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')
jest.mock('@/lib/api/foods')

const mockSearchFoods = foodsApi.searchFoods as jest.MockedFunction<typeof foodsApi.searchFoods>

function renderSheet(props: React.ComponentProps<typeof PantryAddSheet>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PantryAddSheet {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchFoods.mockResolvedValue([
    {
      canonical: 'Milk',
      category: 'dairy',
      icon_slug: null,
      valid_units: ['gallon'],
      expiry_days: 7,
      default_location: 'fridge',
      emoji: '🥛',
    },
  ])
})

it('Escape closes only the suggestions listbox, not the whole add sheet — a second Escape then closes the sheet', async () => {
  const onClose = jest.fn()
  renderSheet({ isOpen: true, onClose, initialTab: 'type', onItemsAdded: jest.fn() })

  const nameInput = screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)')
  fireEvent.change(nameInput, { target: { value: 'Mil' } })

  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())

  fireEvent.keyDown(nameInput, { key: 'Escape' })

  // The listbox closed, but the sheet did not, and the typed text survives.
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByDisplayValue('Mil')).toBeInTheDocument()

  fireEvent.keyDown(nameInput, { key: 'Escape' })

  expect(onClose).toHaveBeenCalledTimes(1)
})
