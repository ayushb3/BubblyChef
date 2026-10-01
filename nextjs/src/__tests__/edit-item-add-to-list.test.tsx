/**
 * Issue #497: "Add to list" in the edit sheet, so every pantry row (not only the
 * ones whose list row shows the icon strip) can go on the grocery list. It puts
 * the food on this browser's list with its unit and category, confirms with a
 * link to the page, and never touches the pantry row.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import EditItemModal from '@/components/pantry/AddItemModal'
import { loadGroceryLines } from '@/lib/grocery-store'
import type { PantryItem } from '@/types/pantry'

jest.mock('@/lib/api/foods')

const mockGetUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => mockGetUser() } }),
}))

const mockUpdate = jest.fn()
const mockDelete = jest.fn()
jest.mock('@/lib/api/pantry', () => ({
  updatePantryItem: (...a: unknown[]) => mockUpdate(...a),
  deletePantryItem: (...a: unknown[]) => mockDelete(...a),
}))

const ITEM: PantryItem = {
  id: 'item-1',
  name: 'milk',
  category: 'dairy',
  location: 'fridge',
  quantity: 1,
  unit: 'L',
  expiry_date: null,
}

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EditItemModal isOpen onClose={jest.fn()} editItem={ITEM} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  mockGetUser.mockReset()
  mockUpdate.mockReset()
  mockDelete.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('Edit item: Add to grocery list', () => {
  it('puts the food on the list and confirms with a link to it', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /add to grocery list/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/added to your grocery list/i)
    expect(screen.getByRole('link', { name: /view list/i })).toHaveAttribute('href', '/grocery')
    expect(loadGroceryLines('u1')).toEqual([
      expect.objectContaining({ key: 'milk', category: 'dairy', unit: 'L', source: 'manual' }),
    ])
  })

  it('leaves the pantry row alone', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /add to grocery list/i }))
    await screen.findByRole('status')
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('says so when it could not add (signed out)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /add to grocery list/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/sign in/i))
    expect(loadGroceryLines('u1')).toEqual([])
  })
})
