/**
 * Issue #139 — the "Use Soon" triage view at `/pantry/use-soon`.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UseSoonPage from '@/app/pantry/use-soon/page'
import { resolvePantryItem } from '@/lib/api/pantry'

jest.mock('@/lib/api/pantry', () => ({
  resolvePantryItem: jest.fn(),
}))

const mockResolve = resolvePantryItem as jest.Mock

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

/** Query string of an anchor, parsed. */
function hrefParams(el: HTMLElement): URLSearchParams {
  const href = el.getAttribute('href') ?? ''
  return new URLSearchParams(href.slice(href.indexOf('?') + 1))
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <UseSoonPage />
    </QueryClientProvider>,
  )
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  mockResolve.mockReset()
})

describe('Use Soon triage view (#139)', () => {
  const items = [
    // Intentionally out of urgency order in the API response — the page must sort.
    { id: 'b', name: 'rice', category: 'dry_goods', quantity: 1, unit: 'kg', expiry_date: '2026-08-01', days_until_expiry: 4, is_expired: false, is_expiring_soon: false },
    { id: 'a', name: 'large free-range eggs', category: 'dairy', quantity: 6, unit: 'count', expiry_date: '2026-07-25', days_until_expiry: -3, is_expired: true, is_expiring_soon: false },
    { id: 'c', name: 'spinach', category: 'produce', quantity: 1, unit: 'bag', expiry_date: '2026-07-29', days_until_expiry: 1, is_expired: false, is_expiring_soon: true },
  ]

  it('sorts by days_until_expiry ascending — expired first, then soonest', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ items })) as unknown as typeof fetch
    renderPage()

    await screen.findByText('Large Free-range Eggs')

    const rendered = screen.getAllByText(/^(Large Free-range Eggs|Spinach|Rice)$/)
    expect(rendered.map((el) => el.textContent)).toEqual(['Large Free-range Eggs', 'Spinach', 'Rice'])
  })

  it('carries the raw (non-title-cased) item name in the "Find a recipe" href', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ items })) as unknown as typeof fetch
    renderPage()

    const link = await screen.findByRole('link', { name: /find a recipe for large free-range eggs/i })
    const params = hrefParams(link)
    expect(params.get('use')).toBe('large free-range eggs')
    expect(params.get('expires')).toBe('2026-07-25')
  })

  it('renders the kawaii empty state when nothing is expiring', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ items: [] })) as unknown as typeof fetch
    renderPage()

    expect(await screen.findByText(/nothing's about to expire/i)).toBeInTheDocument()
  })

  it('removes a row once it is resolved', async () => {
    // First fetch (mount) returns the full list; every fetch after that
    // (i.e. the refetch the resolve's invalidation triggers) returns the
    // item already gone. A call counter — rather than swapping the mock or a
    // timed reassignment — sidesteps any race against exactly when React
    // Query's refetch actually fires relative to the resolve promise settling.
    let calls = 0
    global.fetch = jest.fn(async () => {
      calls += 1
      return jsonResponse({ items: calls === 1 ? items : items.filter((i) => i.id !== 'a') })
    }) as unknown as typeof fetch
    mockResolve.mockResolvedValue({ resolved: true, id: 'a', outcome: 'used', event_id: 'e1' })

    renderPage()

    await screen.findByText('Large Free-range Eggs')

    const usedButton = screen.getByRole('button', { name: /mark large free-range eggs used up/i })
    fireEvent.click(usedButton)

    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('a', 'used'))
    await waitFor(() => expect(screen.queryByText('Large Free-range Eggs')).toBeNull())
  })

  it('reaches the client function with both outcomes', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ items })) as unknown as typeof fetch
    mockResolve.mockResolvedValue({ resolved: true, id: 'c', outcome: 'tossed', event_id: 'e2' })

    renderPage()

    await screen.findByText('Spinach')

    fireEvent.click(screen.getByRole('button', { name: /toss spinach/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, toss it/i }))

    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('c', 'tossed'))
  })
})
