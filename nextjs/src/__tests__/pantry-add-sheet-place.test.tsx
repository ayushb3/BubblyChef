/**
 * Issue #749: "Add to the Freezer" opens the add sheet with that place preset,
 * and what is typed in saves with that location.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import * as pantryApi from '@/lib/api/pantry'

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')
jest.mock('@/lib/api/foods')

const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

function renderSheet(props: Partial<React.ComponentProps<typeof PantryAddSheet>>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PantryAddSheet
        isOpen
        onClose={jest.fn()}
        initialTab="type"
        onItemsAdded={jest.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

async function addMilk() {
  fireEvent.change(screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)'), {
    target: { value: 'Peas' },
  })
  fireEvent.click(await screen.findByRole('button', { name: /Add 1 Item/i }))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBulkAdd.mockResolvedValue({ count: 1, items: [] })
})

it('saves typed items with the preset place as their location', async () => {
  renderSheet({ place: 'freezer' })
  await addMilk()
  await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
  expect(mockBulkAdd.mock.calls[0][0]).toEqual([
    expect.objectContaining({ name: 'Peas', storage_location: 'freezer', source: 'manual' }),
  ])
})

it.each([
  ['fridge', 'fridge'],
  ['shelves', 'pantry'],
  ['basket', 'counter'],
] as const)('the %s place saves the stored location %s', async (place, location) => {
  renderSheet({ place })
  await addMilk()
  await waitFor(() => expect(mockBulkAdd).toHaveBeenCalled())
  expect(mockBulkAdd.mock.calls[0][0][0]).toMatchObject({ storage_location: location })
})

it('says where the typed items are going', () => {
  renderSheet({ place: 'freezer' })
  expect(screen.getByRole('dialog')).toHaveTextContent('Adding to the freezer')
})

it('with no place, behaves as before: no location is sent for a typed item', async () => {
  renderSheet({})
  await addMilk()
  await waitFor(() => expect(mockBulkAdd).toHaveBeenCalled())
  expect(mockBulkAdd.mock.calls[0][0][0]).not.toHaveProperty('storage_location')
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/adding to the/i)
})
