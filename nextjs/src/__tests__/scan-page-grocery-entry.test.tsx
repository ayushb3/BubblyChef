/**
 * Issue #905: the Scan page is the way into the grocery list (there is no
 * grocery button in the global header). A secondary keycap below the upload
 * area opens `/grocery`; it steps out of the way while a scan is in flight.
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

// The count hook reads the user and pantry (React Query); its own behaviour is
// pinned elsewhere. Here only what the page does with the number matters.
let groceryCount = { count: 0, loading: false }
jest.mock('@/hooks/useGroceryCount', () => ({ useGroceryCount: () => groceryCount }))

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
  groceryCount = { count: 0, loading: false }
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

describe('/scan grocery list entry (#905)', () => {
  it('names how many items are to buy, "1 item" in the singular', () => {
    groceryCount = { count: 3, loading: false }
    const { unmount } = renderPage()
    expect(screen.getByRole('button', { name: /grocery list.*3 items/i })).toBeInTheDocument()
    unmount()

    groceryCount = { count: 1, loading: false }
    renderPage()
    expect(screen.getByRole('button', { name: /grocery list.*1 item$/i })).toBeInTheDocument()
  })

  it('shows no count while it loads or when the list is empty', () => {
    groceryCount = { count: 0, loading: false }
    const { unmount } = renderPage()
    expect(screen.getByRole('button', { name: /grocery list$/i })).toBeInTheDocument()
    unmount()

    groceryCount = { count: 5, loading: true }
    renderPage()
    expect(screen.getByRole('button', { name: /grocery list$/i })).toBeInTheDocument()
  })

  it('shows a Grocery list key below the upload area that opens /grocery', () => {
    renderPage()
    const key = screen.getByRole('button', { name: /grocery list/i })
    expect(key).toHaveAttribute('data-keycap', 'secondary')
    // Below the dropzone's own "Choose a photo" key.
    const choose = screen.getByRole('button', { name: 'Choose a photo' })
    expect(choose.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(key)
    expect(push).toHaveBeenCalledWith('/grocery')
  })

  it('is not offered while a scan is in flight, and Cancel scan still works', async () => {
    mockUploadReceipt.mockReturnValue(new Promise(() => {}))
    renderPage()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })] },
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /cancel scan/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /grocery list/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /cancel scan/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /grocery list/i })).toBeInTheDocument(),
    )
  })
})
