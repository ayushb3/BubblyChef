/**
 * The kitchen home with shopping to put away (issue #753): a pending scan opens
 * the put-away sheet over the scene, Bubbles stands at the door, each place shows
 * +N, nothing is written before "Put away", and after it the sheet closes, the
 * pending scan clears and the counts refresh. Leaving keeps the scan pending, and
 * a reload (a fresh mount) reopens it.
 *
 * Issue #754: after the write succeeds each item hops from the sheet to its own
 * place, the tags tick +1, +2... as each lands, and the real counts settle when it
 * is over (or at once on a tap, or under reduced motion). A failed write plays
 * nothing.
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

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))
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
  mockReduced = false
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
    // Going in only: Milk and Eggs. The green peppers are still being asked about.
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +2')
    expect(screen.getByRole('button', { name: /^Freezer/ })).toHaveTextContent('Freezer +1')
    expect(screen.getByRole('button', { name: /^Shelves/ })).toHaveTextContent('Shelves +1')
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket +1')
  })

  it('an unanswered line adds no +N until it is answered Yes', async () => {
    renderHome()
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +2')

    fireEvent.click(within(dialog).getByRole('button', { name: /^Yes.*Green peppers/ }))
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +3')
  })

  it("puts Bubbles at the door while shopping waits", async () => {
    renderHome()
    await screen.findByRole('dialog')
    expect(screen.getByTestId('kitchen-wall')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Bubbles is by the door'),
    )
  })

  it("Fix then Done answers it, and its +N lands under the place it was moved to", async () => {
    renderHome()
    const dialog = await screen.findByRole('dialog')
    const peppers = within(dialog).getByRole('listitem', { name: /Green peppers/ })
    fireEvent.click(within(peppers).getByRole('button', { name: 'Fix Green peppers' }))
    fireEvent.click(within(peppers).getByRole('radio', { name: 'Basket' }))
    // Moving it is not answering it: still no +N for it anywhere.
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket +1')
    fireEvent.click(within(peppers).getByRole('button', { name: 'Done' }))

    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +2')
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket +2')
  })

  it('Put away writes the items, refreshes the counts, clears the scan and closes', async () => {
    mockBulkAdd.mockResolvedValue({ count: 5, items: [] })
    renderHome()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(pantryFetchCount()).toBe(1))

    // The pantry now holds the shopping too: what the refresh will read.
    pantryItems = [
      ...pantryItems,
      ...['Milk', 'Eggs'].map((name, i) => ({
        id: `f${i}`, name, category: 'dairy', location: 'fridge', quantity: 1, unit: 'item', expiry_date: null,
      })),
    ]

    fireEvent.click(within(dialog).getByRole('button', { name: 'Put away 5 items' }))

    await waitFor(() => expect(mockBulkAdd).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(readPendingPutAway()).toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // The items hop into place (below); a tap jumps to where it ends.
    fireEvent.pointerDown(document.body)

    // Counts refreshed (a second pantry load), and the badges gave way to them.
    await waitFor(() => expect(pantryFetchCount()).toBe(2))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge 3'),
    )
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put away 5 items' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Put the shopping away?' })).toBeInTheDocument()
    expect(readPendingPutAway()).not.toBeNull()
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +2')
    // A failed write never animates: nothing flew, and nothing is queued to.
    expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('put-away-flight')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 400))
    expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()
    expect(pantryFetchCount()).toBe(1)
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
    expect(screen.getByRole('button', { name: /^Fridge/ })).toHaveTextContent('Fridge +2')

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

// Issue #754: the hop into place, on the real home. Timers are real (a few
// seconds at most): the flight is deterministic and bounded.
describe('the items hop into their places after a successful put-away', () => {
  function fridgeButton() {
    return screen.getByRole('button', { name: /^Fridge/ })
  }
  function written(names: string[], location: string) {
    return names.map((name, i) => ({
      id: `w-${location}-${i}`, name, category: 'other', location, quantity: 1, unit: 'item', expiry_date: null,
    }))
  }

  beforeEach(() => {
    savePendingPutAway(pendingFromScan(SCAN))
    mockBulkAdd.mockResolvedValue({ count: 5, items: [] })
  })

  async function putAway5() {
    renderHome()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(pantryFetchCount()).toBe(1))
    // What the refresh will read once the write has landed.
    pantryItems = [
      ...pantryItems,
      ...written(['Milk', 'Eggs'], 'fridge'),
      ...written(['Peas'], 'freezer'),
      ...written(['Spaghetti'], 'pantry'),
      ...written(['Bananas'], 'counter'),
    ]
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put away 5 items' }))
  }

  it('flies each item, ticks the tags up as they land, then settles the real counts', async () => {
    await putAway5()

    // On their way: chips in the air, the sheet gone, the pending scan cleared.
    expect((await screen.findAllByTestId('put-away-chip')).length).toBeGreaterThan(0)
    expect(readPendingPutAway()).toBeNull()

    // The first landing: the fridge reads +1. The real counts are held back, not yet re-read.
    await waitFor(() => expect(fridgeButton()).toHaveTextContent('Fridge +1'))
    expect(pantryFetchCount()).toBe(1)
    await waitFor(() => expect(fridgeButton()).toHaveTextContent('Fridge +2'))
    expect(
      screen.getByTestId('kitchen-wall').querySelector('[data-testid="incoming-sparkles"][data-place="fridge"]'),
    ).not.toBeNull()

    // Then it settles: the real counts, no +N, the chips gone.
    await waitFor(() => expect(fridgeButton()).toHaveTextContent('Fridge 3'), { timeout: 4000 })
    expect(fridgeButton()).not.toHaveTextContent('+')
    expect(screen.getByRole('button', { name: /^Freezer/ })).toHaveTextContent('Freezer 1')
    expect(screen.getByRole('button', { name: /^Shelves/ })).toHaveTextContent('Shelves 2')
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket 1')
    expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()
    expect(pantryFetchCount()).toBe(2)
  }, 10000)

  it('a tap during the animation jumps straight to the end state', async () => {
    await putAway5()
    await screen.findAllByTestId('put-away-chip')
    expect(fridgeButton()).not.toHaveTextContent('Fridge 3')

    fireEvent.pointerDown(document.body)

    await waitFor(() => expect(fridgeButton()).toHaveTextContent('Fridge 3'))
    expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket 1')
    expect(pantryFetchCount()).toBe(2)
  })

  it('under reduced motion nothing flies: the counts just update', async () => {
    mockReduced = true
    await putAway5()

    await waitFor(() => expect(fridgeButton()).toHaveTextContent('Fridge 3'))
    expect(screen.queryByTestId('put-away-chip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('put-away-flight')).not.toBeInTheDocument()
    expect(screen.getByTestId('kitchen-wall').querySelectorAll('[style*="translate"]').length).toBe(0)
    expect(pantryFetchCount()).toBe(2)
  })

  it('lands 11 items one by one with each place ending correct', async () => {
    const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
    const big: ScanResult = {
      ...SCAN,
      ready_to_add: [
        ...names('F', 4).map((n) => scanned(n, 'fridge')),
        ...names('Z', 2).map((n) => scanned(n, 'freezer')),
        ...names('S', 3).map((n) => scanned(n, 'pantry')),
        ...names('B', 2).map((n) => scanned(n, 'counter')),
      ],
      needs_review: [],
      skipped: [],
    }
    window.localStorage.clear()
    savePendingPutAway(pendingFromScan(big))
    mockBulkAdd.mockResolvedValue({ count: 11, items: [] })

    renderHome()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(pantryFetchCount()).toBe(1))
    pantryItems = [
      ...pantryItems,
      ...written(names('F', 4), 'fridge'),
      ...written(names('Z', 2), 'freezer'),
      ...written(names('S', 3), 'pantry'),
      ...written(names('B', 2), 'counter'),
    ]
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put away 11 items' }))

    // Mid-flight the tags read the running +N.
    await waitFor(() => expect(fridgeButton()).toHaveTextContent('Fridge +2'))
    // And it ends, inside the time budget, with every place's count right.
    await waitFor(() => expect(fridgeButton()).toHaveTextContent('Fridge 5'), { timeout: 5000 })
    expect(screen.getByRole('button', { name: /^Freezer/ })).toHaveTextContent('Freezer 2')
    expect(screen.getByRole('button', { name: /^Shelves/ })).toHaveTextContent('Shelves 4')
    expect(screen.getByRole('button', { name: /^Basket/ })).toHaveTextContent('Basket 2')
  }, 12000)
})
