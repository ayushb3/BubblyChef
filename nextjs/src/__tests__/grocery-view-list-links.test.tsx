/**
 * Issue #497: the meal and recipe "N to buy" lines used to say the grocery list
 * had no page. Once the items are on the list, the confirmation links to it.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MealToBuyLine from '@/components/meal/MealToBuyLine'
import { ToBuyLine } from '@/components/recipes/recipe-card/parts'

const fetchMealToBuy = jest.fn()
jest.mock('@/lib/api/grocery', () => ({
  fetchMealToBuy: (...args: unknown[]) => fetchMealToBuy(...args),
}))

const getUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => getUser() } }),
}))

beforeEach(() => {
  window.localStorage.clear()
  fetchMealToBuy.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('MealToBuyLine: view list', () => {
  it('links to /grocery once the items are added, and not before', async () => {
    fetchMealToBuy.mockResolvedValue(['parsley', '1 lemon'])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MealToBuyLine mealId="m1" signature="a" />
      </QueryClientProvider>,
    )
    await screen.findByText('2 to buy')
    expect(screen.queryByRole('link', { name: /view list/i })).not.toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /add to grocery list/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /add to grocery list/i }))

    const added = await screen.findByTestId('meal-to-buy-added')
    expect(added).toHaveTextContent('2 added to your grocery list')
    expect(screen.getByRole('link', { name: /view list/i })).toHaveAttribute('href', '/grocery')
  })
})

describe('recipe card ToBuyLine: view list', () => {
  it('links to /grocery from the "on your grocery list" confirmation', async () => {
    render(<ToBuyLine items={['parsley', 'thyme']} onAdd={jest.fn().mockResolvedValue(undefined)} />)
    expect(screen.queryByRole('link', { name: /view list/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add to grocery list/i }))

    expect(await screen.findByText('2 on your grocery list')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view list/i })).toHaveAttribute('href', '/grocery')
  })

  it('offers no link when there is nothing to buy', () => {
    render(<ToBuyLine items={[]} />)
    expect(screen.queryByRole('link', { name: /view list/i })).not.toBeInTheDocument()
  })
})
