/**
 * Issue #259 — `/scan` route container behaviour.
 *
 * The route owns upload → processing → review → confirm → redirect. It
 * mounts `ReviewSurface` for the review step (covered separately in
 * scan-review.test.tsx) — these tests pin the container's own wiring: that
 * a successful upload reaches the review step, that confirm only fires the
 * write on explicit user action and then redirects to `/pantry`, and that a
 * failed write surfaces an error without redirecting.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanPage from '@/app/scan/page'
import * as scanApi from '@/lib/api/scan'
import * as pantryApi from '@/lib/api/pantry'
import type { ScanResult } from '@/types/scan'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>
const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<typeof pantryApi.bulkAddPantryItems>

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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ScanPage />
    </QueryClientProvider>,
  )
}

function selectFile() {
  const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(fileInput, { target: { files: [file] } })
  return file
}

beforeEach(() => {
  jest.clearAllMocks()
  // jsdom doesn't implement createObjectURL/revokeObjectURL
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

it('uploading a receipt moves from the upload state to the review state', async () => {
  mockUploadReceipt.mockResolvedValue(SCAN_RESULT)
  renderPage()

  expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
  selectFile()

  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())
  expect(mockUploadReceipt).toHaveBeenCalledTimes(1)
})

it('confirming the review writes via bulkAddPantryItems and redirects to /pantry', async () => {
  mockUploadReceipt.mockResolvedValue(SCAN_RESULT)
  mockBulkAdd.mockResolvedValue({ count: 1, items: [] })
  renderPage()

  selectFile()
  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())

  // Nothing written yet — the write only happens on explicit confirm.
  expect(mockBulkAdd).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: /Add 1 Item to Pantry/i }))

  await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
  expect(mockBulkAdd.mock.calls[0][0]).toEqual([
    {
      name: 'Whole Milk',
      quantity: 1,
      unit: 'gallon',
      category: 'dairy',
      storage_location: 'fridge',
      expiry_date: null,
    },
  ])
  await waitFor(() => expect(push).toHaveBeenCalledWith('/pantry'))
})

it('a failed confirm shows an error and stays on the review step (no redirect)', async () => {
  mockUploadReceipt.mockResolvedValue(SCAN_RESULT)
  mockBulkAdd.mockRejectedValue(new Error('Failed to add items'))
  renderPage()

  selectFile()
  await waitFor(() => expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /Add 1 Item to Pantry/i }))

  await waitFor(() => expect(screen.getByText('Failed to add items')).toBeInTheDocument())
  expect(push).not.toHaveBeenCalled()
  // Still on review — the tier is still visible.
  expect(screen.getByText(/Ready to Add \(1\)/)).toBeInTheDocument()
})

it('a failed upload shows an error and returns to the upload state', async () => {
  mockUploadReceipt.mockRejectedValue(new Error('OCR service unavailable'))
  renderPage()

  selectFile()

  await waitFor(() => expect(screen.getByText('OCR service unavailable')).toBeInTheDocument())
  expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
})
