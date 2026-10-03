/**
 * The Bubbles card must follow the pantry (issue #916). After first-run setup (or
 * any add) the home used to keep saying "Your kitchen's empty": the home reads the
 * pantry into its own state, and the card latched the empty prompt for the visit.
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import { notifyPantryChanged } from '@/lib/pantry-changed'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

let pantryEmpty = true
const originalFetch = global.fetch
beforeEach(() => {
  pantryEmpty = true
  window.localStorage.clear()
  window.sessionStorage.clear()
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/kitchen/offer')) return jsonResponse(null)
    if (url.includes('/api/chat/starter-context')) {
      return jsonResponse({
        expiring: [],
        pantry_count: 0,
        recent_cooks: [],
        recent_cuisines: [],
        default_servings: 2,
      })
    }
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) {
      return pantryEmpty
        ? jsonResponse({ items: [], total_count: 0 })
        : jsonResponse({ items: [{ id: 'p1', name: 'rice', quantity: 1 }], total_count: 1 })
    }
    if (url.includes('/api/ai/dashboard/daily')) {
      return jsonResponse({ tip: { text: 'Salt the pasta water.', category: 'technique' }, suggestion: null })
    }
    return jsonResponse({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
})
afterEach(() => {
  global.fetch = originalFetch
})

it('stops saying the kitchen is empty once the pantry has something in it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )

  const first = await screen.findByTestId('bubbles-card')
  expect(first).toHaveAttribute('data-card-kind', 'empty')

  // First-run setup stocks the kitchen, then announces it.
  pantryEmpty = false
  await act(async () => {
    notifyPantryChanged(client)
  })

  await waitFor(() =>
    expect(screen.getByTestId('bubbles-card')).not.toHaveAttribute('data-card-kind', 'empty'),
  )
  expect(screen.getByTestId('bubbles-card-message').textContent).not.toMatch(/empty/i)
})
