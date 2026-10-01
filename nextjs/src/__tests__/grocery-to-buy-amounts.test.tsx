/**
 * Issue #850: a meal's to-buy items keep their missing amount, unit and
 * category all the way onto the grocery list. The AI service says how much of
 * each missing food the meal lacks (`items[].quantity|unit|category`); the
 * client used to throw it away and add bare names (quantity null, category
 * "other").
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MealToBuyLine from '@/components/meal/MealToBuyLine'
import { groceryEntriesFromDetail } from '@/lib/meal-to-buy'
import { addMissingToGroceryList, loadGroceryLines, saveGroceryLines } from '@/lib/grocery-store'
import { setLineChecked } from '@/lib/grocery'

const detailMock = jest.fn()
jest.mock('@/lib/api/grocery', () => {
  const actual = jest.requireActual('@/lib/api/grocery')
  return { ...actual, fetchMealToBuyDetail: (...args: unknown[]) => detailMock(...args) }
})

const getUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => getUser() } }),
}))

const actualFetchDetail = jest.requireActual('@/lib/api/grocery')
  .fetchMealToBuyDetail as (mealId: string) => Promise<{ items: unknown[] | null }>

function item(name: string, extra: Record<string, unknown> = {}) {
  return { name, dish_positions: [0], dish_names: [name], ...extra }
}

function reply(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

beforeEach(() => {
  window.localStorage.clear()
  detailMock.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('fetchMealToBuyDetail: amounts from the service', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('reads quantity, unit and category off each item', async () => {
    fetchMock.mockResolvedValue(
      reply({
        to_buy: ['feta', 'parsley'],
        items: [
          item('feta', { quantity: 200, unit: 'g', category: 'dairy' }),
          item('parsley', { quantity: null, unit: null, category: null }),
        ],
      }),
    )
    const detail = await actualFetchDetail('m1')
    expect(detail.items).toEqual([
      expect.objectContaining({ name: 'feta', quantity: 200, unit: 'g', category: 'dairy' }),
      expect.objectContaining({ name: 'parsley', quantity: null, unit: null, category: null }),
    ])
  })

  it('treats an older service (no amount fields) as no amount, not as a broken response', async () => {
    fetchMock.mockResolvedValue(reply({ to_buy: ['feta'], items: [item('feta')] }))
    const detail = await actualFetchDetail('m1')
    expect(detail.items).toEqual([
      expect.objectContaining({ name: 'feta', quantity: null, unit: null, category: null }),
    ])
  })
})

describe('groceryEntriesFromDetail', () => {
  it('turns each to-buy item into a list entry with its amount, unit and category', () => {
    const entries = groceryEntriesFromDetail({
      names: ['feta', 'parsley'],
      items: [
        { name: 'feta', dishPositions: [0], dishNames: ['feta'], quantity: 200, unit: 'g', category: 'dairy' },
        { name: 'parsley', dishPositions: [1], dishNames: ['parsley'], quantity: null, unit: null, category: null },
      ],
    })
    expect(entries).toEqual([
      { name: 'feta', quantity: 200, unit: 'g', category: 'dairy' },
      { name: 'parsley', quantity: null, unit: null, category: undefined },
    ])
  })

  it('falls back to bare names when the service sent no items', () => {
    expect(groceryEntriesFromDetail({ names: ['feta'], items: null })).toEqual(['feta'])
  })
})

describe('addMissingToGroceryList with amounts', () => {
  it('stores quantity, unit and category on the new lines', () => {
    addMissingToGroceryList('u1', [
      { name: 'feta', quantity: 200, unit: 'g', category: 'dairy' },
      { name: 'parsley' },
    ])
    const lines = loadGroceryLines('u1')
    expect(lines.find((l) => l.name === 'feta')).toMatchObject({ quantity: 200, unit: 'g', category: 'dairy' })
    expect(lines.find((l) => l.name === 'parsley')).toMatchObject({ quantity: null, category: 'other' })
  })

  it('still leaves a ticked line exactly as it was (issue #787)', () => {
    addMissingToGroceryList('u1', [{ name: 'feta', quantity: 200, unit: 'g', category: 'dairy' }])
    saveGroceryLines('u1', setLineChecked(loadGroceryLines('u1'), loadGroceryLines('u1')[0].key, true))
    addMissingToGroceryList('u1', [{ name: 'feta', quantity: 500, unit: 'g', category: 'dairy' }])
    expect(loadGroceryLines('u1')).toHaveLength(1)
    expect(loadGroceryLines('u1')[0]).toMatchObject({ quantity: 200, checked: true })
  })
})

describe('MealToBuyLine: the grocery lines it adds keep the missing amount', () => {
  it('puts feta on the list as 200 g, dairy', async () => {
    detailMock.mockResolvedValue({
      names: ['feta', 'parsley'],
      items: [
        { name: 'feta', dishPositions: [0], dishNames: ['feta'], quantity: 200, unit: 'g', category: 'dairy' },
        { name: 'parsley', dishPositions: [0], dishNames: ['parsley'], quantity: 1, unit: 'bunch', category: null },
      ],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MealToBuyLine mealId="m1" signature="a" />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /add to grocery list/i }))
    await waitFor(() => expect(screen.getByTestId('meal-to-buy-added')).toBeInTheDocument())

    const lines = loadGroceryLines('u1')
    expect(lines.find((l) => l.name === 'feta')).toMatchObject({ quantity: 200, unit: 'g', category: 'dairy' })
    expect(lines.find((l) => l.name === 'parsley')).toMatchObject({ quantity: 1, unit: 'bunch', category: 'other' })
    // The confirmation still links to the list.
    expect(screen.getByRole('link', { name: /view list/i })).toHaveAttribute('href', '/grocery')
  })
})
