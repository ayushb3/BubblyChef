/**
 * Issue #402 — Add-to-Pantry: switching between Scan and Type tabs wipes
 * typed input but the "ready to add" count survives.
 *
 * Root cause was that `PantryAddSheet` unmounted the inactive tab (via
 * `AnimatePresence mode="wait"`), destroying local component state, while
 * `scanItems`/`typeItems` lived in the parent and survived — desyncing the
 * footer count from the actual form data. Both tabs must now stay mounted
 * for the lifetime of the sheet, and a scan in flight must lock the Type
 * tab (a tab switch is not an abandon gesture; closing the sheet is).
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

function switchTab(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }))
}

it('typed input and the footer count both survive a switch away to Scan and back', async () => {
  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="type" onItemsAdded={jest.fn()} />,
  )

  const nameInput = screen.getByPlaceholderText(/item name/i)
  fireEvent.change(nameInput, { target: { value: 'Milk' } })

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
  )

  switchTab(/Scan/)
  switchTab(/Type/)

  // The exact repro: text must still be there, not just the count.
  expect(screen.getByDisplayValue('Milk')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument()
})

it('a completed scan review survives switching to Type and back', async () => {
  mockUploadReceipt.mockResolvedValue(SCAN_RESULT)

  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="scan" onItemsAdded={jest.fn()} />,
  )

  selectFile()
  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())

  switchTab(/Type/)
  switchTab(/Scan/)

  // Still on the results screen, not reset to the upload dropzone.
  expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument()
  expect(screen.queryByText(/Drop your receipt here/)).not.toBeInTheDocument()
  expect(mockUploadReceipt).toHaveBeenCalledTimes(1)
})

it('locks the Type tab while a scan is processing, then unlocks on success', async () => {
  let resolveUpload!: (result: ScanResult) => void
  mockUploadReceipt.mockReturnValue(
    new Promise<ScanResult>((resolve) => {
      resolveUpload = resolve
    }),
  )

  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="scan" onItemsAdded={jest.fn()} />,
  )

  selectFile()
  await waitFor(() => expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument())

  const typeButton = screen.getByRole('button', { name: /Type/ })
  expect(typeButton).toHaveAttribute('aria-disabled', 'true')

  fireEvent.click(typeButton)
  // Still on the Scan tab — the switch was a no-op while locked.
  expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument()

  resolveUpload(SCAN_RESULT)
  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())

  expect(screen.getByRole('button', { name: /^✍️ Type$/ })).toHaveAttribute(
    'aria-disabled',
    'false',
  )

  switchTab(/^✍️ Type$/)
  expect(screen.getByPlaceholderText(/item name/i)).toBeInTheDocument()
})

it('unlocks the Type tab after a scan failure/timeout, not just success', async () => {
  mockUploadReceipt.mockRejectedValue(
    new scanApi.ScanError('Scan timed out', scanApi.SCAN_CLIENT_TIMEOUT_CODE),
  )

  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="scan" onItemsAdded={jest.fn()} />,
  )

  selectFile()
  await waitFor(() => expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument())
  expect(screen.getByRole('button', { name: /Type/ })).toHaveAttribute('aria-disabled', 'true')

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^✍️ Type$/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    ),
  )

  switchTab(/^✍️ Type$/)
  expect(screen.getByPlaceholderText(/item name/i)).toBeInTheDocument()
})

it('the sheet close paths (X button) still work while a scan is processing', async () => {
  mockUploadReceipt.mockReturnValue(new Promise<ScanResult>(() => {})) // never resolves
  const onClose = jest.fn()

  render(
    <PantryAddSheet isOpen onClose={onClose} initialTab="scan" onItemsAdded={jest.fn()} />,
  )

  selectFile()
  await waitFor(() => expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /Close/i }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('the footer count never disagrees with the actual confirm payload after a tab round-trip', async () => {
  mockBulkAddPantryItems.mockResolvedValue({ count: 1, items: [] })

  render(
    <PantryAddSheet isOpen onClose={jest.fn()} initialTab="type" onItemsAdded={jest.fn()} />,
  )

  fireEvent.change(screen.getByPlaceholderText(/item name/i), { target: { value: 'Milk' } })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Add 1 Item/i })).toBeInTheDocument(),
  )

  switchTab(/Scan/)
  switchTab(/Type/)

  const confirmButton = screen.getByRole('button', { name: /Add 1 Item/i })
  fireEvent.click(confirmButton)

  await waitFor(() => expect(mockBulkAddPantryItems).toHaveBeenCalledTimes(1))
  const payload = mockBulkAddPantryItems.mock.calls[0][0]
  expect(payload).toHaveLength(1)
  expect(payload[0].name).toBe('Milk')
})
