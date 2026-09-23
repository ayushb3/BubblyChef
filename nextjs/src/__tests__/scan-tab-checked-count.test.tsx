/**
 * Issue #406 — Scan review: unchecking an item does not update the footer
 * "Add N Items" count.
 *
 * `ScanTab` (mounted inside `PantryAddSheet` at /pantry?add=scan, with
 * ReviewSurface's own footer hidden via `hideConfirmButton`) reports item
 * counts to its parent via `onItemsReady`. That parent-facing count must
 * reflect only the items the user has *checked* in the review UI, since it
 * drives both the sheet's own "Add N Items" footer button and the actual
 * payload sent to `bulkAddPantryItems`.
 *
 * Today `notifyParent` always reports every found item (ready_to_add +
 * needs_review) regardless of checkbox state, so unchecking an item does not
 * change what's surfaced to the parent. This test reproduces that.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScanTab from '@/components/pantry/ScanTab'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import * as scanApi from '@/lib/api/scan'
import * as pantryApi from '@/lib/api/pantry'
import type { ScanResult } from '@/types/scan'

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>
const mockBulkAddPantryItems = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

const SCAN_RESULT: ScanResult = {
  ocr_text: 'MILK 4.29\nEGGS 3.99\nBREAD 2.99',
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
    {
      name: 'Eggs',
      original_name: 'eggs',
      source_line: 'EGGS 3.99',
      price: 3.99,
      quantity: 1,
      unit: 'dozen',
      category: 'dairy',
      location: 'fridge',
      confidence: 0.9,
    },
    {
      name: 'Bread',
      original_name: 'bread',
      source_line: 'BREAD 2.99',
      price: 2.99,
      quantity: 1,
      unit: 'loaf',
      category: 'bakery',
      location: 'pantry',
      confidence: 0.88,
    },
  ],
  needs_review: [],
  skipped: [],
  total_items: 3,
  warnings: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

function selectFile() {
  const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [file] } })
}

it('drops the reported item count when an item is unchecked', async () => {
  mockUploadReceipt.mockResolvedValue(SCAN_RESULT)
  const onItemsReady = jest.fn()

  render(<ScanTab onItemsReady={onItemsReady} />)
  selectFile()

  await waitFor(() => expect(screen.getByText(/Ready to Add \(3\)/)).toBeInTheDocument())

  // All 3 ready_to_add items start pre-checked, so the parent should have
  // been notified of all 3.
  await waitFor(() => {
    const lastCall = onItemsReady.mock.calls[onItemsReady.mock.calls.length - 1][0]
    expect(lastCall).toHaveLength(3)
  })

  // Uncheck one item.
  const eggsCheckbox = screen.getByRole('checkbox', { name: /Include Eggs/i })
  fireEvent.click(eggsCheckbox)

  await waitFor(() => {
    const lastCall = onItemsReady.mock.calls[onItemsReady.mock.calls.length - 1][0]
    expect(lastCall).toHaveLength(2)
  })
})

// ─── PantryAddSheet-level: footer count and confirm payload ───────────────────
// The more serious variant of the bug — the footer button AND the actual
// bulkAddPantryItems() write both derive from ScanTab's onItemsReady, so both
// must reflect only checked items.

it('PantryAddSheet footer count and bulkAddPantryItems payload both drop after an uncheck', async () => {
  mockUploadReceipt.mockResolvedValue(SCAN_RESULT)
  mockBulkAddPantryItems.mockResolvedValue({ count: 2, items: [] })

  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="scan" onItemsAdded={jest.fn()} />,
  )
  selectFile()

  await waitFor(() => expect(screen.getByText(/Ready to Add \(3\)/)).toBeInTheDocument())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Add 3 Items/i })).toBeInTheDocument(),
  )

  const eggsCheckbox = screen.getByRole('checkbox', { name: /Include Eggs/i })
  fireEvent.click(eggsCheckbox)

  const confirmButton = await screen.findByRole('button', { name: /Add 2 Items/i })
  fireEvent.click(confirmButton)

  await waitFor(() => expect(mockBulkAddPantryItems).toHaveBeenCalledTimes(1))
  const payload = mockBulkAddPantryItems.mock.calls[0][0]
  expect(payload).toHaveLength(2)
  expect(payload.some((item) => item.name === 'Eggs')).toBe(false)
})
