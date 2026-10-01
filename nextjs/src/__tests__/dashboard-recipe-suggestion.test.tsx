/**
 * The home's daily suggestion and tip (issues #225, #168, #306, #347), after the
 * Bubbles card (issue #755).
 *
 * `GET /v1/dashboard/daily` still returns a tip and a recipe suggestion. Home now
 * uses only the tip, for the card's quiet moment. The suggestion card is dropped
 * (issue #554 and #593: it never named the dish, ran long, and always led with a
 * recipe whatever the mood): cases 3 and 4 of the card replace it, so a
 * suggestion in the response must never reach the screen, nor outrank food that is
 * about to expire. The tip falls back to the card's own list when the request
 * fails.
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
  // 15:30 on an even day of the year: between meals, so the card is the tip.
  // Only `Date` is faked, so React Query and waitFor keep their timers.
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

const SUGGESTION = {
  recipe_id: 'recipe-abc-123',
  title: 'Lemon Garlic Pasta',
  total_time_minutes: 25,
  copy: 'Your lemon is about to turn — this pasta uses it up fast.',
  reason: 'expiring' as const,
}

function mockDaily(opts: {
  daily: Response | 'fail'
  expiring?: Array<Record<string, unknown>>
}) {
  const expiring = opts.expiring ?? []
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: expiring, count: expiring.length })
    if (url.includes('/api/pantry')) {
      return jsonResponse({ items: [{ id: 'p1', name: 'eggs' }, ...expiring], total_count: 1 + expiring.length })
    }
    if (url.includes('/api/ai/dashboard/daily')) {
      return opts.daily === 'fail' ? jsonResponse({ error: 'AI service unreachable' }, false) : opts.daily
    }
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    return jsonResponse({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

const daily = (tip: string, suggestion: unknown = SUGGESTION) =>
  jsonResponse({
    tip: { text: tip, category: 'technique' },
    suggestion,
    generated_at: '2026-10-01T08:00:00Z',
    source: 'ai',
  })

describe('the old suggestion card is gone (#554, #593)', () => {
  it('a suggestion in the response is not rendered: no copy, no "Open recipe"', async () => {
    mockDaily({ daily: daily('Zest citrus before juicing it.') })
    renderHero()

    await screen.findByTestId('bubbles-card')
    expect(screen.queryByText(/uses it up fast/i)).toBeNull()
    expect(screen.queryByText(/Only 25 min/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /open recipe/i })).toBeNull()
    expect(document.querySelector('a[href="/recipes/recipe-abc-123"]')).toBeNull()
  })

  it('expiring food leads, not the suggestion (#347, now the card\'s case 3)', async () => {
    mockDaily({
      daily: daily('Great tip!', { ...SUGGESTION, copy: 'A quick frittata for your spinach.' }),
      expiring: [
        {
          id: 'item-1',
          name: 'spinach',
          days_until_expiry: 0,
          is_expiring_soon: true,
          expiry_date: '2026-10-01',
        },
      ],
    })
    renderHero()

    expect(await screen.findByText(/Your spinach needs using today/)).toBeInTheDocument()
    expect(screen.queryByText(/quick frittata/i)).toBeNull()
    expect(screen.getAllByTestId('bubbles-card')).toHaveLength(1)
  })

  it('no suggestion, no problem', async () => {
    mockDaily({ daily: daily('Taste as you cook.', null) })
    expect(() => renderHero()).not.toThrow()
    expect(await screen.findByTestId('bubbles-card')).toBeInTheDocument()
  })
})

describe('the tip is sourced from the endpoint, not a static array (#225)', () => {
  it('renders the endpoint tip on the quiet-moment card', async () => {
    mockDaily({ daily: daily('This tip only exists on the server, never in the static list.') })
    renderHero()

    expect(
      await screen.findByText(/this tip only exists on the server/i),
    ).toBeInTheDocument()
  })
})

describe('the tip when the dashboard request fails (#225)', () => {
  it('still renders a tip from the fallback list, with no error surfaced', async () => {
    mockDaily({ daily: 'fail' })
    renderHero()

    expect(
      await screen.findByText(
        /season your pan|let meat rest|freeze herbs|toast spices|pasta water|green onions|taste as you cook/i,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/error/i)).toBeNull()
  })
})
