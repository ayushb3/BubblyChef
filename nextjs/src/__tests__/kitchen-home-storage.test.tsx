/**
 * Tap a place on the kitchen wall, see what is inside (issue #749): the storage
 * sheet opens on that place's tab, switches place and view without closing,
 * searches every place, moves an item between places through the edit sheet and
 * adds to a place, all through `HeroHome`. Deep link: `/?place=&view=`.
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
    { id: 'chicken', name: 'chicken thighs', location: 'fridge', category: 'meat', quantity: 4, unit: 'item', expiry_date: ymd(3) },
    { id: 'milk', name: 'milk', location: 'fridge', category: 'dairy', quantity: 1, unit: 'L', expiry_date: ymd(9) },
    { id: 'peas', name: 'peas', location: 'freezer', category: 'frozen', quantity: 2, unit: 'bag', expiry_date: null },
    { id: 'rice', name: 'rice', location: 'pantry', category: 'dry_goods', quantity: 1, unit: 'kg', expiry_date: null },
    { id: 'parm', name: 'parmesan', location: 'pantry', category: 'dairy', quantity: 1, unit: 'wedge', expiry_date: ymd(30) },
    { id: 'apples', name: 'apples', location: 'counter', category: 'produce', quantity: 5, unit: 'item', expiry_date: null },
  ]
}

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

/** A pantry that answers like the API: reads, PUT edits and bulk adds mutate it. */
function mockApi(rows: Row[], log: { puts: Array<{ id: string; body: Record<string, unknown> }>; bulks: Array<Record<string, unknown>> }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/decorations')) return json({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return json({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return json({ items: [], count: 0 })
    if (url.includes('/api/pantry/bulk') && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      log.bulks.push(body)
      for (const it of body.items) {
        rows.push({
          id: `new-${rows.length}`,
          name: it.name,
          location: it.storage_location ?? 'pantry',
          category: it.category,
          quantity: it.quantity,
          unit: it.unit,
          expiry_date: it.expiry_date,
        })
      }
      return json({ count: body.items.length, items: [] })
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
let log: { puts: Array<{ id: string; body: Record<string, unknown> }>; bulks: Array<Record<string, unknown>> }
beforeEach(() => {
  rows = seed()
  log = { puts: [], bulks: [] }
  mockParams = new URLSearchParams('')
  replaceSpy.mockClear()
  mockApi(rows, log)
})
afterEach(() => {
  global.fetch = originalFetch
})

async function openPlace(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.findByTestId('storage-sheet')
}

describe('opening a place', () => {
  it.each([
    ['Fridge', /^Fridge, 3 items/],
    ['Freezer', /^Freezer, 1 item/],
    ['Shelves', /^Shelves, 2 items/],
    ['Basket', /^Basket, 1 item/],
  ])('%s opens its own sheet, on its own tab', async (label, wall) => {
    renderHome()
    const sheet = await openPlace(wall)
    expect(within(sheet).getByRole('heading', { name: label })).toBeInTheDocument()
    expect(within(sheet).getByRole('tab', { name: new RegExp(`^${label}`) })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(sheet).getByRole('button', { name: `Add to the ${label.toLowerCase()}` })).toBeInTheDocument()
  })

  it('shows tab counts that match the wall labels', async () => {
    renderHome()
    const sheet = await openPlace(/^Fridge, 3 items/)
    const tabs = within(sheet).getAllByRole('tab').map((t) => t.getAttribute('aria-label'))
    expect(tabs).toEqual(['Fridge, 3 items', 'Freezer, 1 item', 'Shelves, 2 items', 'Basket, 1 item'])
  })

  it('shows what is in the place: use first, then the rest', async () => {
    renderHome()
    const sheet = await openPlace(/^Fridge, 3 items/)
    const useFirst = within(sheet).getByRole('region', { name: 'Use first' })
    expect(within(useFirst).getByRole('button', { name: 'Romaine, 1 head, expires today' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Milk, 1 L' })).toBeInTheDocument()
    expect(sheet).toHaveTextContent('3 items · 2 to use soon')
  })

  it('switches place and view without closing the sheet', async () => {
    renderHome()
    const sheet = await openPlace(/^Fridge, 3 items/)
    fireEvent.click(within(sheet).getByRole('tab', { name: /^Freezer/ }))
    expect(within(sheet).getByRole('heading', { name: 'Freezer' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Peas, 2 bag' })).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'List' }))
    // The List is every place in one list (#750), the Freezer's peas among them.
    expect(within(sheet).getAllByTestId('storage-row')).toHaveLength(7)
    expect(within(sheet).getByRole('button', { name: 'Peas, 2 bag' })).toBeInTheDocument()
    expect(screen.getByTestId('storage-sheet')).toBeInTheDocument()
  })

  it('closes with the close button', async () => {
    renderHome()
    const sheet = await openPlace(/^Fridge, 3 items/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('storage-sheet')).not.toBeInTheDocument())
  })
})

describe('deep link /?place=&view=', () => {
  it('opens the sheet directly, on that place and view', async () => {
    mockParams = new URLSearchParams('place=freezer&view=list')
    renderHome()
    const sheet = await screen.findByTestId('storage-sheet')
    expect(within(sheet).getByRole('heading', { name: 'Freezer' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(within(sheet).getAllByTestId('storage-row')).toHaveLength(1))
  })

  it('defaults to the scene view', async () => {
    mockParams = new URLSearchParams('place=shelves')
    renderHome()
    const sheet = await screen.findByTestId('storage-sheet')
    expect(within(sheet).getByRole('button', { name: 'Scene' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['place=attic', 'view=list', ''])('opens nothing for "%s"', async (qs) => {
    mockParams = new URLSearchParams(qs)
    renderHome()
    await screen.findByRole('button', { name: /^Fridge, 3 items/ })
    expect(screen.queryByTestId('storage-sheet')).not.toBeInTheDocument()
  })

  it('clears the params when the sheet closes, so a refresh does not reopen it', async () => {
    mockParams = new URLSearchParams('place=fridge&view=scene')
    renderHome()
    const sheet = await screen.findByTestId('storage-sheet')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(replaceSpy).toHaveBeenCalledWith('/', { scroll: false })
  })
})

describe('search', () => {
  it('finds "parm" from the Fridge sheet wherever it is stored, labelled with its place', async () => {
    renderHome()
    const sheet = await openPlace(/^Fridge, 3 items/)
    fireEvent.change(within(sheet).getByRole('searchbox'), { target: { value: 'parm' } })
    const hit = within(sheet).getByRole('button', { name: /^Parmesan/ })
    expect(hit).toHaveTextContent('Shelves · Dairy and eggs')
  })
})

describe('moving an item between places', () => {
  it('saves the new location from the edit sheet; the item changes tab and the counts follow', async () => {
    renderHome()
    const sheet = await openPlace(/^Fridge, 3 items/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Milk, 1 L' }))

    // The edit sheet takes over: the storage sheet steps aside (one trap at a time).
    const edit = await screen.findByRole('dialog', { name: /Edit Item/ })
    await waitFor(() => expect(screen.queryByTestId('storage-sheet')).not.toBeInTheDocument())
    expect(within(edit).getByRole('radio', { name: 'Fridge' })).toBeChecked()
    fireEvent.click(within(edit).getByRole('radio', { name: 'Freezer' }))
    fireEvent.click(within(edit).getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(log.puts).toHaveLength(1))
    expect(log.puts[0]).toMatchObject({ id: 'milk', body: { location: 'freezer' } })

    // Back on the Fridge tab: milk is gone from it, and the counts moved.
    const back = await screen.findByTestId('storage-sheet')
    await waitFor(() =>
      expect(within(back).getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual([
        'Fridge, 2 items',
        'Freezer, 2 items',
        'Shelves, 2 items',
        'Basket, 1 item',
      ]),
    )
    expect(within(back).queryByRole('button', { name: 'Milk, 1 L' })).not.toBeInTheDocument()
    fireEvent.click(within(back).getByRole('tab', { name: /^Freezer/ }))
    expect(within(back).getByRole('button', { name: 'Milk, 1 L' })).toBeInTheDocument()

    // The wall's own labels moved too.
    fireEvent.click(within(back).getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('button', { name: /^Freezer, 2 items/ })).toBeInTheDocument()
  })
})

describe('adding to a place', () => {
  it('"Add to the freezer" opens the add sheet for the freezer and saves with that location', async () => {
    renderHome()
    const sheet = await openPlace(/^Freezer, 1 item/)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add to the freezer' }))

    const add = await screen.findByRole('dialog', { name: 'Add to Pantry' })
    expect(add).toHaveTextContent('Adding to the freezer')
    fireEvent.change(within(add).getByPlaceholderText('Item name (e.g. Milk, Eggs...)'), {
      target: { value: 'Ice cream' },
    })
    fireEvent.click(await within(add).findByRole('button', { name: /Add 1 Item/i }))

    await waitFor(() => expect(log.bulks).toHaveLength(1))
    expect((log.bulks[0].items as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'Ice cream',
      storage_location: 'freezer',
    })

    // The sheet is back after the add's celebration, with the freezer's count up.
    await waitFor(
      () =>
        expect(
          within(screen.getByTestId('storage-sheet'))
            .getAllByRole('tab')
            .map((t) => t.getAttribute('aria-label')),
        ).toContain('Freezer, 2 items'),
      { timeout: 4000 },
    )
  })
})
