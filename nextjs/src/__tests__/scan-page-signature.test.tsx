/**
 * Issue #840: `/scan`'s idle, upload and processing states are drawn in the
 * signature set (the shared page header, a PixelPanel dropzone with a keycap,
 * Bubbles) instead of the old header and dashed dropzone. These tests pin what
 * a person sees and can do; the upload / processing / hand-off behaviour itself
 * stays pinned by scan-page.test.tsx, scan-failure-paths.test.tsx and
 * scan-handoff.test.tsx.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanPage from '@/app/scan/page'
import * as scanApi from '@/lib/api/scan'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/lib/api/scan')

const mockUploadReceipt = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ScanPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

describe('/scan signature restyle', () => {
  it('has the shared page header: an h1 title with Cancel back to the kitchen', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Scan a receipt' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/')
  })

  it('draws the dropzone as a pixel panel with a Choose a photo keycap, no dashed border', () => {
    const { container } = renderPage()
    const panel = container.querySelector('[data-pixel-panel]')
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(screen.getByText(/Drop your receipt here/))
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Choose a photo' }))
    expect(container.querySelector('.border-dashed')).toBeNull()
  })

  it('the Choose a photo keycap opens the file picker', () => {
    renderPage()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const click = jest.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Choose a photo' }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('a file dropped on the panel starts the scan, and dragging over it arms the copy', async () => {
    mockUploadReceipt.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    const panel = container.querySelector('[data-pixel-panel]') as HTMLElement

    fireEvent.dragEnter(panel, { dataTransfer: { types: ['Files'] } })
    expect(screen.getByText(/Drop it here!/)).toBeInTheDocument()
    fireEvent.dragLeave(panel)
    expect(screen.getByText(/Drop your receipt here/)).toBeInTheDocument()

    const file = new File(['bytes'], 'receipt.png', { type: 'image/png' })
    fireEvent.drop(panel, { dataTransfer: { files: [file], types: ['Files'] } })
    await waitFor(() => expect(mockUploadReceipt).toHaveBeenCalledWith(file, expect.anything()))
  })

  it('processing is a pixel panel with the preview, stepped dots and Cancel scan', async () => {
    mockUploadReceipt.mockReturnValue(new Promise(() => {}))
    const { container } = renderPage()
    const file = new File(['fake-bytes'], 'receipt.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/Scanning receipt…/)).toBeInTheDocument())
    const panel = container.querySelector('[data-pixel-panel]')
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(screen.getByAltText('Receipt preview'))
    expect(panel).toContainElement(screen.getByTestId('keycap-loading-dots'))
    expect(panel).toContainElement(screen.getByRole('button', { name: /cancel scan/i }))
  })
})
