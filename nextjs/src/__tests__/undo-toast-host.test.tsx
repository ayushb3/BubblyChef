/**
 * Issue #851 — the "Used it" undo toast. It lives at the app root (`Providers`),
 * not in a page, so it is still there, and still undoes, after the user has
 * navigated away from the row they tapped.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UndoToastHost from '@/components/pantry/UndoToastHost'
import * as pantryApi from '@/lib/api/pantry'
import {
  UNDO_WINDOW_MS,
  deferResolve,
  getDeferredResolves,
  resetDeferredResolvesForTests,
} from '@/lib/pantry-undo'

jest.mock('@/lib/api/pantry')
const mockResolve = pantryApi.resolvePantryItem as jest.MockedFunction<
  typeof pantryApi.resolvePantryItem
>

function renderHost() {
  const client = new QueryClient()
  const invalidate = jest.spyOn(client, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={client}>
      <UndoToastHost />
    </QueryClientProvider>,
  )
  return { invalidate, ...view }
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  resetDeferredResolvesForTests()
  mockResolve.mockResolvedValue({ id: 'basil-1', name: 'Basil', outcome: 'used', resolved: true })
})
afterEach(() => {
  jest.useRealTimers()
})

describe('UndoToastHost (#851)', () => {
  it('shows nothing until something is used', () => {
    renderHost()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says what was used and offers Undo', () => {
    renderHost()
    act(() => deferResolve({ id: 'basil-1', name: 'basil' }, 'used'))
    expect(screen.getByRole('status')).toHaveTextContent('Basil marked as used up')
    expect(screen.getByRole('button', { name: /Undo marking Basil as used up/i })).toBeInTheDocument()
  })

  it('Undo cancels the write and removes the toast', async () => {
    renderHost()
    act(() => deferResolve({ id: 'basil-1', name: 'Basil' }, 'used'))
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(getDeferredResolves()).toEqual([])
    await act(async () => {
      await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2)
    })
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('goes away on its own once the write is made, and refreshes the pantry and bubbles', async () => {
    const { invalidate } = renderHost()
    act(() => deferResolve({ id: 'basil-1', name: 'Basil' }, 'used'))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    })

    expect(mockResolve).toHaveBeenCalledWith('basil-1', 'used')
    expect(screen.queryByRole('button', { name: /Undo/i })).not.toBeInTheDocument()
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey))
    expect(keys).toEqual(expect.arrayContaining(['["pantry"]', '["bubbles"]']))
  })

  it('still undoes after the page that started it has unmounted (it is mounted at the root)', () => {
    // The row's component is not part of this tree at all: only the host is.
    renderHost()
    act(() => deferResolve({ id: 'basil-1', name: 'Basil' }, 'used'))
    act(() => {
      jest.advanceTimersByTime(4000)
    })
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mockResolve).not.toHaveBeenCalled()
    expect(getDeferredResolves()).toEqual([])
  })

  it('says so when the write fails, and the item is back', async () => {
    mockResolve.mockRejectedValueOnce(new Error('nope'))
    renderHost()
    act(() => deferResolve({ id: 'basil-1', name: 'Basil' }, 'used'))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    })
    expect(screen.getByRole('status')).toHaveTextContent(/Couldn.t mark Basil as used up/i)
    expect(getDeferredResolves()).toEqual([])
  })
})
