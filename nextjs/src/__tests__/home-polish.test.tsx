/**
 * Regression tests for #391 (home screen visual polish):
 *  1. (The quick-action cards' line icons: the cards went in #748.)
 *  2. The daily tip is never silently clamped. It used to be a two-line clamp
 *     with a "Read more" toggle; on the Bubbles card (#755) the tip is the quiet
 *     moment's one line of copy and simply wraps, in full.
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

const LONG_TIP =
  'Salt your pasta water generously — it should taste like the sea — because it is the only chance the pasta itself has to pick up seasoning before the sauce goes on.'

function mockFetch(tipText: string) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [] })
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) return jsonResponse({ items: [{ id: 'p1', name: 'eggs' }], total_count: 1 })
    if (url.includes('/api/ai/dashboard/daily')) {
      return jsonResponse({
        tip: { text: tipText, category: 'technique' },
        suggestion: null,
        generated_at: '2026-09-20T08:00:00Z',
        source: 'ai',
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
}

// HeroHome's kitchen scene (#521) reads useDecorations() and useBubbles(),
// which need a QueryClient in context.
function renderHero() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )
}

const originalFetch = global.fetch
beforeEach(() => {
  window.localStorage.clear()
  // 15:30 on an even day of the year: between meals, so the card is the daily tip.
  jest.useFakeTimers({
    now: new Date('2026-10-01T15:30:00'),
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
      'clearImmediate', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
      'nextTick', 'performance', 'hrtime', 'requestIdleCallback', 'cancelIdleCallback',
    ],
  })
})

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

// The three line-icon quick-action cards (#391) went with the old dashboard when
// home became the kitchen wall (#748), so their two tests went with them. The
// Plan dinner entry point lives on as the chalkboard (kitchen-wall.test.tsx).
describe('quick-action row is gone from the kitchen home (#748)', () => {
  beforeEach(() => mockFetch('Taste as you cook.'))

  it('renders no quick-action cards', async () => {
    renderHero()
    await screen.findByText(/^Tip:/)

    expect(screen.queryByRole('link', { name: /use soon/i })).toBeNull()
    expect(document.querySelector('[data-tour="quick-actions"]')).toBeNull()
  })
})

describe('the daily tip on the Bubbles card (#391, #755)', () => {
  it('shows the whole tip: the card wraps it, nothing is clamped or hidden', async () => {
    mockFetch(LONG_TIP)
    renderHero()

    const message = await screen.findByTestId('bubbles-card-message')
    expect(message).toHaveTextContent(`Tip: ${LONG_TIP}`)
    expect(message.className).not.toMatch(/line-clamp/)
    expect(screen.queryByRole('button', { name: /read more/i })).toBeNull()
  })

  it('"Show me how" seeds the chat with the full tip the card is showing', async () => {
    mockFetch(LONG_TIP)
    renderHero()

    const how = await screen.findByRole('link', { name: 'Show me how' })
    expect(how.getAttribute('href')).toBe(`/chat?${new URLSearchParams({ tip: LONG_TIP })}`)
  })
})
