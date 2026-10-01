/**
 * Issue #807 — the bubble-pop reaction fires on a use-up award, end to end.
 *
 * The Goal 3 demo saw the balance go 1,312 -> 1,320 after "Mark baby spinach as
 * used up" but caught no `bubble-pop` element in a 2.4s window. `bubble-pop.test`
 * proves BubblePop reacts to a balance change in isolation; this proves the
 * whole chain on the real home: the storage sheet's Used up action -> the
 * resolve endpoint (which awards) -> the bubbles balance refetch -> the
 * app-level pop. A break anywhere along it (the resolve path stops
 * invalidating `['bubbles']`, BubblePop stops reading the shared cache) fails
 * here, which the isolated test cannot see.
 *
 * Only the network and the router are faked; HeroHome, the storage sheet,
 * react-query and BubblePop are the real ones, sharing one QueryClient exactly
 * as `Providers` does. `framer-motion` is real too, except that the reduced
 * motion switch is controllable and the pop's `animate` prop is surfaced as a
 * data attribute so the reduced form can be asserted (opacity only, no rise).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import BubblePop from '@/components/ui/BubblePop'

let mockReduced = false
jest.mock('framer-motion', () => {
  const actual = jest.requireActual('framer-motion')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest.mock factory can't use the module-scope import
  const ReactLib = require('react') as typeof import('react')
  const cache = new Map<string, unknown>()
  // Same behaviour as the real `motion.span`, plus the `animate` prop mirrored
  // onto a data attribute for the one element under test.
  const motion = new Proxy(actual.motion, {
    get(target, tag: string) {
      const Real = target[tag]
      if (tag !== 'span') return Real
      if (!cache.has(tag)) {
        const Wrapped = ReactLib.forwardRef<HTMLSpanElement, Record<string, unknown>>(
          function WrappedSpan(props, ref) {
            const animate = props.animate
            return ReactLib.createElement(Real, {
              ...props,
              ref,
              ...(typeof animate === 'object' && animate !== null
                ? { 'data-animate': JSON.stringify(animate) }
                : {}),
            })
          },
        )
        cache.set(tag, Wrapped)
      }
      return cache.get(tag)
    },
  })
  return { ...actual, motion, useReducedMotion: () => mockReduced }
})

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

/** HeroHome and the app-level BubblePop on one QueryClient, as `Providers` mounts them. */
function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
      <BubblePop />
    </QueryClientProvider>,
  )
}

async function openList() {
  fireEvent.click(await screen.findByRole('button', { name: /^Fridge, 2 items/ }))
  const sheet = await screen.findByTestId('storage-sheet')
  fireEvent.click(within(sheet).getByRole('button', { name: 'List' }))
  return sheet
}

const originalFetch = global.fetch
let rows: Row[]
beforeEach(() => {
  mockReduced = false
  rows = seed()
})
afterEach(() => {
  global.fetch = originalFetch
})

describe('bubble pop on a use-up award (#807)', () => {
  it('pops "+8" after "Mark baby spinach as used up" awards 8 bubbles', async () => {
    mockApi(rows, AWARD)
    renderApp()
    // The starting balance has to be known first: the very first observation is
    // an initial load, never a pop.
    await screen.findByRole('group', { name: `${START} bubbles` })
    expect(screen.queryByTestId('bubble-pop')).toBeNull()

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: /Mark baby spinach as used up/i }))

    const pop = await screen.findByTestId('bubble-pop')
    expect(pop).toHaveTextContent(`+${AWARD}`)
    // Full motion: it rises as well as fades.
    expect(JSON.parse(pop.getAttribute('data-animate') ?? '{}')).toHaveProperty('y', -40)
  })

  it('gets its reduced form under reduced motion: still pops, fades in place, no rise', async () => {
    mockReduced = true
    mockApi(rows, AWARD)
    renderApp()
    await screen.findByRole('group', { name: `${START} bubbles` })

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: /Mark baby spinach as used up/i }))

    const pop = await screen.findByTestId('bubble-pop')
    expect(pop).toHaveTextContent(`+${AWARD}`)
    const animate = JSON.parse(pop.getAttribute('data-animate') ?? '{}')
    expect(animate).toHaveProperty('opacity')
    expect(animate).not.toHaveProperty('y')
  })

  it('pops once for a bulk "Used up", with the combined award', async () => {
    mockApi(rows, AWARD)
    renderApp()
    await screen.findByRole('group', { name: `${START} bubbles` })

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Select' }))
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Baby spinach/i }))
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Carrots/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Used up' }))

    const pop = await screen.findByTestId('bubble-pop')
    expect(pop).toHaveTextContent(`+${AWARD * 2}`)
  })

  it('does not pop when the use-up earns nothing', async () => {
    mockApi(rows, 0)
    renderApp()
    await screen.findByRole('group', { name: `${START} bubbles` })

    const sheet = await openList()
    fireEvent.click(within(sheet).getByRole('button', { name: /Mark baby spinach as used up/i }))
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: /^Baby spinach/i })).not.toBeInTheDocument())
    // Give the balance refetch time to land; the pop must still not appear.
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.queryByTestId('bubble-pop')).toBeNull()
  })
})
