/**
 * Issue #753 — the add sheet's scan tab, on the kitchen home (`/?add=scan`, where
 * the old `/pantry?add=scan` lands since #750).
 *
 * The home owns that sheet, so the hand-off happens on the same page: the parsed
 * scan becomes the pending put-away, the add sheet gives way to the put-away
 * sheet, and nothing is written until "Put away". The scan response is mocked.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import { clearPendingPutAway, readPendingPutAway } from '@/lib/kitchen/pending-putaway'
import * as scanApi from '@/lib/api/scan'
import * as pantryApi from '@/lib/api/pantry'
import type { ScanResult } from '@/types/scan'

let mockSearch = 'add=scan'
const replace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
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
  ready_to_add: [item('Whole Milk', 'fridge', 0.95), item('Peas', 'freezer', 0.9)],
  needs_review: [item('Green peppers', 'fridge', 0.6)],
  skipped: [],
  total_items: 3,
  warnings: [],
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const originalFetch = global.fetch
const originalScrollTo = window.scrollTo

beforeEach(() => {
  jest.clearAllMocks()
  mockSearch = 'add=scan'
  window.localStorage.clear()
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) return jsonResponse({ items: [], total_count: 0 })
    return jsonResponse({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
})
afterEach(() => clearPendingPutAway())
afterAll(() => {
  global.fetch = originalFetch
  window.scrollTo = originalScrollTo
})

it('a scan parsed in the add sheet opens put-away on the home, with nothing written', async () => {
  mockUpload.mockResolvedValue(RESULT)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )

  const input = await waitFor(() => {
    const el = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement | null
    if (!el) throw new Error('scan tab not open yet')
    return el
  })
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'receipt.png', { type: 'image/png' })] },
  })

  const dialog = await screen.findByRole('dialog', { name: 'Put the shopping away?' })
  expect(within(dialog).getByText(/Grocery Mart · 3 items/)).toBeInTheDocument()
  // The add sheet has given way, and the address no longer asks for it.
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Add to Pantry' })).not.toBeInTheDocument(),
  )
  expect(replace).toHaveBeenCalledWith('/', { scroll: false })

  expect(readPendingPutAway()!.ready.map((i) => i.name)).toEqual(['Whole Milk', 'Peas'])
  expect(mockBulkAdd).not.toHaveBeenCalled()
  // Going in only: the unanswered line is not counted.
  expect(within(dialog).getByRole('button', { name: 'Put away 2 items' })).toBeInTheDocument()
})

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )
}

function upload() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'receipt.png', { type: 'image/png' })] },
  })
}

// The path the review found dead: home, tap a place, "Add to the fridge", the Scan
// tab, upload. Nothing in the URL asks for the add sheet, and the sheet is not
// opened as a scan entry point, so the hand-off must not depend on the host.
it('Add to the fridge, then the Scan tab: a parsed scan still lands on put-away', async () => {
  mockSearch = ''
  mockUpload.mockResolvedValue(RESULT)
  renderHome()

  fireEvent.click(await screen.findByRole('button', { name: /^Fridge/ }))
  const storage = await screen.findByRole('dialog', { name: /Fridge/ })
  fireEvent.click(within(storage).getByRole('button', { name: 'Add to the fridge' }))

  const add = await screen.findByRole('dialog', { name: 'Add to Pantry' })
  fireEvent.click(within(add).getByRole('button', { name: 'Scan' }))
  upload()

  const dialog = await screen.findByRole('dialog', { name: 'Put the shopping away?' })
  expect(within(dialog).getByText(/Grocery Mart · 3 items/)).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Add to Pantry' })).not.toBeInTheDocument(),
  )
  expect(readPendingPutAway()).not.toBeNull()
  expect(mockBulkAdd).not.toHaveBeenCalled()
  // Never stuck on the hand-off message.
  expect(screen.queryByText(/Taking your shopping to the kitchen/)).not.toBeInTheDocument()
})

it('a second scan reopens put-away even when the first is still pending and closed', async () => {
  mockSearch = ''
  mockUpload.mockResolvedValue(RESULT)
  renderHome()

  fireEvent.click(await screen.findByRole('button', { name: /^Fridge/ }))
  let storage = await screen.findByRole('dialog', { name: /Fridge/ })
  fireEvent.click(within(storage).getByRole('button', { name: 'Add to the fridge' }))
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Add to Pantry' })).getByRole('button', { name: 'Scan' }))
  upload()
  const first = await screen.findByRole('dialog', { name: 'Put the shopping away?' })
  fireEvent.click(within(first).getByRole('button', { name: 'Close' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Put the shopping away?' })).not.toBeInTheDocument(),
  )
  const firstSavedAt = readPendingPutAway()!.savedAt

  // Scan again from the same place.
  fireEvent.click(screen.getByRole('button', { name: /^Fridge/ }))
  storage = await screen.findByRole('dialog', { name: /Fridge/ })
  fireEvent.click(within(storage).getByRole('button', { name: 'Add to the fridge' }))
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Add to Pantry' })).getByRole('button', { name: 'Scan' }))
  await new Promise((r) => setTimeout(r, 5))
  upload()

  await screen.findByRole('dialog', { name: 'Put the shopping away?' })
  expect(readPendingPutAway()!.savedAt).not.toBe(firstSavedAt)
})
