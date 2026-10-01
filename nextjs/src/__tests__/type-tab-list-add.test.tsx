/**
 * Issue #851 — the manual "Type" tab takes a list. "eggs, milk, 2 lb chicken"
 * typed into the name field becomes three review rows (each editable, each with
 * its own quantity and unit) instead of one item with that whole name, and the
 * three are what the footer adds. No model is called: the split is local, and
 * categories are filled by the bulk write's existing estimate-category path.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import * as pantryApi from '@/lib/api/pantry'
import * as foodsApi from '@/lib/api/foods'

jest.mock('@/lib/api/pantry')
jest.mock('@/lib/api/foods')
jest.mock('@/lib/api/scan', () => ({
  uploadReceipt: jest.fn(),
  ScanError: class ScanError extends Error {},
  SCAN_CLIENT_TIMEOUT_CODE: 'timeout',
}))

const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>
const mockSearchFoods = foodsApi.searchFoods as jest.MockedFunction<typeof foodsApi.searchFoods>

function renderSheet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PantryAddSheet isOpen onClose={jest.fn()} initialTab="type" onItemsAdded={jest.fn()} />
    </QueryClientProvider>,
  )
}

const nameInput = () => screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)')

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchFoods.mockResolvedValue([])
  mockBulkAdd.mockResolvedValue({ count: 3, items: [] })
})

describe('typing a list into the name field (#851)', () => {
  it('splits "eggs, milk, 2 lb chicken" into three rows when the field is left', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: 'eggs, milk, 2 lb chicken' } })
    // Still one row while typing: nothing is split under the user's cursor.
    expect(screen.getAllByPlaceholderText('Item name (e.g. Milk, Eggs...)')).toHaveLength(1)

    fireEvent.blur(nameInput())

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 3 Items/i })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Edit item 1: eggs, 1 item/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit item 2: milk, 1 item/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit item 3: chicken, 2 lb/i })).toBeInTheDocument()
  })

  it('splits on Enter too', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: 'eggs; milk' } })
    fireEvent.keyDown(nameInput(), { key: 'Enter' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 2 Items/i })).toBeInTheDocument(),
    )
  })

  it('adds each piece as its own item with the parsed quantity and unit', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: 'a dozen eggs, 2L milk, 2 lb chicken, rice' } })
    fireEvent.blur(nameInput())

    fireEvent.click(await screen.findByRole('button', { name: /Add 4 Items/i }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    const payload = mockBulkAdd.mock.calls[0][0]
    expect(payload.map((p) => [p.name, p.quantity, p.unit])).toEqual([
      ['eggs', 1, 'dozen'],
      ['milk', 2, 'L'],
      ['chicken', 2, 'lb'],
      ['rice', 1, 'item'],
    ])
    // Left on Other, so the bulk write estimates the category (no model here).
    expect(payload.every((p) => p.category === 'other')).toBe(true)
  })

  it('clicking Add straight after typing a list still adds every piece', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: 'eggs, milk' } })
    // The click's mousedown blurs the field first, as in a browser.
    fireEvent.blur(nameInput())
    fireEvent.click(await screen.findByRole('button', { name: /Add 2 Items/i }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    expect(mockBulkAdd.mock.calls[0][0].map((p) => p.name)).toEqual(['eggs', 'milk'])
  })

  it('every split row is editable before adding', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: 'eggs, milk' } })
    fireEvent.blur(nameInput())

    fireEvent.click(await screen.findByRole('button', { name: /Edit item 2: milk/i }))
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /Add 2 Items/i }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    expect(mockBulkAdd.mock.calls[0][0].map((p) => [p.name, p.quantity])).toEqual([
      ['eggs', 1],
      ['milk', 4],
    ])
  })

  it('reads a quantity and unit from a single typed entry left at the defaults', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: '2 lb chicken' } })
    fireEvent.blur(nameInput())

    fireEvent.click(await screen.findByRole('button', { name: /Add 1 Item/i }))
    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    expect(mockBulkAdd.mock.calls[0][0][0]).toMatchObject({ name: 'chicken', quantity: 2, unit: 'lb' })
  })

  it('tabbing from the name to the same row\'s Quantity keeps the row and the focus', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: '2 lb chicken' } })
    const quantity = screen.getByLabelText('Quantity')
    quantity.focus()
    // Focus moves inside the row: the blur carries the Quantity field as relatedTarget.
    fireEvent.blur(nameInput(), { relatedTarget: quantity })

    expect(nameInput()).toHaveValue('2 lb chicken')
    expect(screen.queryByRole('button', { name: /Edit item 1/i })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(quantity)

    // Leaving the row for real (focus to something outside it) then reads the entry.
    const outside = screen.getByRole('button', { name: /Add another item/i })
    fireEvent.blur(quantity, { relatedTarget: outside })
    fireEvent.blur(nameInput(), { relatedTarget: outside })
    expect(await screen.findByRole('button', { name: /Edit item 1: chicken, 2 lb/i })).toBeInTheDocument()
  })

  it('a list typed into a row with a hand-set category and expiry keeps both on the first piece', async () => {
    renderSheet()
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'dairy' } })
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2026-10-20' } })
    fireEvent.change(nameInput(), { target: { value: 'eggs, milk' } })
    fireEvent.blur(nameInput(), { relatedTarget: document.body })

    fireEvent.click(await screen.findByRole('button', { name: /Add 2 Items/i }))
    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    const [first, second] = mockBulkAdd.mock.calls[0][0]
    expect(first).toMatchObject({ name: 'eggs', category: 'dairy', expiry_date: '2026-10-20' })
    expect(second).toMatchObject({ name: 'milk', category: 'other', expiry_date: null })
  })

  it('leaves a plain name and a hand-set quantity alone', async () => {
    renderSheet()
    fireEvent.change(nameInput(), { target: { value: 'Milk' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } })
    fireEvent.blur(nameInput())

    fireEvent.click(await screen.findByRole('button', { name: /Add 1 Item/i }))
    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    expect(mockBulkAdd.mock.calls[0][0][0]).toMatchObject({ name: 'Milk', quantity: 3, unit: 'item' })
  })
})
