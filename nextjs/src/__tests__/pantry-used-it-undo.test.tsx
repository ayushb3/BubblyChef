/**
 * Issue #851, through `HeroHome` and the real endpoints' shapes:
 *  - "Used it" hides the row at once but writes nothing for the undo window; Undo
 *    brings the very same row back and the resolve endpoint is never called;
 *  - with no undo, the write lands and the row stays gone;
 *  - the undo outlives the page: the home can unmount and Undo still restores;
 *  - "Used some" -> half halves the quantity (a PUT, not a resolve).
 *
 * The undo window is shortened (the store's test seam) so this runs on real
 * timers; the five-second default is pinned in `pantry-undo-store.test.ts`.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import UndoToastHost from '@/components/pantry/UndoToastHost'
import { resetDeferredResolvesForTests, setUndoWindowMsForTests } from '@/lib/pantry-undo'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

type Row = {
  id: string
  name: string
  location: string
  category: string
  quantity: number
  unit: string
  expiry_date: string | null
}

function ymd(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('en-CA')
}

const WINDOW_MS = 400

let rows: Row[]
let resolves: Array<{ id: string; outcome: string }>
let puts: Array<{ id: string; body: Record<string, unknown> }>

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

function mockApi() {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/decorations')) return json({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return json({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return json({ items: [], count: 0 })
    const resolve = /\/api\/pantry\/([^/?]+)\/resolve$/.exec(url)
    if (resolve && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      resolves.push({ id: resolve[1], outcome: body.outcome })
      const at = rows.findIndex((r) => r.id === resolve[1])
      if (at >= 0) rows.splice(at, 1)
      return json({ id: resolve[1], outcome: body.outcome, resolved: true })
    }
    const one = /\/api\/pantry\/([^/?]+)$/.exec(url)
    if (one && method === 'PUT') {
      const body = JSON.parse(String(init?.body))
      puts.push({ id: one[1], body })
      const row = rows.find((r) => r.id === one[1])!
      Object.assign(row, body)
      return json(row)
    }
    if (url.includes('/api/pantry')) return json({ items: rows.map((r) => ({ ...r })), total_count: rows.length })
    return json({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

function Tree({ home = true }: { home?: boolean }) {
  const client = React.useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    [],
  )
  return (
    <QueryClientProvider client={client}>
      {home && <HeroHome displayName="ayush" />}
      <UndoToastHost />
    </QueryClientProvider>
  )
}

async function openFridgeList() {
  fireEvent.click(await screen.findByRole('button', { name: /^Fridge, 2 items/ }))
  const sheet = await screen.findByTestId('storage-sheet')
  fireEvent.click(within(sheet).getByRole('button', { name: 'List' }))
  return sheet
}

const originalFetch = global.fetch
beforeEach(() => {
  rows = [
    { id: 'basil', name: 'basil', location: 'fridge', category: 'produce', quantity: 1, unit: 'bunch', expiry_date: ymd(1) },
    { id: 'milk', name: 'milk', location: 'fridge', category: 'dairy', quantity: 4, unit: 'L', expiry_date: ymd(0) },
    { id: 'rice', name: 'rice', location: 'pantry', category: 'dry_goods', quantity: 1, unit: 'kg', expiry_date: null },
  ]
  resolves = []
  puts = []
  resetDeferredResolvesForTests()
  setUndoWindowMsForTests(WINDOW_MS)
  mockApi()
})
afterEach(() => {
  global.fetch = originalFetch
  resetDeferredResolvesForTests()
})

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))

describe('"Used it" can be undone (#851)', () => {
  it('hides the row at once, writes nothing, and Undo brings the same row back', async () => {
    render(<Tree />)
    const sheet = await openFridgeList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark basil as used up' }))

    expect(within(sheet).queryByRole('button', { name: /^Basil/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Basil marked as used up')
    expect(resolves).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: /Undo marking Basil/i }))
    expect(await within(sheet).findByRole('button', { name: /^Basil/ })).toBeInTheDocument()

    await wait(WINDOW_MS * 2)
    expect(resolves).toEqual([]) // never written
    expect(within(sheet).getByRole('button', { name: /^Basil/ })).toBeInTheDocument()
  })

  it('without an undo, the write lands and the row stays gone', async () => {
    render(<Tree />)
    const sheet = await openFridgeList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark basil as used up' }))

    await waitFor(() => expect(resolves).toEqual([{ id: 'basil', outcome: 'used' }]))
    await wait(100)
    expect(within(sheet).queryByRole('button', { name: /^Basil/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undo/i })).not.toBeInTheDocument()
  })

  it('the undo outlives the page: unmount the home, Undo, and the item is still there', async () => {
    const view = render(<Tree />)
    const sheet = await openFridgeList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark basil as used up' }))

    // Navigate away: the home goes, the toast (mounted at the root) stays.
    view.rerender(<Tree home={false} />)
    // `Tree` remounts its client on rerender with a different tree shape; the
    // store, not the tree, is what holds the pending resolve.
    fireEvent.click(await screen.findByRole('button', { name: /Undo marking Basil/i }))
    await wait(WINDOW_MS * 2)
    expect(resolves).toEqual([])

    // Back on the home, Basil is there with its id and quantity untouched.
    view.rerender(<Tree />)
    const again = await openFridgeList()
    expect(await within(again).findByRole('button', { name: /^Basil/ })).toBeInTheDocument()
  })
})

describe('"Used some" (#851)', () => {
  it('half halves the quantity (a quantity edit, not a resolve)', async () => {
    render(<Tree />)
    const sheet = await openFridgeList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark some of milk as used' }))
    fireEvent.click(within(sheet).getByRole('button', { name: /Used half of milk/i }))

    await waitFor(() => expect(puts).toEqual([{ id: 'milk', body: { quantity: 2 } }]))
    expect(resolves).toEqual([])
    expect(await within(sheet).findByRole('button', { name: /^Milk, 2 L/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('status')).toHaveTextContent(/Milk: 2 L left/i)
  })

  it('a quarter leaves three quarters', async () => {
    render(<Tree />)
    const sheet = await openFridgeList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark some of milk as used' }))
    fireEvent.click(within(sheet).getByRole('button', { name: /Used a quarter of milk/i }))
    await waitFor(() => expect(puts).toEqual([{ id: 'milk', body: { quantity: 3 } }]))
  })

  it('a custom amount subtracts exactly that', async () => {
    render(<Tree />)
    const sheet = await openFridgeList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark some of milk as used' }))
    fireEvent.click(within(sheet).getByRole('button', { name: /Other amount/i }))
    fireEvent.change(within(sheet).getByLabelText(/Amount used, in L/i), { target: { value: '1.5' } })
    fireEvent.click(within(sheet).getByRole('button', { name: /^Use$/ }))
    await waitFor(() => expect(puts).toEqual([{ id: 'milk', body: { quantity: 2.5 } }]))
  })
})
