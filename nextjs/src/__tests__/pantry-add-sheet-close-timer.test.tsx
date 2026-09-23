/**
 * Issue #525 review: after a confirmed add, PantryAddSheet shows a ~1.5s
 * celebration and then auto-closes. Escape (via the focus trap) closed the
 * sheet without cancelling that timer, so reopening the sheet inside the
 * window got it slammed shut by the stale timer.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import * as pantryApi from '@/lib/api/pantry'

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')
jest.mock('@/lib/api/foods')

const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

function sheet(isOpen: boolean, onClose: () => void) {
  return (
    <PantryAddSheet isOpen={isOpen} onClose={onClose} initialTab="type" onItemsAdded={jest.fn()} />
  )
}

afterEach(() => {
  jest.useRealTimers()
})

it('moves focus onto the celebration status, not <body>, after a confirmed add', async () => {
  mockBulkAdd.mockResolvedValue(undefined as never)
  const onClose = jest.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (el: React.ReactElement) => (
    <QueryClientProvider client={client}>{el}</QueryClientProvider>
  )
  render(wrap(sheet(true, onClose)))

  fireEvent.change(screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)'), {
    target: { value: 'Milk' },
  })
  const addButton = await screen.findByRole('button', { name: /Add 1 Item/i })
  addButton.focus()

  fireEvent.click(addButton)
  await waitFor(() => expect(screen.getByText(/Added 1 item!/)).toBeInTheDocument())

  // The confirm button just unmounted (swapped for the celebrate status) —
  // without an explicit focus move this would strand focus on <body>.
  expect(screen.getByTestId('pantry-add-sheet-celebrate')).toHaveFocus()
})

it('Escape during the post-add celebration cancels the auto-close', async () => {
  mockBulkAdd.mockResolvedValue(undefined as never)
  const onClose = jest.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (el: React.ReactElement) => (
    <QueryClientProvider client={client}>{el}</QueryClientProvider>
  )
  const { rerender } = render(wrap(sheet(true, onClose)))

  fireEvent.change(screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)'), {
    target: { value: 'Milk' },
  })
  const addButton = await screen.findByRole('button', { name: /Add 1 Item/i })

  jest.useFakeTimers()
  fireEvent.click(addButton)
  await waitFor(() => expect(screen.getByText(/Added 1 item!/)).toBeInTheDocument())

  // Escape mid-celebration: closes once, through the focus trap.
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)

  // The parent closes and immediately reopens the sheet.
  rerender(wrap(sheet(false, onClose)))
  rerender(wrap(sheet(true, onClose)))

  // The stale 1.5s timer must not fire into the reopened sheet.
  act(() => {
    jest.advanceTimersByTime(3000)
  })
  expect(onClose).toHaveBeenCalledTimes(1)
})
