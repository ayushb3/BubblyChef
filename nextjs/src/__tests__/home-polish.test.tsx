/**
 * Regression tests for #391 (home screen visual polish):
 *  1. (The quick-action cards' line icons: the cards went in #748.)
 *  2. The daily tip is no longer silently clamped: when the text overflows two
 *     lines a "Read more" toggle appears, and the seeded-chat deep link moved
 *     to its own "Ask Bubbles" pill so expanding and asking are two distinct
 *     taps. The full tip text stays in the DOM either way, so the screen-reader
 *     path is unchanged.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

/** The tip `<p>` — `getByText(/^Tip:/)` would match the inner `<strong>`. */
function tipParagraph(): HTMLElement {
  const el = document.getElementById('home-tip-text')
  if (!el) throw new Error('tip paragraph not rendered')
  return el
}

/** jsdom has no layout, so overflow is simulated by stubbing the box metrics. */
function stubOverflow(overflows: boolean) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return overflows ? 60 : 30 },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return 30 },
  })
}

const originalFetch = global.fetch
const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

afterEach(() => {
  global.fetch = originalFetch
  if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
  if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
  jest.restoreAllMocks()
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

describe('daily tip expand/collapse (#391)', () => {
  it('shows no "Read more" control when the tip fits in two lines', async () => {
    stubOverflow(false)
    mockFetch('Taste as you cook.')
    renderHero()

    await screen.findByText(/^Tip:/)
    expect(screen.queryByRole('button', { name: /read more/i })).toBeNull()
    expect(tipParagraph()).toHaveClass('line-clamp-2')
  })

  it('offers "Read more" when the tip overflows, and expanding removes the clamp', async () => {
    stubOverflow(true)
    mockFetch(LONG_TIP)
    renderHero()

    await screen.findByText(/^Tip:/)
    const tipText = tipParagraph()
    // Full text is in the DOM even while clamped — the clamp is CSS-only.
    expect(tipText.textContent).toContain('before the sauce goes on.')
    expect(tipText).toHaveClass('line-clamp-2')

    const toggle = await screen.findByRole('button', { name: /read more/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', tipText.id)

    fireEvent.click(toggle)

    await waitFor(() => expect(tipText).not.toHaveClass('line-clamp-2'))
    const collapse = screen.getByRole('button', { name: /show less/i })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapse)
    await waitFor(() => expect(tipText).toHaveClass('line-clamp-2'))
  })

  it('keeps the seeded-chat deep link as its own "Ask Bubbles" pill, labelled with the full tip', async () => {
    stubOverflow(true)
    mockFetch(LONG_TIP)
    renderHero()

    const ask = await screen.findByRole('link', { name: /Ask Bubbles about today's tip/i })
    expect(ask.getAttribute('aria-label')).toBe(`Ask Bubbles about today's tip: ${LONG_TIP}`)
    expect(ask.getAttribute('href')).toBe(`/chat?${new URLSearchParams({ tip: LONG_TIP })}`)

    // The tip text itself is not inside the link: expanding is a separate tap.
    expect(ask.textContent).not.toContain('Tip:')
    const toggle = await screen.findByRole('button', { name: /read more/i })
    expect(ask.contains(toggle)).toBe(false)
  })
})
