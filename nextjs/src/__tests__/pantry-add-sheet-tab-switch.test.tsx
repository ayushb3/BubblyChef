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
import * as scanApi from '@/lib/api/scan'
import type { ScanResult } from '@/types/scan'

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')

const mockBulkAddPantryItems = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>
const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

const SCAN_RESULT: ScanResult = {
  ocr_text: 'MILK 4.29',
  ready_to_add: [
    {
      name: 'Whole Milk',
      original_name: 'whole milk',
      source_line: 'MILK 4.29',
      price: 4.29,
      quantity: 1,
      unit: 'gallon',
      category: 'dairy',
      location: 'fridge',
      confidence: 0.95,
    },
  ],
  needs_review: [],
  skipped: [],
  total_items: 1,
  warnings: [],
}

function selectFile() {
  const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [file] } })
}

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
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

  // The typed value should still be there — the draft survives the
  // TypeTab unmount/remount across the tab switch.
  const nameInputAfter = screen.getByLabelText('Item name') as HTMLInputElement
  expect(nameInputAfter.value).toBe('Bananas')

  // The footer count should match what's actually in the restored input,
  // not lag behind until the user makes an edit.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
  )
})

it('keeps a completed scan review after switching to Type and back to Scan', async () => {
  mockUploadReceipt.mockResolvedValue(SCAN_RESULT)

  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="scan" onItemsAdded={jest.fn()} />,
  )

  selectFile()
  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())

  // Switch to Type, then wait for the Scan tab's content to actually leave
  // the DOM, then switch back.
  fireEvent.click(screen.getByRole('button', { name: /Type/i }))
  await waitFor(() => expect(screen.queryByText(/Ready to Add \(1\)/)).not.toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /Scan/i }))

  // The review results should still be shown — no re-upload prompt — rather
  // than resetting back to the empty upload dropzone.
  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())
  expect(screen.queryByText(/Drop your receipt here/i)).not.toBeInTheDocument()
})
