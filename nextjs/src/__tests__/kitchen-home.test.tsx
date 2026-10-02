/**
 * The kitchen home (issue #748): header, the pixel wall with real counts, the
 * decorations and the toolbar, composed by `HeroHome`.
 *
 * Replaces `dashboard-greeting.test.tsx` (issue #549's "Late night snack?,"
 * greeting, which went with the old dashboard: the header's eyebrow is
 * "<Weekday> <part of day>" now).
 */
import React from 'react'
import { renderToString } from 'react-dom/server'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import { CATALOG } from '@/lib/kitchen/catalog'

const pushSpy = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: pushSpy, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

interface Mock {
  items?: Array<Record<string, unknown>>
  pantryOk?: boolean
  balance?: number
  streak?: number
  decorations?: Array<{ name: string; decoration_type: string }>
}

function mockFetch({ items = [], pantryOk = true, balance = 0, streak = 0, decorations = [] }: Mock = {}) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations, total: decorations.length })
    if (url.includes('/api/bubbles')) {
      return jsonResponse({ balance, recent: [], streak_weeks: streak })
    }
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) {
      return pantryOk
        ? jsonResponse({ items, total_count: items.length })
        : jsonResponse({ error: 'boom' }, false)
    }
    return jsonResponse({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

function wrap(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

function renderHome() {
  return render(wrap(<HeroHome displayName="ayush" />))
}

const originalFetch = global.fetch
beforeEach(() => pushSpy.mockClear())
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

function row(location: string, extra: Record<string, unknown> = {}) {
  return { id: `${location}-${Math.random()}`, name: 'x', location, quantity: 1, ...extra }
}

describe('kitchen home header (#748)', () => {
  beforeEach(() => mockFetch())

  it('reads "<Weekday> <part of day>" over the title, from the client clock', async () => {
    // 2026-09-23 is a Wednesday.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T23:30:00'))
    renderHome()

    await waitFor(() => expect(screen.getByTestId('kitchen-eyebrow')).toHaveTextContent('Wednesday night'))
    expect(screen.getByRole('heading', { name: 'Your kitchen' })).toBeInTheDocument()
  })

  it('renders a neutral, empty eyebrow on the server pass, so hydration cannot mismatch', () => {
    // Effects do not run in renderToString, so this is exactly the markup the
    // server (and the client's first pass) produces, before the clock is read.
    const html = renderToString(wrap(<HeroHome displayName="ayush" />))
    expect(html).toMatch(/data-testid="kitchen-eyebrow"[^>]*><\/p>/)
    expect(html).not.toMatch(/morning|afternoon|evening|night/i)
  })

  it('no longer greets by name', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Your kitchen' })
    expect(screen.queryByText(/good (morning|afternoon|evening)/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/late night snack/i)).not.toBeInTheDocument()
    expect(screen.queryByText('ayush')).not.toBeInTheDocument()
  })

  // The counter is the scene's top-right HUD since #907 (see kitchen-balance-hud.test.tsx).
  it('shows the pixel bubbles counter once the balance is known, and not before', async () => {
    mockFetch({ balance: 240 })
    renderHome()

    expect(screen.queryByTestId('kitchen-bubbles-balance')).not.toBeInTheDocument()
    const counter = await screen.findByTestId('kitchen-bubbles-balance')
    expect(counter).toHaveAttribute('aria-label', '240 bubbles')
  })

  it('keeps the notification bell and the profile button', async () => {
    renderHome()
    await screen.findByRole('heading', { name: 'Your kitchen' })
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('button', { name: /notification/i })).toBeInTheDocument()
  })
})

describe('kitchen home wall (#748)', () => {
  it('shows real per-place counts and names each place with how many to use soon', async () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const soon = tomorrow.toLocaleDateString('en-CA')
    mockFetch({
      items: [
        row('fridge', { expiry_date: soon }),
        row('fridge'),
        row('fridge'),
        row('freezer'),
        row('pantry'),
        row('pantry'),
        row('pantry'),
        row('pantry'),
        row('counter'),
        // unknown / missing locations land on the Shelves
        row('somewhere-else'),
        { id: 'no-loc', name: 'y', quantity: 1 },
      ],
    })
    renderHome()

    expect(await screen.findByRole('button', { name: 'Fridge, 3 items, 1 to use soon' })).toHaveTextContent(
      'Fridge 3',
    )
    expect(screen.getByRole('button', { name: 'Freezer, 1 item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shelves, 6 items' })).toHaveTextContent('Shelves 6')
    expect(screen.getByRole('button', { name: 'Basket, 1 item' })).toBeInTheDocument()
  })

  it('shows the first-visit kitchen: every place named, none counted (board A5)', async () => {
    mockFetch({ items: [] })
    renderHome()

    const fridge = await screen.findByRole('button', { name: 'Fridge, empty' })
    expect(fridge).toHaveTextContent(/^Fridge$/)
    expect(screen.getByRole('button', { name: 'Freezer, empty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shelves, empty' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Basket, empty' })).toBeInTheDocument()
  })

  it('does not claim empty places when the pantry failed to load', async () => {
    mockFetch({ pantryOk: false })
    renderHome()

    // Wait for the loading state to clear (the Bubbles card's skeleton goes).
    await screen.findByTestId('bubbles-card')
    expect(screen.getByRole('button', { name: 'Fridge' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /empty/ })).not.toBeInTheDocument()
  })

  it('opens the storage sheet on a tapped place, where it was the pantry page before (#749)', async () => {
    mockFetch({ items: [row('fridge')] })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: /^Fridge, 1 item/ }))
    expect(await screen.findByTestId('storage-sheet')).toBeInTheDocument()
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('opens the plan-dinner chat flow from the chalkboard', async () => {
    mockFetch()
    renderHome()
    const link = await screen.findByRole('link', { name: 'Plan dinner' })
    expect(link).toHaveAttribute('href', '/chat?plan=dinner')
  })

  it('draws every unlocked decoration on the wall, in its slot', async () => {
    const picks = [CATALOG[0], CATALOG.find((d) => d.slot === 'rug')!, CATALOG.find((d) => d.slot === 'lights')!]
    mockFetch({ decorations: picks.map((d) => ({ name: d.id, decoration_type: d.slot })) })
    renderHome()

    for (const d of picks) {
      expect(await screen.findByRole('img', { name: d.name })).toBeInTheDocument()
      expect(screen.getByTestId(`kitchen-slot-${d.slot}`).getAttribute('data-filled')).toBe('true')
    }
  })

  it('keeps the old dashboard pieces off the home: no hero mascot, no quick actions', async () => {
    mockFetch({ items: [row('pantry')] })
    const { container } = renderHome()
    await screen.findByRole('button', { name: /^Shelves/ })

    expect(container.querySelector('[data-tour="quick-actions"]')).toBeNull()
    // The one illustrated Bubbles left is the small one on the Bubbles card.
    expect(screen.getAllByAltText(/^Bubbly /)).toHaveLength(1)
  })
})

describe('kitchen home toolbar (#748)', () => {
  it('shows the streak only when there is one', async () => {
    mockFetch({ streak: 3 })
    const first = renderHome()
    expect(await screen.findByTestId('kitchen-streak')).toHaveTextContent('🔥 3')
    first.unmount()

    mockFetch({ streak: 0 })
    renderHome()
    // The counter appears once /api/bubbles (which also carries the streak) answered.
    await screen.findByTestId('kitchen-bubbles-balance')
    expect(screen.queryByTestId('kitchen-streak')).not.toBeInTheDocument()
  })

  it('keeps the theme picker trigger, as a 44px button', async () => {
    mockFetch()
    renderHome()
    const trigger = await screen.findByTestId('kitchen-theme-trigger')
    expect(trigger).toHaveAccessibleName('Change kitchen theme')
    expect(trigger.className).toContain('h-11')
    expect(trigger.className).toContain('w-11')
  })
})
