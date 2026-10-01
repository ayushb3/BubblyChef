/**
 * Issue #856, zero-item case: the parse judged the image is not a receipt AND
 * found nothing in it. The user gets the same "This doesn't look like a receipt"
 * notice, with only "Try another photo", never the "nothing found" copy. Nothing
 * is handed to put-away (there is nothing to put away or use anyway).
 * Both scan entry points are covered. All uploads are mocked.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanTab from '@/components/pantry/ScanTab'
import ScanPage from '@/app/scan/page'
import ScanFailureNotice from '@/components/scan/ScanFailureNotice'
import * as scanApi from '@/lib/api/scan'
import { scanErrorCopy } from '@/lib/scan-error-copy'
import type { ScanResult } from '@/types/scan'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/api/scan', () => ({
  ...jest.requireActual('@/lib/api/scan'),
  uploadReceipt: jest.fn(),
}))
jest.mock('@/lib/api/pantry')

const mockUpload = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

const EMPTY = (is_receipt: boolean | undefined): ScanResult => ({
  ocr_text: 'Settings\nNotifications\nDark mode',
  ready_to_add: [],
  needs_review: [],
  skipped: [],
  total_items: 0,
  warnings: [],
  ...(is_receipt === undefined ? {} : { is_receipt }),
})

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

function pick(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] },
  })
}

describe.each([
  ['the add sheet scan tab', () => render(<ScanTab onParsed={jest.fn()} />)],
  [
    'the /scan page',
    () =>
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ScanPage />
        </QueryClientProvider>,
      ),
  ],
])('%s', (_name, mount) => {
  it('shows the not-a-receipt notice with Try another photo, not "nothing found"', async () => {
    mockUpload.mockResolvedValue(EMPTY(false))
    const { container } = mount()
    pick(container)

    await waitFor(() =>
      expect(screen.getByText(/This doesn't look like a receipt/)).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Try another photo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use it anyway' })).not.toBeInTheDocument()
    expect(screen.queryByText(/couldn't find any items/i)).not.toBeInTheDocument()
  })

  it('keeps "nothing found" for an empty scan that is still a receipt', async () => {
    mockUpload.mockResolvedValue(EMPTY(true))
    const { container } = mount()
    pick(container)

    await waitFor(() => expect(screen.getByText(/couldn't find any items/i)).toBeInTheDocument())
    expect(screen.queryByText(/This doesn't look like a receipt/)).not.toBeInTheDocument()
  })

  it('treats a scan with no verdict as a receipt', async () => {
    mockUpload.mockResolvedValue(EMPTY(undefined))
    const { container } = mount()
    pick(container)

    await waitFor(() => expect(screen.getByText(/couldn't find any items/i)).toBeInTheDocument())
  })
})

describe('ScanFailureNotice for the not-a-receipt code', () => {
  it('reads as the notice and offers Try another photo', () => {
    const onRetry = jest.fn()
    render(<ScanFailureNotice code="not_a_receipt" onRetry={onRetry} />)
    expect(screen.getByText(/This doesn't look like a receipt/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try another photo' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('other failures keep their own button copy', () => {
    render(<ScanFailureNotice code="no_items_found" onRetry={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeInTheDocument()
    expect(scanErrorCopy('not_a_receipt')).toMatch(/doesn't look like a receipt/)
  })
})
