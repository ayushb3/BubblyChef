/**
 * Issues #807 and #843 — the award reaction on a use-up, end to end, and there is
 * exactly one of it.
 *
 * #807: the Goal 3 demo saw the balance go 1,312 -> 1,320 after "Mark baby spinach
 * as used up" with no reaction on screen. This proves the whole chain on the real
 * home: the storage sheet's Used up action -> the resolve endpoint (which awards)
 * -> the bubbles balance refetch -> the reaction. A break anywhere along it (the
 * resolve path stops invalidating `['bubbles']`, the reaction stops reading the
 * shared cache) fails here, which the isolated tests cannot see.
 *
 * #843: on the kitchen home the reaction is the header counter's own "+N" tag
 * (`bubbles-counter-rise`); the global `BubblePop` stays quiet there while the
 * counter is showing. So an award is one "+N", never two. (`bubble-pop.test` and
 * `bubble-reaction-owner.test` cover `BubblePop` off the home.)
 *
 * "Used it" waits out its undo window before the resolve is written (#851); the
 * window is shortened through the store's test seam so this stays on real timers.
 *
 * Only the network and the router are faked; HeroHome, the storage sheet,
 * react-query, the counter and BubblePop are the real ones, sharing one QueryClient
 * exactly as `Providers` does. Reduced motion is a switch.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import BubblePop from '@/components/ui/BubblePop'
import UndoToastHost from '@/components/pantry/UndoToastHost'
import { resetDeferredResolvesForTests, setUndoWindowMsForTests } from '@/lib/pantry-undo'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

const replaceSpy = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceSpy, push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/',
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
    { id: 'spinach', name: 'baby spinach', location: 'fridge', category: 'produce', quantity: 1, unit: 'bag', expiry_date: ymd(0) },
    { id: 'carrots', name: 'carrots', location: 'fridge', category: 'produce', quantity: 5, unit: 'item', expiry_date: ymd(12) },
  ]
}

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

const START = 1312
const AWARD = 8

/**
 * A backend that answers like the real one: resolving an item as used awards
 * `awardOnUse` bubbles, which the next GET /api/bubbles then reports.
 */
function mockApi(rows: Row[], awardOnUse: number) {
  let balance = START
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/decorations')) return json({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return json({ balance, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return json({ items: [], count: 0 })
    const resolve = /\/api\/pantry\/([^/?]+)\/resolve$/.exec(url)
    if (resolve && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      const at = rows.findIndex((r) => r.id === resolve[1])
      if (at >= 0) rows.splice(at, 1)
      if (body.outcome === 'used') balance += awardOnUse
      return json({ id: resolve[1], outcome: body.outcome, resolved: true })
    }
    if (url.includes('/api/pantry')) return json({ items: rows.map((r) => ({ ...r })), total_count: rows.length })
    return json({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

/**
 * HeroHome and the app-level BubblePop on one QueryClient, as `Providers` mounts
 * them. The undo toast host is part of `Providers` too, so a resolve's write lands
 * and refreshes `['bubbles']` the way it does in the app.
 */
function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
      <BubblePop />
      <UndoToastHost />
    </QueryClientProvider>,
  )
}

async function openList() {
  fireEvent.click(await screen.findByRole('button', { name: /^Fridge, 2 items/ }))
  const sheet = await screen.findByTestId('storage-sheet')
  fireEvent.click(within(sheet).getByRole('button', { name: 'List' }))
  return sheet
}

/** Every "+N" award chip on screen: the global pop and the counter's own tag. */
const chips = () => [
  ...screen.queryAllByTestId('bubble-pop'),
  ...screen.queryAllByTestId('bubbles-counter-rise'),
]

const originalFetch = global.fetch
let rows: Row[]
beforeEach(() => {
  mockReduced = false
  rows = seed()
  resetDeferredResolvesForTests()
  setUndoWindowMsForTests(50)
})
afterEach(() => {
  global.fetch = originalFetch
  resetDeferredResolvesForTests()
})

describe('one award reaction on a use-up award (#807, #843)', () => {
  it('shows one "+8" after "Mark baby spinach as used up" awards 8 bubbles: the counter tag', async () => {
    mockApi(rows, AWARD)
    renderApp()
    // The starting balance has to be known first: the very first observation is
    // an initial load, never a reaction.
    await screen.findByRole('group', { name: `${START} bubbles` })
    expect(chips()).toHaveLength(0)

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: /Mark baby spinach as used up/i }))

    const tag = await screen.findByTestId('bubbles-counter-rise')
    expect(tag).toHaveTextContent(`+${AWARD}`)
    expect(screen.queryByTestId('bubble-pop')).toBeNull()
    expect(chips()).toHaveLength(1)
  })

  it('is still exactly one under reduced motion', async () => {
    mockReduced = true
    mockApi(rows, AWARD)
    renderApp()
    await screen.findByRole('group', { name: `${START} bubbles` })

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: /Mark baby spinach as used up/i }))

    expect(await screen.findByTestId('bubbles-counter-rise')).toHaveTextContent(`+${AWARD}`)
    expect(screen.queryByTestId('bubble-pop')).toBeNull()
    expect(chips()).toHaveLength(1)
  })

  it('is one chip for a bulk "Used up", with the combined award', async () => {
    mockApi(rows, AWARD)
    renderApp()
    await screen.findByRole('group', { name: `${START} bubbles` })

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }))
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Baby spinach/i }))
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Carrots/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Used up' }))

    expect(await screen.findByTestId('bubbles-counter-rise')).toHaveTextContent(`+${AWARD * 2}`)
    expect(chips()).toHaveLength(1)
  })

  it('shows nothing when the use-up earns nothing', async () => {
    mockApi(rows, 0)
    renderApp()
    await screen.findByRole('group', { name: `${START} bubbles` })

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: /Mark baby spinach as used up/i }))
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: /^Baby spinach/i })).not.toBeInTheDocument())
    // Give the write and the balance refetch time to land; no chip must appear.
    await new Promise((r) => setTimeout(r, 250))
    expect(chips()).toHaveLength(0)
  })
})
