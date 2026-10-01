/**
 * Issue #745 — the meal screen's "N to buy" line. It reads the meal's missing
 * items from the existing meal-to-buy endpoint and, on "Add to grocery list",
 * puts exactly those items in the client-side grocery store and confirms with
 * a count. A second tap (or a remount) never duplicates them.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MealToBuyLine from '@/components/meal/MealToBuyLine'
import { loadGroceryLines, saveGroceryLines } from '@/lib/grocery-store'
import { setLineChecked } from '@/lib/grocery'

const fetchMealToBuy = jest.fn()
jest.mock('@/lib/api/grocery', () => ({
  fetchMealToBuy: (...args: unknown[]) => fetchMealToBuy(...args),
}))

const getUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => getUser() } }),
}))

function renderLine(mealId = 'meal-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MealToBuyLine mealId={mealId} signature="a" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  fetchMealToBuy.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('MealToBuyLine', () => {
  it('lists the missing items with a count', async () => {
    fetchMealToBuy.mockResolvedValue(['parsley', '1 lemon'])
    renderLine()
    expect(await screen.findByText('2 to buy')).toBeInTheDocument()
    expect(screen.getByTestId('meal-to-buy-line')).toHaveTextContent('2 to buy: parsley, 1 lemon')
    expect(screen.getByRole('button', { name: /add to grocery list/i })).toBeEnabled()
  })

  it('shows a quiet loading state while it asks', () => {
    fetchMealToBuy.mockReturnValue(new Promise(() => {}))
    renderLine()
    expect(screen.getByTestId('meal-to-buy-loading')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add to grocery list/i })).not.toBeInTheDocument()
  })

  it('says so when there is nothing to buy, with no add key', async () => {
    fetchMealToBuy.mockResolvedValue([])
    renderLine()
    expect(await screen.findByTestId('meal-to-buy-none')).toHaveTextContent(/nothing to buy/i)
    expect(screen.queryByRole('button', { name: /add to grocery list/i })).not.toBeInTheDocument()
  })

  it('offers a retry when the check fails', async () => {
    fetchMealToBuy.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(['basil'])
    renderLine()
    const retry = await screen.findByRole('button', { name: /try again/i })
    fireEvent.click(retry)
    expect(await screen.findByText('1 to buy')).toBeInTheDocument()
  })

  it('adds exactly the missing items to the grocery list and confirms with the count', async () => {
    fetchMealToBuy.mockResolvedValue(['parsley', '1 lemon'])
    window.localStorage.clear()
    renderLine()
    fireEvent.click(await screen.findByRole('button', { name: /add to grocery list/i }))

    await waitFor(() => expect(screen.getByTestId('meal-to-buy-added')).toHaveTextContent('2 added to your grocery list'))
    const lines = loadGroceryLines('u1')
    expect(lines.map((l) => l.name).sort()).toEqual(['1 lemon', 'parsley'])
    expect(screen.queryByRole('button', { name: /add to grocery list/i })).not.toBeInTheDocument()
  })

  it('does not duplicate items on a second add (remount, tap again)', async () => {
    fetchMealToBuy.mockResolvedValue(['parsley', '1 lemon'])
    const first = renderLine()
    fireEvent.click(await screen.findByRole('button', { name: /add to grocery list/i }))
    await screen.findByTestId('meal-to-buy-added')
    first.unmount()

    renderLine()
    fireEvent.click(await screen.findByRole('button', { name: /add to grocery list/i }))
    await screen.findByTestId('meal-to-buy-added')
    expect(loadGroceryLines('u1')).toHaveLength(2)
  })

  it('keeps an item already ticked off when the meal is added again', async () => {
    fetchMealToBuy.mockResolvedValue(['parsley', '1 lemon'])
    const first = renderLine()
    fireEvent.click(await screen.findByRole('button', { name: /add to grocery list/i }))
    await screen.findByTestId('meal-to-buy-added')
    first.unmount()

    // At the shop: parsley goes in the basket.
    const parsley = loadGroceryLines('u1').find((l) => l.name === 'parsley')!
    saveGroceryLines('u1', setLineChecked(loadGroceryLines('u1'), parsley.key, true))

    renderLine()
    fireEvent.click(await screen.findByRole('button', { name: /add to grocery list/i }))
    await screen.findByTestId('meal-to-buy-added')
    const lines = loadGroceryLines('u1')
    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.name === 'parsley')?.checked).toBe(true)
    expect(lines.find((l) => l.name === '1 lemon')?.checked).toBe(false)
  })

  it('does not touch the list before the tap', async () => {
    fetchMealToBuy.mockResolvedValue(['parsley'])
    renderLine()
    await screen.findByText('1 to buy')
    expect(loadGroceryLines('u1')).toEqual([])
  })
})
