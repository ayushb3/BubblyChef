/**
 * The kitchen home with shopping to put away (issue #753): a pending scan opens
 * the put-away sheet over the scene, Bubbles stands at the door, each place shows
 * +N, nothing is written before "Put away", and after it the sheet closes, the
 * pending scan clears and the counts refresh. Leaving keeps the scan pending, and
 * a reload (a fresh mount) reopens it.
 *
 * The pantry fetches are mocked and so is the bulk write. No model is called.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import {
  clearPendingPutAway,
  pendingFromScan,
  readPendingPutAway,
  savePendingPutAway,
} from '@/lib/kitchen/pending-putaway'
import * as pantryApi from '@/lib/api/pantry'
import type { ScanResult } from '@/types/scan'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('@/lib/api/pantry')
const mockBulkAdd = pantryApi.bulkAddPantryItems as jest.MockedFunction<
  typeof pantryApi.bulkAddPantryItems
>

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function scanned(name: string, location: string, over: Record<string, unknown> = {}) {
  return {
    name,
    original_name: name.toLowerCase(),
    source_line: name.toUpperCase(),
    price: 1,
    quantity: 1,
    unit: 'item',
    category: 'other',
    location,
    confidence: 0.95,
    ...over,
  }
}

const SCAN: ScanResult = {
  ocr_text: 'GROCERY MART\nMILK 4.29',
  ready_to_add: [
    scanned('Milk', 'fridge'),
    scanned('Eggs', 'fridge'),
    scanned('Peas', 'freezer'),
    scanned('Spaghetti', 'pantry'),
    scanned('Bananas', 'counter'),
  ],
  needs_review: [scanned('Green peppers', 'fridge', { confidence: 0.6, quantity: 2 })],
  skipped: [scanned('Bag fee', 'pantry', { confidence: 0.2 })],
  total_items: 7,
  warnings: [],
}

let pantryItems: Array<Record<string, unknown>>
let fetchSpy: jest.Mock

function mockFetch() {
  fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) {
      return jsonResponse({ items: pantryItems, total_count: pantryItems.length })
    }
    return jsonResponse({ recipes: [], total_count: 0 })
  })
  global.fetch = fetchSpy as unknown as typeof fetch
}

function pantryFetchCount() {
  return fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/api/pantry')).length
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )
}

const originalFetch = global.fetch
const originalScrollTo = window.scrollTo

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo
  pantryItems = [
    { id: 'a', name: 'Butter', category: 'dairy', location: 'fridge', quantity: 1, unit: 'item', expiry_date: null },
    { id: 'b', name: 'Rice', category: 'dry_goods', location: 'pantry', quantity: 1, unit: 'bag', expiry_date: null },
  ]
  mockFetch()
})
afterEach(() => {
  clearPendingPutAway()
})
afterAll(() => {
  global.fetch = originalFetch
  window.scrollTo = originalScrollTo
})

it('opens no sheet when nothing is waiting', async () => {
  renderHome()
  await waitFor(() => expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge 1'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByTestId('put-away-waiting')).not.toBeInTheDocument()
})

describe('with a scan waiting', () => {
  beforeEach(() => {
    savePendingPutAway(pendingFromScan(SCAN))
  })

  it('opens put-away over the kitchen, with nothing written', async () => {
    renderHome()
    expect(await screen.findByRole('dialog', { name: 'Put the shopping away?' })).toBeInTheDocument()
    expect(screen.getByText(/Grocery Mart · 6 items/)).toBeInTheDocument()
    expect(mockBulkAdd).not.toHaveBeenCalled()
    // Not a single POST of any kind went out.
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toEqual([])
  })

  it('shows +N on each place for what is headed there', async () => {
    renderHome()
    await screen.findByRole('dialog')
    // Fridge: Milk, Eggs, and the green peppers still being asked about.
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +3')
    expect(screen.getByRole('button', { name: /^Freezer/ })).toHaveTextContent('Freezer +1')
    expect(screen.getByRole('button', { name: /^Shelves/ })).toHaveTextContent('Shelves +1')
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket +1')
  })

  it("puts Bubbles at the door while shopping waits", async () => {
    renderHome()
    await screen.findByRole('dialog')
    expect(screen.getByTestId('kitchen-wall')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Bubbles is by the door'),
    )
  })

  it("Fix moves an item's place and its +N badge moves with it", async () => {
    renderHome()
    const dialog = await screen.findByRole('dialog')
    const peppers = within(dialog).getByRole('listitem', { name: /Green peppers/ })
    fireEvent.click(within(peppers).getByRole('button', { name: 'Fix Green peppers' }))
    fireEvent.click(within(peppers).getByRole('radio', { name: 'Basket' }))

    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +2')
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket +2')
  })

  it('Put away writes the items, refreshes the counts, clears the scan and closes', async () => {
    mockBulkAdd.mockResolvedValue({ count: 6, items: [] })
    renderHome()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(pantryFetchCount()).toBe(1))

    // The pantry now holds the shopping too: what the refresh will read.
    pantryItems = [
      ...pantryItems,
      ...['Milk', 'Eggs', 'Green peppers'].map((name, i) => ({
        id: `f${i}`, name, category: 'dairy', location: 'fridge', quantity: 1, unit: 'item', expiry_date: null,
      })),
    ]

    fireEvent.click(within(dialog).getByRole('button', { name: 'Put away 6 items' }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(readPendingPutAway()).toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Counts refreshed (a second pantry load), and the badges gave way to them.
    expect(pantryFetchCount()).toBe(2)
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge 4')
    expect(screen.getByRole('button', { name: /^Fridge/ })).not.toHaveTextContent('+')
    // Bubbles has left the door.
    expect(screen.getByTestId('kitchen-wall')).not.toHaveAttribute(
      'aria-label',
      expect.stringContaining('by the door'),
    )
  })

  it('a failed write keeps the sheet open on home, with the scan still pending', async () => {
    mockBulkAdd.mockRejectedValue(new Error('boom'))
    renderHome()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put away 6 items' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Put the shopping away?' })).toBeInTheDocument()
    expect(readPendingPutAway()).not.toBeNull()
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +3')
  })

  it('Discard clears the scan, closes the sheet and takes the badges away', async () => {
    renderHome()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard this scan' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, discard it' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(readPendingPutAway()).toBeNull()
    expect(screen.getByRole('button', { name: /^Fridge/ })).not.toHaveTextContent('+')
    expect(mockBulkAdd).not.toHaveBeenCalled()
  })

  it('closing the sheet keeps the scan pending, with the way back in and the badges still up', async () => {
    renderHome()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(readPendingPutAway()).not.toBeNull()
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +3')

    const waiting = screen.getByTestId('put-away-waiting')
    expect(within(waiting).getByText(/6 items/)).toBeInTheDocument()
    fireEvent.click(within(waiting).getByRole('button', { name: 'Put it away' }))
    expect(await screen.findByRole('dialog', { name: 'Put the shopping away?' })).toBeInTheDocument()
  })

  it('reopens put-away after a reload, from the pending record', async () => {
    const first = renderHome()
    await screen.findByRole('dialog')
    first.unmount()

    // A fresh mount is a reload: only local storage survives.
    renderHome()
    expect(await screen.findByRole('dialog', { name: 'Put the shopping away?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Going in 5/ })).toBeInTheDocument()
  })
})
