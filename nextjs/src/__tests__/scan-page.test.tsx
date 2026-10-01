/**
 * Issue #259 — `/scan` route container behaviour; reworked for issue #753.
 *
 * The route owns upload → processing → hand-off. Review and confirm are no
 * longer on this page: a parsed scan is kept as the pending put-away and the
 * user goes to the kitchen home, where the put-away sheet reviews it and its
 * "Put away" tap is the only write. The hand-off itself (the pending record, the
 * redirect home, no write, no on-page review) is pinned for both scan entry
 * points in scan-handoff.test.tsx; the put-away review and write are pinned in
 * kitchen-putaway-sheet.test.tsx.
 *
 * Three tests that lived here were retired by that move, and are named in the
 * PR: "uploading a receipt moves from the upload state to the review state",
 * "confirming the review writes via bulkAddPantryItems and redirects to /pantry"
 * and "a failed confirm shows an error and stays on the review step". Their
 * behaviour now lives in the two files above. What stays is the failed-upload
 * path, which this page still owns.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanPage from '@/app/scan/page'
import * as scanApi from '@/lib/api/scan'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/lib/api/scan')

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

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

it('a failed upload shows an error and returns to the upload state', async () => {
  // #396: this used to assert the raw upstream message was rendered verbatim,
  // which is the leak that issue describes. The route now maps failures to
  // user-facing copy, so the assertion is inverted: friendly text shown, the
  // upstream string absent. Returning to the upload state is unchanged.
  mockUploadReceipt.mockRejectedValue(new Error('OCR service unavailable'))
  renderPage()

  selectFile()

  await waitFor(() => expect(screen.getByText(/add items manually/i)).toBeInTheDocument())
  expect(screen.queryByText('OCR service unavailable')).not.toBeInTheDocument()
  expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()
  expect(push).not.toHaveBeenCalled()
})
