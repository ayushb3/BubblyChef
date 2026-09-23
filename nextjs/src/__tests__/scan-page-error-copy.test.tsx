/**
 * Issue #396 — the `/scan` route must not render raw error text at the user.
 *
 * `ScanTab` (the pantry add sheet's scan path) was converted to friendly copy
 * when #396 landed, but `/scan` owns its own upload/processing state machine
 * (#259) and was missed — it still did
 * `setError(err instanceof Error ? err.message : …)`. Sanitized server
 * messages made that mostly harmless, but a failure that never reaches the
 * AI service — a network `TypeError`, a proxy 502 — still rendered raw text,
 * against the issue's "never the internal error payload".
 *
 * `jest.requireActual` keeps the real `ScanError` class: an automock would
 * replace it and make the `instanceof` check silently false, so these tests
 * would pass without proving anything.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanPage from '@/app/scan/page'
import * as scanApi from '@/lib/api/scan'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/lib/api/scan', () => ({
  ...jest.requireActual('@/lib/api/scan'),
  uploadReceipt: jest.fn(),
}))
jest.mock('@/lib/api/pantry')

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScanPage />
    </QueryClientProvider>,
  )
}

function uploadAFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['x'], 'receipt.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  jest.clearAllMocks()
  // jsdom implements neither; the page calls them around the preview image.
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

describe('/scan error copy (#396)', () => {
  it('never renders a raw provider error string', async () => {
    const raw =
      "Receipt scan failed: No vision-capable provider available. Errors: " +
      "['gemini/gemini-2.5-flash: Gemini [gemini-2.5-flash] vision connection error: ReadTimeout: ']"
    mockUploadReceipt.mockRejectedValue(new Error(raw))

    const { container } = renderPage()
    uploadAFile(container)

    await waitFor(() => expect(screen.getByText(/add items manually/i)).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('gemini')
    expect(document.body.textContent).not.toContain('ReadTimeout')
    expect(document.body.textContent).not.toContain(raw)
  })

  it('shows timeout-specific copy for a client timeout', async () => {
    mockUploadReceipt.mockRejectedValue(
      new scanApi.ScanError('Scan timed out', scanApi.SCAN_CLIENT_TIMEOUT_CODE),
    )

    const { container } = renderPage()
    uploadAFile(container)

    await waitFor(() => expect(screen.getByText(/taking too long/i)).toBeInTheDocument())
  })

  it('falls back to generic copy for a bare network failure', async () => {
    // A fetch-level TypeError never reaches the AI service, so it carries no
    // sanitized code — the path that leaked raw text before this fix.
    mockUploadReceipt.mockRejectedValue(new TypeError('Failed to fetch'))

    const { container } = renderPage()
    uploadAFile(container)

    await waitFor(() => expect(screen.getByText(/add items manually/i)).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('Failed to fetch')
  })
})
