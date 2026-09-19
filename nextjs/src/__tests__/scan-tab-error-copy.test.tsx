/**
 * Issue #396 (frontend half) / #402 prerequisite — scan failures must show
 * friendly copy, never a raw provider/server string, and a timed-out scan
 * must leave the tab fully usable (not stuck on the processing spinner).
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScanTab from '@/components/pantry/ScanTab'
import * as scanApi from '@/lib/api/scan'
import type { ScanResult } from '@/types/scan'

jest.mock('@/lib/api/scan', () => {
  const actual = jest.requireActual('@/lib/api/scan')
  return {
    ...actual,
    uploadReceipt: jest.fn(),
  }
})

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

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

it('a client-side scan timeout shows friendly copy and returns the tab to a usable state', async () => {
  mockUploadReceipt.mockRejectedValue(
    new scanApi.ScanError('Scan timed out', scanApi.SCAN_CLIENT_TIMEOUT_CODE),
  )
  render(<ScanTab onItemsReady={jest.fn()} />)

  selectFile()

  // Leaves processing — no stuck spinner.
  await waitFor(() =>
    expect(screen.queryByText(/Scanning receipt…/)).not.toBeInTheDocument(),
  )
  // Back on the upload step, ready to retry.
  expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
  // Friendly copy, not a raw timeout string.
  expect(screen.getByText(/taking too long/i)).toBeInTheDocument()

  // File input was cleared so re-selecting the same file fires onChange again.
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(fileInput.value).toBe('')
})

it('never renders a raw provider/server error string, even for an unrecognized code', async () => {
  const rawProviderString = 'GeminiProvider(model=gemini-3.1-flash-lite): 502 upstream connect error'
  mockUploadReceipt.mockRejectedValue(new scanApi.ScanError(rawProviderString, 'some_future_code'))
  render(<ScanTab onItemsReady={jest.fn()} />)

  selectFile()

  await waitFor(() => expect(screen.getByText(/add items manually/i)).toBeInTheDocument())
  expect(screen.queryByText(rawProviderString)).not.toBeInTheDocument()
  expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
})

it('a plain (non-ScanError) failure also falls back to generic friendly copy', async () => {
  mockUploadReceipt.mockRejectedValue(new Error('ECONNRESET at gemini-vision-proxy:443'))
  render(<ScanTab onItemsReady={jest.fn()} />)

  selectFile()

  await waitFor(() => expect(screen.getByText(/add items manually/i)).toBeInTheDocument())
  expect(screen.queryByText(/ECONNRESET/)).not.toBeInTheDocument()
})

it('a recognized server code (unreadable image) shows its specific copy', async () => {
  mockUploadReceipt.mockRejectedValue(
    new scanApi.ScanError('We could not read that image.', 'unreadable_image'),
  )
  render(<ScanTab onItemsReady={jest.fn()} />)

  selectFile()

  await waitFor(() => expect(screen.getByText(/clearer picture/i)).toBeInTheDocument())
})

it('a successful scan after a prior timeout still reaches the results step', async () => {
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
  mockUploadReceipt
    .mockRejectedValueOnce(
      new scanApi.ScanError('Scan timed out', scanApi.SCAN_CLIENT_TIMEOUT_CODE),
    )
    .mockResolvedValueOnce(SCAN_RESULT)

  render(<ScanTab onItemsReady={jest.fn()} />)

  selectFile()
  await waitFor(() => expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument())

  selectFile()
  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())
})
