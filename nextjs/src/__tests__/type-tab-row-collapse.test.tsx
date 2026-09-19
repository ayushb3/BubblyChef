/**
 * Issue #404 — manual "Type" pantry-add tab: adding another item row
 * collapses previously-filled rows into a compact, tappable summary so a
 * multi-item add doesn't turn into a long stack of full forms.
 *
 * Three traps this guards against, all from work that landed just before
 * this issue:
 *  - #402 (`pantry-add-sheet-tab-persistence.test.tsx`) — `TypeTab` must
 *    stay mounted across a Scan/Type switch, and typed data must survive
 *    it. A collapsed row is no exception: its data must round-trip a tab
 *    switch just like an expanded one does.
 *  - #402 again — the footer's "Add N Items" count is derived from what
 *    `TypeTab` reports ready; collapsing a row is presentation-only and
 *    must never change that count.
 *  - #394 — a collapsed row's re-expand control must be real, keyboard
 *    operable, and expose its disclosure state (a `<button>` with
 *    `aria-expanded`), not a bare clickable `<div>`.
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

const mockBulkAddPantryItems = pantryApi.bulkAddPantryItems as jest.MockedFunction<
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

function nameInputs() {
  return screen.getAllByPlaceholderText('Item name (e.g. Milk, Eggs...)')
}

function switchTab(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchFoods.mockResolvedValue([])
  mockBulkAddPantryItems.mockResolvedValue({ count: 1, items: [] })
})

describe('TypeTab row collapse on "Add another item" (#404)', () => {
  it('collapses the first row into a summary showing its values when a second row is added', async () => {
    renderSheet()

    fireEvent.change(nameInputs()[0], { target: { value: 'Milk' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Add another item/i }))

    // The first row's full form is gone; its data now lives behind a
    // disclosure button.
    expect(nameInputs()).toHaveLength(1) // only the new, still-expanded row
    const summaryButton = screen.getByRole('button', {
      name: /Edit item 1: Milk/i,
    })
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false')
    expect(summaryButton).toHaveTextContent('Milk')
    expect(summaryButton).toHaveTextContent('1 item')
    expect(summaryButton).toHaveTextContent('Other') // default category
  })

  it('does not collapse an incomplete (nameless) row', async () => {
    renderSheet()

    // First row stays empty; add a second row anyway.
    fireEvent.click(screen.getByRole('button', { name: /Add another item/i }))

    // Both rows should still be full forms — nothing to summarize for an
    // empty row, and hiding it would hide its missing name.
    expect(nameInputs()).toHaveLength(2)
    expect(screen.queryByText(/Edit item 1/)).not.toBeInTheDocument()
  })

  it('re-expanding via the summary button restores a fully editable row with its values intact', async () => {
    renderSheet()

    fireEvent.change(nameInputs()[0], { target: { value: 'Milk' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Add another item/i }))
    fireEvent.click(screen.getByRole('button', { name: /Edit item 1: Milk/i }))

    // Full row is back, with the edited quantity intact — not reset to the
    // row's defaults. Both rows are expanded now, so scope the quantity
    // check to the re-expanded one specifically.
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument()
    expect(nameInputs()).toHaveLength(2)
    expect(screen.getAllByLabelText('Quantity')[0]).toHaveValue(3)
  })

  it('keyboard Enter on the summary button re-expands the row', async () => {
    renderSheet()

    fireEvent.change(nameInputs()[0], { target: { value: 'Milk' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Add another item/i }))

    const summaryButton = screen.getByRole('button', { name: /Edit item 1: Milk/i })
    fireEvent.keyDown(summaryButton, { key: 'Enter' })

    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument()
  })

  it('the footer count is identical before and after a collapse', async () => {
    renderSheet()

    fireEvent.change(nameInputs()[0], { target: { value: 'Milk' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
    )

    // Collapse it, then check the count is still exactly the same.
    fireEvent.click(screen.getByRole('button', { name: /Add another item/i }))
    expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument()

    // Fill the second (still-expanded) row too — count must track both,
    // collapsed or not.
    fireEvent.change(nameInputs()[0], { target: { value: 'Eggs' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 2 Items/i })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Add 2 Items/i }))
    await waitFor(() => expect(mockBulkAddPantryItems).toHaveBeenCalledTimes(1))
    const payload = mockBulkAddPantryItems.mock.calls[0][0]
    expect(payload).toHaveLength(2)
    expect(payload.map((p) => p.name)).toEqual(['Milk', 'Eggs'])
  })

  it("a collapsed row's data survives a Scan/Type tab switch (#402)", async () => {
    renderSheet()

    fireEvent.change(nameInputs()[0], { target: { value: 'Milk' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Add another item/i }))
    expect(
      screen.getByRole('button', { name: /Edit item 1: Milk/i }),
    ).toBeInTheDocument()

    switchTab(/Scan/)
    switchTab(/Type/)

    // Still collapsed with the same data, and the count is unaffected.
    const summaryButton = screen.getByRole('button', { name: /Edit item 1: Milk/i })
    expect(summaryButton).toBeInTheDocument()
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument()

    // And re-expanding after the round trip still works and shows "Milk".
    fireEvent.click(summaryButton)
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument()
  })
})
