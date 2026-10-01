/**
 * The two surfaces that hand off into the seeded chat:
 *  - the home Bubbles card's expiring-food and tip answers (#138 scope 1, #143, #755)
 *  - expiring pantry item cards (#138 scope 2)
 *
 * These assert on the *href*, because the href is the whole contract: the chat
 * page's own behaviour is covered in `chat-deep-links.test.tsx`.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/ThemeProvider'
import HeroHome from '@/components/dashboard/HeroHome'
import PantryPage from '@/app/pantry/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

/** Query string of an anchor, parsed. */
function hrefParams(el: HTMLElement): URLSearchParams {
  const href = el.getAttribute('href') ?? ''
  return new URLSearchParams(href.slice(href.indexOf('?') + 1))
}

const originalFetch = global.fetch
beforeEach(() => window.localStorage.clear())
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

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

// HeroHome now also fetches decorations via `useDecorations()` (#521), which
// needs a QueryClient in context — same wrapper `renderPantry()` below uses.
function renderHero() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )
}

describe('home card: food expiring tomorrow (#138, #755)', () => {
  const urgentItem = {
    id: 'p1',
    name: 'large free-range eggs',
    expiry_date: '2026-07-29',
    days_until_expiry: 1,
    is_expiring_soon: true,
  }

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) {
        return jsonResponse({ items: [urgentItem], count: 1 })
      }
      if (url.includes('/api/pantry')) {
        return jsonResponse({ items: [urgentItem], total_count: 1 })
      }
      return jsonResponse({ recipes: [], total_count: 0 })
    }) as unknown as typeof fetch
  })

  it('seeds a plan-dinner chat with the item, name verbatim', async () => {
    renderHero()

    const cta = await screen.findByRole('link', { name: 'Dinner with the large free-range eggs' })
    const params = hrefParams(cta)
    expect(cta.getAttribute('href')).toMatch(/^\/chat\?/)
    expect(params.get('plan')).toBe('dinner')
    expect(params.get('with')).toBe('large free-range eggs')
    expect(screen.getByTestId('bubbles-card-message')).toHaveTextContent(
      'Your large free-range eggs need using by tomorrow.',
    )
  })
})

describe('home card ignores already-expired items', () => {
  // days_until_expiry is negative once an item is past its date. The urgent-item
  // window was written as an unbounded `<= 1`, so expired stock matched it and —
  // because the copy only special-cases 0 — got announced as "expires tomorrow".
  // The Bubbles card's expiring case (#755) keeps the lower bound.
  const expiredItem = {
    id: 'p-expired',
    name: 'fresh basil',
    expiry_date: '2026-07-31',
    days_until_expiry: -5,
    is_expiring_soon: false,
  }

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) {
        return jsonResponse({ items: [expiredItem], count: 1 })
      }
      if (url.includes('/api/pantry')) {
        return jsonResponse({ items: [expiredItem], total_count: 1 })
      }
      return jsonResponse({ recipes: [], total_count: 0 })
    }) as unknown as typeof fetch
  })

  it('does not describe an expired item as expiring today or tomorrow', async () => {
    renderHero()

    await screen.findByTestId('bubbles-card')
    expect(screen.getByTestId('bubbles-card')).not.toHaveAttribute('data-card-kind', 'expiring')
    expect(screen.queryByText(/fresh basil/i)).not.toBeInTheDocument()
  })

  it('does not count an expired item toward the expiring total', async () => {
    renderHero()

    await waitFor(() => expect(screen.getByText(/items? in pantry/i)).toBeInTheDocument())
    expect(screen.queryByText(/expiring/i)).not.toBeInTheDocument()
  })
})

// The Plan dinner card of the old quick-action row (issue #651) became the
// chalkboard on the kitchen wall's door (#748); the other three cards went.
describe('kitchen wall Plan dinner chalkboard (issue #651, #748)', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ items: [], total_count: 0, count: 0 }),
    ) as unknown as typeof fetch
  })

  it('links to the plan-dinner seed, aria-labelled, and the quick-action row is gone', async () => {
    renderHero()

    const planLink = await screen.findByRole('link', { name: 'Plan dinner' })
    expect(planLink.getAttribute('href')).toBe('/chat?plan=dinner')

    expect(screen.queryByRole('link', { name: /use soon/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^scan$/i })).not.toBeInTheDocument()
  })
})

describe('home card: the daily tip (#143, #755)', () => {
  beforeEach(() => {
    // 15:30 on an even day of the year: between meals, so the card is the tip.
    fixClock('2026-10-01T15:30:00')
    // The card skeletons until the fetches resolve rather than rendering a
    // fallback tip immediately, so the mock here must actually resolve for the
    // tip link to ever appear.
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
      if (url.includes('/api/pantry')) return jsonResponse({ items: [], total_count: 0 })
      if (url.includes('/api/ai/dashboard/daily')) {
        return jsonResponse({
          tip: { text: 'Zest citrus before juicing it.', category: 'technique' },
          suggestion: null,
          generated_at: '2026-09-05T08:00:00Z',
          source: 'ai',
        })
      }
      return jsonResponse({ recipes: [], total_count: 0 })
    }) as unknown as typeof fetch
  })

  it('carries the tip the user is actually looking at', async () => {
    renderHero()

    // The accessible name is the key's own label ("Show me how"); the href
    // carries the tip the card is showing, verbatim.
    const tipLink = await screen.findByRole('link', { name: 'Show me how' })
    await waitFor(() => expect(hrefParams(tipLink).get('tip')).toBeTruthy())

    const rendered = (screen.getByTestId('bubbles-card-message').textContent ?? '').replace(/^Tip:\s*/, '')
    expect(rendered).toBe('Zest citrus before juicing it.')
    expect(hrefParams(tipLink).get('tip')).toBe(rendered)
    expect(tipLink.getAttribute('href')).toMatch(/^\/chat\?tip=/)
  })
})

describe('expiring pantry cards (#138)', () => {
  const items = [
    { id: 'a', name: 'spinach', category: 'produce', location: 'fridge', quantity: 1, unit: 'bag', expiry_date: dateIn(1) },
    { id: 'b', name: 'yoghurt', category: 'dairy', location: 'fridge', quantity: 2, unit: 'cup', expiry_date: dateIn(-2) },
    { id: 'c', name: 'rice', category: 'dry_goods', location: 'pantry', quantity: 1, unit: 'kg', expiry_date: dateIn(60) },
  ]

  function dateIn(days: number): string {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }

  function renderPantry() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <PantryPage />
        </QueryClientProvider>
      </ThemeProvider>,
    )
  }

  beforeEach(() => {
    global.fetch = jest.fn(async () => jsonResponse({ items })) as unknown as typeof fetch
  })

  it('offers "Cook this" on expiring items only — not expired, not far-future', async () => {
    renderPantry()

    // Displayed title-cased (#132), but the `use` param below must stay the raw
    // stored name — extraction matches on it.
    await screen.findByText('Spinach')
    const cookLinks = screen.getAllByRole('link', { name: /^Cook this/i })
    const names = cookLinks.map((l) => hrefParams(l).get('use'))

    // spinach (days=1) is urgent — gets "Cook this"
    expect(names).toContain('spinach')
    // yoghurt is already expired (days=-2) — no "Cook this" (#146)
    expect(names).not.toContain('yoghurt')
    // rice is far-future (days=60) — never urgent
    expect(names).not.toContain('rice')
  })

  it('scopes the link to that item, expiry included', async () => {
    renderPantry()

    const link = await screen.findByRole('link', { name: /Cook this spinach/i })
    const params = hrefParams(link)
    expect(link.getAttribute('href')).toMatch(/^\/chat\?/)
    expect(params.get('use')).toBe('spinach')
    expect(params.get('expires')).toBe(dateIn(1))
  })

  it('keeps the card itself an edit target — the link is an extra affordance', async () => {
    renderPantry()

    // The item name still sits inside its own button (opens the edit modal).
    const nameEl = await screen.findByText('Spinach')
    expect(nameEl.closest('button')).not.toBeNull()
    // ...and that button does not nest the link (invalid HTML, dead tap target).
    expect(nameEl.closest('button')?.querySelector('a')).toBeNull()
  })

  // jsdom has no layout engine and no Tailwind at runtime, so these assert on
  // the utility classes that produce the behaviour rather than measured pixels.
  it('gives "Cook this" a 44px tap target (WCAG 2.5.5)', async () => {
    renderPantry()

    const link = await screen.findByRole('link', { name: /Cook this spinach/i })
    expect(link.className).toContain('min-h-[44px]')
  })

  it('gives both card controls a visible focus ring', async () => {
    renderPantry()

    const nameEl = await screen.findByText('Spinach')
    const editButton = nameEl.closest('button')
    const link = screen.getByRole('link', { name: /Cook this spinach/i })

    for (const el of [editButton, link]) {
      expect(el?.className).toMatch(/focus-visible:outline-2/)
      // Inset offset — the card wrapper is overflow-hidden, so an outward ring
      // would be clipped.
      expect(el?.className).toContain('focus-visible:outline-offset-[-2px]')
    }
  })
})
