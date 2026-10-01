/**
 * Issue #843 — one "+N" per award. After a put-away the home showed two: the
 * global `BubblePop` and the header counter's own tag. On the kitchen home the
 * counter's tag is the reaction and `BubblePop` stays quiet while the counter is
 * visible; every other page keeps `BubblePop`.
 *
 * Both are driven off the shared `['bubbles']` query, as in the app. The real
 * `HeroHome` is mounted for the home case, with a put-away award (a bulk add that
 * raises the balance) as the trigger.
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import BubblePop from '@/components/ui/BubblePop'
import { useClaimBubbleReaction } from '@/lib/bubble-reaction'

let mockPathname = '/'
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => mockPathname,
}))

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

let balance = 100
function mockApi() {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return json({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return json({ balance, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return json({ items: [], count: 0 })
    if (url.includes('/api/pantry')) return json({ items: [], total_count: 0 })
    return json({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

const originalFetch = global.fetch
beforeEach(() => {
  balance = 100
  mockPathname = '/'
  mockApi()
})
afterEach(() => {
  global.fetch = originalFetch
})

/** Every "+N" award chip on screen: the global pop plus the counter's own tag. */
function awardChips() {
  return [
    ...screen.queryAllByTestId('bubble-pop'),
    ...screen.queryAllByTestId('bubbles-counter-rise'),
  ].filter((el) => /\+\d/.test(el.textContent ?? ''))
}

function Claimer({ active = true }: { active?: boolean }) {
  useClaimBubbleReaction(active)
  return null
}

describe('one +N per award (#843)', () => {
  it('on the kitchen home, an award renders exactly one +N: the counter tag', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <HeroHome displayName="ayush" />
        <BubblePop />
      </QueryClientProvider>,
    )
    await screen.findByRole('group', { name: '100 bubbles' })

    // A put-away award: the balance rises and every watcher of the cache refetches.
    balance = 112
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['bubbles'] })
    })

    await waitFor(() => expect(screen.getByTestId('bubbles-counter-rise')).toHaveTextContent('+12'))
    expect(screen.queryByTestId('bubble-pop')).not.toBeInTheDocument()
    expect(awardChips()).toHaveLength(1)
  })

  it('anywhere else, BubblePop is still the reaction', async () => {
    mockPathname = '/chat'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <BubblePop />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(client.getQueryData(['bubbles'])).toBeDefined())

    balance = 112
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['bubbles'] })
    })
    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toHaveTextContent('+12'))
    expect(awardChips()).toHaveLength(1)
  })

  it('BubblePop is quiet only while a counter holds the claim, and works again once it is gone', async () => {
    mockPathname = '/chat'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (claimed: boolean) => (
      <QueryClientProvider client={client}>
        {claimed && <Claimer />}
        <BubblePop />
      </QueryClientProvider>
    )
    const view = render(tree(true))
    await waitFor(() => expect(client.getQueryData(['bubbles'])).toBeDefined())

    balance = 105
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['bubbles'] })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByTestId('bubble-pop')).not.toBeInTheDocument()

    // The counter leaves (navigated away from home): the next award pops again.
    view.rerender(tree(false))
    balance = 110
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['bubbles'] })
    })
    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toHaveTextContent('+5'))
  })
})
