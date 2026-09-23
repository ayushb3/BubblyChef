/**
 * Regression test for #549: the late-night greeting used to read
 * "Late night snack?, Bubbly" — a question mark immediately followed by the
 * comma the render adds before the display name. Asserts against the
 * rendered greeting text rather than re-testing `getGreeting()` directly,
 * since the bug was in the combination of the two.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
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
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
  jest.useRealTimers()
})

beforeEach(() => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) return jsonResponse({ items: [], total_count: 0 })
    return jsonResponse({ recipes: [], total_count: 0, decorations: [], total: 0 })
  }) as unknown as typeof fetch
})

describe('HeroHome late-night greeting (#549)', () => {
  it('never renders a stray comma right after the question mark', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T23:30:00'))

    renderHero()

    await waitFor(() => {
      expect(screen.getByText(/Late night snack/)).toBeInTheDocument()
    })

    expect(screen.queryByText(/snack\?,/)).not.toBeInTheDocument()
  })
})
