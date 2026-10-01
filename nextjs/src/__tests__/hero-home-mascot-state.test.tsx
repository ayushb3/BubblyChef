/**
 * Bubbles' face on the home card (issues #525, #593, #755): worried (unused
 * expired food) beats surprised (food expiring today or tomorrow), which beats the
 * card's own mood: thinking at a mealtime, happy otherwise. The face matches what
 * the card says, so it is never smiling at "your milk needs using today".
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

interface MockItem {
  id: string
  name: string
  is_expired?: boolean
  quantity?: number
  days_until_expiry?: number | null
  is_expiring_soon?: boolean
  expiry_date?: string | null
}

function mockFetch(allItems: MockItem[], expiringItems: MockItem[] = []) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [] })
    if (url.includes('/api/pantry/expiring')) {
      return jsonResponse({ items: expiringItems, count: expiringItems.length })
    }
    if (url.includes('/api/pantry')) {
      return jsonResponse({ items: allItems, total_count: allItems.length })
    }
    if (url.includes('/api/ai/dashboard/daily')) {
      return jsonResponse({
        tip: { text: 'Taste as you cook.', category: 'technique' },
        suggestion: null,
        generated_at: '2026-09-20T08:00:00Z',
        source: 'ai',
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
}

function renderHero(props: Partial<React.ComponentProps<typeof HeroHome>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" {...props} />
    </QueryClientProvider>,
  )
}

/** Only `Date` is faked, so React Query and waitFor keep their timers. */
function fixClock(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
      'clearImmediate', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
      'nextTick', 'performance', 'hrtime', 'requestIdleCallback', 'cancelIdleCallback',
    ],
  })
}

const originalFetch = global.fetch
// 15:30: between lunch and dinner, so a card with nothing urgent is the quiet moment.
beforeEach(() => {
  window.localStorage.clear()
  fixClock('2026-09-23T15:30:00')
})
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('Bubbles card mood (#525, #593)', () => {
  it('shows worried when the pantry has unused expired food', async () => {
    mockFetch([
      { id: 'p1', name: 'milk', is_expired: true, quantity: 1 },
    ])
    renderHero()

    const img = await screen.findByAltText('Bubbles worried')
    expect(img).toBeInTheDocument()
  })

  it('does not go worried when an expired item has been used up (quantity 0)', async () => {
    mockFetch([
      { id: 'p1', name: 'milk', is_expired: true, quantity: 0 },
    ])
    renderHero()

    const img = await screen.findByAltText('Bubbles happy')
    expect(img).toBeInTheDocument()
  })

  it('falls back to surprised for an urgent expiring item when nothing is expired', async () => {
    mockFetch(
      [{ id: 'p1', name: 'eggs', is_expired: false, quantity: 3 }],
      [
        {
          id: 'p1',
          name: 'eggs',
          days_until_expiry: 0,
          is_expiring_soon: true,
          expiry_date: '2026-09-23',
        },
      ],
    )
    renderHero()

    const img = await screen.findByAltText('Bubbles surprised')
    expect(img).toBeInTheDocument()
  })

  it('worried takes priority over surprised when both conditions are true', async () => {
    mockFetch(
      [
        { id: 'p1', name: 'milk', is_expired: true, quantity: 1 },
        { id: 'p2', name: 'eggs', is_expired: false, quantity: 3 },
      ],
      [
        {
          id: 'p2',
          name: 'eggs',
          days_until_expiry: 0,
          is_expiring_soon: true,
          expiry_date: '2026-09-23',
        },
      ],
    )
    renderHero()

    const img = await screen.findByAltText('Bubbles worried')
    expect(img).toBeInTheDocument()
  })

  it('shows happy when the pantry is empty and nothing is expired or urgent', async () => {
    mockFetch([])
    renderHero()

    const img = await screen.findByAltText('Bubbles happy')
    expect(img).toBeInTheDocument()
  })

  it('is not surprised by expiring food when expiry priority is Off', async () => {
    mockFetch(
      [{ id: 'p1', name: 'eggs', is_expired: false, quantity: 3 }],
      [{ id: 'p1', name: 'eggs', days_until_expiry: 0, is_expiring_soon: true, expiry_date: '2026-09-23' }],
    )
    renderHero({ initialExpiryPriority: 'off' })

    expect(await screen.findByAltText('Bubbles happy')).toBeInTheDocument()
    expect(screen.queryByAltText('Bubbles surprised')).not.toBeInTheDocument()
  })

  it('is thinking at a mealtime with nothing urgent', async () => {
    fixClock('2026-09-23T18:30:00')
    mockFetch([{ id: 'p1', name: 'eggs', is_expired: false, quantity: 3 }])
    renderHero()

    expect(await screen.findByAltText('Bubbles thinking')).toBeInTheDocument()
  })
})
