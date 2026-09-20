/**
 * Issue #398 — manual "Type" pantry-add row: selecting a catalog suggestion
 * auto-fills unit/category/expiry, and the auto-filled expiry must
 * carry an explicit `estimated_expiry: true` in the eventual bulk-add
 * payload so the server flags it (mirrors #363's precedence). A date the
 * user types themselves — or edits after an autofill — must come out
 * `false`.
 *
 * Exercises the whole client chain: `AddItemRow` -> `TypeTab` ->
 * `PantryAddSheet`'s confirm -> `bulkAddPantryItems`, since that's the path
 * a real "Add Items" click takes (`PantryAddSheet` itself is untouched by
 * this issue — see #402's tab-persistence fix, which just landed).
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import * as pantryApi from '@/lib/api/pantry'
import * as foodsApi from '@/lib/api/foods'
import type { FoodCatalogEntry } from '@/lib/api/foods'

jest.mock('@/lib/api/pantry')
jest.mock('@/lib/api/foods')
jest.mock('@/lib/api/scan', () => ({
  uploadReceipt: jest.fn(),
  ScanError: class ScanError extends Error {},
  SCAN_CLIENT_TIMEOUT_CODE: 'timeout',
}))

const mockBulkAddPantryItems = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>
const mockSearchFoods = foodsApi.searchFoods as jest.MockedFunction<typeof foodsApi.searchFoods>

const MILK: FoodCatalogEntry = {
  canonical: 'milk',
  category: 'dairy',
  icon_slug: null,
  valid_units: ['gallon', 'quart', 'cup'],
  expiry_days: 10,
  default_location: 'fridge',
  emoji: '🥛',
}

function renderSheet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PantryAddSheet isOpen onClose={jest.fn()} initialTab="type" onItemsAdded={jest.fn()} />
    </QueryClientProvider>,
  )
}

async function selectMilkSuggestion() {
  const nameInput = screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)')
  fireEvent.change(nameInput, { target: { value: 'mi' } })
  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
  const option = screen.getAllByRole('option')[0]
  const { getByRole } = within(option)
  fireEvent.mouseDown(getByRole('button'))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchFoods.mockResolvedValue([MILK])
  mockBulkAddPantryItems.mockResolvedValue({ count: 1, items: [] })
})

describe('TypeTab catalog autofill -> bulk add payload (#398)', () => {
  it('selecting a suggestion fills unit, category and expiry, and confirms with estimated_expiry: true', async () => {
    renderSheet()

    await selectMilkSuggestion()

    expect(screen.getByDisplayValue('milk')).toBeInTheDocument()
    expect(screen.getByLabelText('Unit')).toHaveValue('gallon')
    expect(screen.getByLabelText('Category')).toHaveValue('dairy')
    // No kitchen-location control any more (#397); the catalog's
    // `default_location` is simply not used.
    expect(screen.queryByLabelText('Storage location')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Expiry date')).not.toHaveValue('')
    expect(screen.getByText('(est.)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add 1 Item/i }))

    await waitFor(() => expect(mockBulkAddPantryItems).toHaveBeenCalledTimes(1))
    const payload = mockBulkAddPantryItems.mock.calls[0][0]
    expect(payload).toHaveLength(1)
    expect(payload[0]).toMatchObject({
      name: 'milk',
      unit: 'gallon',
      category: 'dairy',
      estimated_expiry: true,
    })
    // Manual adds no longer send a location; the server default applies (#397).
    expect(payload[0]).not.toHaveProperty('storage_location')
    expect(payload[0].expiry_date).toEqual(expect.any(String))
  })

  it('a purely user-typed expiry date (no autofill) confirms with estimated_expiry: false', async () => {
    renderSheet()

    fireEvent.change(screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)'), {
      target: { value: 'Salt' },
    })
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2027-01-01' } })

    fireEvent.click(screen.getByRole('button', { name: /Add 1 Item/i }))

    await waitFor(() => expect(mockBulkAddPantryItems).toHaveBeenCalledTimes(1))
    const payload = mockBulkAddPantryItems.mock.calls[0][0]
    expect(payload[0]).toMatchObject({
      name: 'Salt',
      expiry_date: '2027-01-01',
      estimated_expiry: false,
    })
  })

  it('editing an auto-filled date flips estimated_expiry back to false', async () => {
    renderSheet()

    await selectMilkSuggestion()
    expect(screen.getByText('(est.)')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2027-06-15' } })
    expect(screen.queryByText('(est.)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add 1 Item/i }))

    await waitFor(() => expect(mockBulkAddPantryItems).toHaveBeenCalledTimes(1))
    const payload = mockBulkAddPantryItems.mock.calls[0][0]
    expect(payload[0]).toMatchObject({
      expiry_date: '2027-06-15',
      estimated_expiry: false,
    })
  })
})
