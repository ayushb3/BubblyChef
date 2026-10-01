/**
 * Issue #753 — both scan entry points hand a parsed scan to the kitchen.
 *
 * A parsed receipt is kept as the pending put-away and the user goes home, where
 * put-away opens over the scene. Neither entry point reviews or writes anything
 * itself any more: the review is put-away's (kitchen-putaway-sheet.test.tsx) and
 * the only pantry write is its "Put away" tap. These pin the hand-off at both
 * entry points: the `/scan` page, and the add sheet's scan tab (`ScanTab`, and
 * `PantryAddSheet` wiring it to its host). The scan response is mocked.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ScanPage from '@/app/scan/page'
import ScanTab from '@/components/pantry/ScanTab'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'
import { clearPendingPutAway, readPendingPutAway } from '@/lib/kitchen/pending-putaway'
import * as scanApi from '@/lib/api/scan'
import * as pantryApi from '@/lib/api/pantry'
import type { ScanResult } from '@/types/scan'

const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/api/scan', () => ({
  ...jest.requireActual('@/lib/api/scan'),
  uploadReceipt: jest.fn(),
}))
jest.mock('@/lib/api/pantry')

const mockUpload = scanApi.uploadReceipt as jest.MockedFunction<typeof scanApi.uploadReceipt>
const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

function item(name: string, location: string, confidence: number) {
  return {
    name,
    original_name: name.toLowerCase(),
    source_line: name.toUpperCase(),
    price: 1,
    quantity: 1,
    unit: 'item',
    category: 'dairy',
    location,
    confidence,
  }
}

const RESULT: ScanResult = {
  ocr_text: 'GROCERY MART\nMILK 4.29',
  ready_to_add: [item('Whole Milk', 'fridge', 0.95)],
  needs_review: [item('Green peppers', 'fridge', 0.6)],
  skipped: [item('Bag fee', 'pantry', 0.2)],
  total_items: 3,
  warnings: ['Image quality was low.'],
}

const EMPTY: ScanResult = {
  ocr_text: '',
  ready_to_add: [],
  needs_review: [],
  skipped: [],
  total_items: 0,
  warnings: [],
}

function pick(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'receipt.png', { type: 'image/png' })] },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})
afterEach(() => clearPendingPutAway())

describe('/scan page', () => {
  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <ScanPage />
      </QueryClientProvider>,
    )
  }

  it('keeps the parsed scan as the pending put-away and goes to the kitchen', async () => {
    mockUpload.mockResolvedValue(RESULT)
    const { container } = renderPage()
    pick(container)

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    const pending = readPendingPutAway()!
    expect(pending.ready.map((i) => i.name)).toEqual(['Whole Milk'])
    expect(pending.review.map((i) => i.name)).toEqual(['Green peppers'])
    expect(pending.skipped.map((i) => i.name)).toEqual(['Bag fee'])
    expect(pending.warnings).toEqual(['Image quality was low.'])
    expect(pending.store).toBe('Grocery Mart')
  })

  it('writes nothing, and no longer reviews the scan on the page itself', async () => {
    mockUpload.mockResolvedValue(RESULT)
    const { container } = renderPage()
    pick(container)

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(mockBulkAdd).not.toHaveBeenCalled()
    expect(screen.queryByText(/Ready to Add/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add \d+ Items? to Pantry/ })).not.toBeInTheDocument()
  })

  it('an empty scan is the friendly "nothing found" state: no pending scan, no hand-off', async () => {
    mockUpload.mockResolvedValue(EMPTY)
    const { container } = renderPage()
    pick(container)

    await waitFor(() => expect(screen.getByText(/couldn't find any items/i)).toBeInTheDocument())
    expect(push).not.toHaveBeenCalled()
    expect(readPendingPutAway()).toBeNull()
  })

  it('a failed scan hands off nothing', async () => {
    mockUpload.mockRejectedValue(new scanApi.ScanError('offline', 'scan_network_error'))
    const { container } = renderPage()
    pick(container)

    await waitFor(() => expect(screen.getByText(/connection/i)).toBeInTheDocument())
    expect(push).not.toHaveBeenCalled()
    expect(readPendingPutAway()).toBeNull()
  })
})

describe('add sheet scan tab', () => {
  it('ScanTab reports the parsed scan to its host and shows no review of its own', async () => {
    mockUpload.mockResolvedValue(RESULT)
    const onParsed = jest.fn()
    const { container } = render(<ScanTab onParsed={onParsed} />)
    pick(container)

    await waitFor(() => expect(onParsed).toHaveBeenCalledTimes(1))
    expect(onParsed).toHaveBeenCalledWith(RESULT)
    expect(screen.queryByText(/Ready to Add/)).not.toBeInTheDocument()
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('ScanTab does not report an empty scan', async () => {
    mockUpload.mockResolvedValue(EMPTY)
    const onParsed = jest.fn()
    const { container } = render(<ScanTab onParsed={onParsed} />)
    pick(container)

    await waitFor(() => expect(screen.getByText(/couldn't find any items/i)).toBeInTheDocument())
    expect(onParsed).not.toHaveBeenCalled()
  })

  it('PantryAddSheet hands the scan to its host, with the confirm key left for manual items', async () => {
    mockUpload.mockResolvedValue(RESULT)
    const onScanParsed = jest.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <PantryAddSheet isOpen onClose={jest.fn()} onItemsAdded={jest.fn()} onScanParsed={onScanParsed} />
      </QueryClientProvider>,
    )
    pick(container)

    await waitFor(() => expect(onScanParsed).toHaveBeenCalledWith(RESULT))
    // Nothing from the scan sits behind the sheet's own confirm key.
    expect(screen.getByRole('button', { name: 'Add Items' })).toBeDisabled()
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })
})
