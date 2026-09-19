/**
 * Issue #402 — Add-to-Pantry: switching between Scan and Type tabs wipes
 * typed input, but the "ready to add" count survives.
 *
 * `PantryAddSheet` renders the active tab via a ternary inside
 * `AnimatePresence mode="wait"`, so switching tabs unmounts the inactive
 * one. `TypeTab` keeps its rows in local `useState`, so unmounting it
 * throws that state away — the input the user typed is gone when they
 * switch back. But `PantryAddSheet` only updates its own `typeItems` state
 * (which drives the footer count and the `bulkAddPantryItems` payload) via
 * `onItemsReady`, which fires on internal TypeTab state changes, not on
 * unmount — so the stale count survives even though the underlying input
 * is gone. This reproduces both halves of that desync.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import * as pantryApi from '@/lib/api/pantry'

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')

const mockBulkAddPantryItems = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

beforeEach(() => {
  jest.clearAllMocks()
})

it('keeps typed input after switching to Scan and back to Type', async () => {
  mockBulkAddPantryItems.mockResolvedValue({ count: 1, items: [] })

  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="type" onItemsAdded={jest.fn()} />,
  )

  // Type an item name in the Type tab.
  const nameInput = screen.getByLabelText('Item name')
  fireEvent.change(nameInput, { target: { value: 'Bananas' } })

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
  )

  // Switch to Scan, then wait for the Type tab's content to actually leave
  // the DOM (AnimatePresence's exit animation is async), then switch back.
  fireEvent.click(screen.getByRole('button', { name: /Scan/i }))
  await waitFor(() => expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /Type/i }))
  await waitFor(() => expect(screen.getByLabelText('Item name')).toBeInTheDocument())

  // The typed value should still be there — it is not, because TypeTab
  // unmounted and remounted with a fresh, empty row.
  const nameInputAfter = screen.getByLabelText('Item name') as HTMLInputElement
  expect(nameInputAfter.value).toBe('Bananas')

  // The footer count should match what's actually in the (now-empty) input,
  // not a stale count left over from before the tab switch.
  expect(screen.getByRole('button', { name: /Add Items/i })).toBeInTheDocument()
})
