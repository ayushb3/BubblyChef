/**
 * The storage sheet's List through `HeroHome` (issue #750): bulk edits hit the
 * existing per-item endpoints and the wall's counts follow; the old Pantry
 * addresses' targets (`/?place=&view=list`, `&expiry=`, `/?add=scan`) open what
 * the old pages did.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'

const replaceSpy = jest.fn()
let mockParams = new URLSearchParams('')
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceSpy, push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockParams,
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

function seed(): Row[] {
  return [
    { id: 'romaine', name: 'romaine', location: 'fridge', category: 'produce', quantity: 1, unit: 'head', expiry_date: ymd(0) },
    { id: 'carrots', name: 'carrots', location: 'fridge', category: 'produce', quantity: 5, unit: 'item', expiry_date: ymd(12) },
    { id: 'cucumber', name: 'cucumber', location: 'fridge', category: 'produce', quantity: 2, unit: 'item', expiry_date: ymd(8) },
    { id: 'parsley', name: 'parsley', location: 'fridge', category: 'produce', quantity: 1, unit: 'bunch', expiry_date: ymd(6) },
    { id: 'peas', name: 'peas', location: 'freezer', category: 'frozen', quantity: 2, unit: 'bag', expiry_date: null },
    { id: 'rice', name: 'rice', location: 'pantry', category: 'dry_goods', quantity: 1, unit: 'kg', expiry_date: null },
    { id: 'apples', name: 'apples', location: 'counter', category: 'produce', quantity: 5, unit: 'item', expiry_date: null },
  ]
}

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

type Log = {
  puts: Array<{ id: string; body: Record<string, unknown> }>
  resolves: Array<{ id: string; outcome: string }>
}

/** A pantry that answers like the API: PUT edits and resolves mutate it. */
function mockApi(rows: Row[], log: Log, failResolve: string[] = []) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/decorations')) return json({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return json({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return json({ items: [], count: 0 })
    const resolve = /\/api\/pantry\/([^/?]+)\/resolve$/.exec(url)
    if (resolve && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      log.resolves.push({ id: resolve[1], outcome: body.outcome })
      if (failResolve.includes(resolve[1])) return json({ error: 'nope' }, false)
      const at = rows.findIndex((r) => r.id === resolve[1])
      if (at >= 0) rows.splice(at, 1)
      return json({ id: resolve[1], outcome: body.outcome, resolved: true })
    }
    const one = /\/api\/pantry\/([^/?]+)$/.exec(url)
    if (one && method === 'PUT') {
      const body = JSON.parse(String(init?.body))
      log.puts.push({ id: one[1], body })
      const row = rows.find((r) => r.id === one[1])!
      Object.assign(row, body)
      return json(row)
    }
    if (url.includes('/api/pantry')) return json({ items: rows.map((r) => ({ ...r })), total_count: rows.length })
    return json({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
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
let rows: Row[]
let log: Log
beforeEach(() => {
  rows = seed()
  log = { puts: [], resolves: [] }
  mockParams = new URLSearchParams('')
  replaceSpy.mockClear()
  mockApi(rows, log)
})
afterEach(() => {
  global.fetch = originalFetch
})

async function openList() {
  fireEvent.click(await screen.findByRole('button', { name: /^Fridge, 4 items/ }))
  const sheet = await screen.findByTestId('storage-sheet')
  fireEvent.click(within(sheet).getByRole('button', { name: 'List' }))
  return sheet
}

const tick = (sheet: HTMLElement, label: RegExp) =>
  fireEvent.click(within(sheet).getByRole('checkbox', { name: label }))

describe('bulk move', () => {
  it('selecting 3 items and choosing "Move to Freezer" updates all 3 locations and the counts', async () => {
    renderHome()
    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }))
    tick(sheet, /^Carrots/)
    tick(sheet, /^Cucumber/)
    tick(sheet, /^Parsley/)
    expect(within(sheet).getByText('3 selected')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: /^Move to/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Freezer' }))

    await waitFor(() => expect(log.puts).toHaveLength(3))
    expect(log.puts.map((p) => p.id).sort()).toEqual(['carrots', 'cucumber', 'parsley'])
    expect(log.puts.every((p) => p.body.location === 'freezer')).toBe(true)

    // The counts follow: tabs, and the wall's labels behind the sheet.
    await waitFor(() => expect(within(sheet).getByRole('tab', { name: /^Fridge, 1 item/ })).toBeInTheDocument())
    expect(within(sheet).getByRole('tab', { name: /^Freezer, 4 items/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Freezer, 4 items/ }).length).toBeGreaterThan(0)
  })
})

describe('bulk resolve', () => {
  it('"Used up" resolves every selected item as used', async () => {
    renderHome()
    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }))
    tick(sheet, /^Carrots/)
    tick(sheet, /^Rice/)
    tick(sheet, /^Peas/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Used up' }))
    await waitFor(() => expect(log.resolves).toHaveLength(3))
    expect(log.resolves.map((r) => r.outcome)).toEqual(['used', 'used', 'used'])
    expect(log.resolves.map((r) => r.id).sort()).toEqual(['carrots', 'peas', 'rice'])
    await waitFor(() => expect(within(sheet).queryByRole('checkbox', { name: /^Rice/ })).not.toBeInTheDocument())
    expect(within(sheet).getByRole('tab', { name: /^Shelves, 0 items/ })).toBeInTheDocument()
  })

  it('"Tossed" resolves every selected item as tossed, after the confirm', async () => {
    renderHome()
    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }))
    tick(sheet, /^Carrots/)
    tick(sheet, /^Rice/)
    tick(sheet, /^Apples/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Tossed' }))
    expect(log.resolves).toHaveLength(0)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Yes, toss them' }))
    await waitFor(() => expect(log.resolves).toHaveLength(3))
    expect(log.resolves.every((r) => r.outcome === 'tossed')).toBe(true)
  })

  it('keeps the items that failed selected and says so', async () => {
    mockApi(rows, log, ['rice'])
    renderHome()
    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }))
    tick(sheet, /^Carrots/)
    tick(sheet, /^Rice/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Used up' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(/1 of 2/)
    expect(within(sheet).getByRole('checkbox', { name: /^Rice/ })).toBeChecked()
  })

  it('an expiring item can be used up straight from its row', async () => {
    renderHome()
    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: /Mark romaine as used up/i }))
    await waitFor(() => expect(log.resolves).toEqual([{ id: 'romaine', outcome: 'used' }]))
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: /^Romaine/ })).not.toBeInTheDocument())
  })
})

describe('the old Pantry addresses, as the home receives them', () => {
  it('/?place=fridge&view=list opens the sheet in List view, every place listed', async () => {
    mockParams = new URLSearchParams('place=fridge&view=list')
    renderHome()
    const sheet = await screen.findByTestId('storage-sheet')
    expect(within(sheet).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(within(sheet).getAllByTestId('storage-row')).toHaveLength(7))
  })

  it('&expiry=expiring,expired opens the List with the expiry filter on', async () => {
    mockParams = new URLSearchParams('place=fridge&view=list&expiry=expiring,expired')
    renderHome()
    const sheet = await screen.findByTestId('storage-sheet')
    await waitFor(() => expect(within(sheet).getAllByTestId('storage-row')).toHaveLength(1))
    expect(within(sheet).getByRole('button', { name: /^Romaine/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /Filter by expiry status, 2 selected/ })).toBeInTheDocument()
  })

  it('/?add=scan opens the add sheet on its scan tab', async () => {
    mockParams = new URLSearchParams('add=scan')
    renderHome()
    expect(await screen.findByRole('heading', { name: 'Add to Pantry' })).toBeInTheDocument()
    // The scan panel is the live one; the type panel is inert behind it.
    expect(screen.getByText('Drop your receipt here')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Item name' })).not.toBeInTheDocument()
  })

  it('/?add=type opens the add sheet on its type tab', async () => {
    mockParams = new URLSearchParams('add=type')
    renderHome()
    expect(await screen.findByRole('textbox', { name: 'Item name' })).toBeInTheDocument()
  })

  it('closing the add sheet clears ?add so a refresh does not reopen it', async () => {
    mockParams = new URLSearchParams('add=scan')
    renderHome()
    await screen.findByRole('heading', { name: 'Add to Pantry' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(replaceSpy).toHaveBeenCalled())
    expect(String(replaceSpy.mock.calls[0][0])).not.toContain('add=')
  })
})
