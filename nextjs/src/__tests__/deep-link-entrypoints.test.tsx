/**
 * The two surfaces that hand off into the seeded chat:
 *  - the dashboard hero CTA and tip card (#138 scope 1, #143)
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
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('dashboard hero CTA (#138)', () => {
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

  it('deep-links the urgent item into a seeded chat, name verbatim', async () => {
    render(<HeroHome displayName="ayush" />)

    const cta = await screen.findByRole('link', { name: /find a recipe/i })
    const params = hrefParams(cta)
    expect(cta.getAttribute('href')).toMatch(/^\/chat\?/)
    expect(params.get('use')).toBe('large free-range eggs')
    expect(params.get('expires')).toBe('2026-07-29')
  })
})

describe('dashboard hero ignores already-expired items', () => {
  // days_until_expiry is negative once an item is past its date. The urgent-item
  // window was written as an unbounded `<= 1`, so expired stock matched it and —
  // because the copy only special-cases 0 — got announced as "expires tomorrow".
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
    render(<HeroHome displayName="ayush" />)

    await waitFor(() =>
      expect(screen.queryByText(/your pantry is empty/i)).not.toBeInTheDocument()
    )
    expect(screen.queryByText(/fresh basil expires (today|tomorrow)/i)).not.toBeInTheDocument()
  })

  it('does not count an expired item toward the expiring total', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() => expect(screen.getByText(/items? in pantry/i)).toBeInTheDocument())
    expect(screen.queryByText(/expiring/i)).not.toBeInTheDocument()
  })
})

describe('dashboard tip card (#143)', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
  })

  it('carries the tip the user is actually looking at', async () => {
    render(<HeroHome displayName="ayush" />)

    // The tip is corrected after hydration (#135's neutral-render convention),
    // so read the rendered copy rather than assuming a fixed index.
    // The accessible name is an explicit aria-label ("Ask Bubbles about today's
    // tip: …") rather than the raw tip text, so screen-reader users are told
    // what activating the card actually does.
    const tipLink = screen.getByRole('link', { name: /Ask Bubbles about today's tip/i })
    await waitFor(() => expect(hrefParams(tipLink).get('tip')).toBeTruthy())

    const rendered = (tipLink.textContent ?? '').split('Tip:')[1]?.trim()
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
