/**
 * Issue #843 — one "+N" per award, and never none. After a put-away the home
 * showed two: the global `BubblePop` and the header counter's own tag. While the
 * counter is on screen its tag is the reaction and `BubblePop` stays quiet; with
 * the home scrolled so the header is out of view (the header is not sticky), or on
 * any other page, `BubblePop` shows.
 *
 * jsdom has no layout, so "on screen" is driven through a mocked
 * IntersectionObserver (and, for the no-observer fallback, a mocked rectangle).
 * The real browser case is `e2e/pixel-sheet-scroll.spec.ts`'s sibling,
 * `e2e/bubble-award-scrolled.spec.ts`.
 *
 * Both reactions are driven off the shared `['bubbles']` query, as in the app,
 * with the real `HeroHome` for the home cases.
 */
import React, { useRef } from 'react'
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

/** A controllable IntersectionObserver: tests say how much of each target is on screen. */
class MockIntersectionObserver {
  static instances = new Set<MockIntersectionObserver>()
  private target: Element | null = null
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(el: Element) {
    this.target = el
    MockIntersectionObserver.instances.add(this)
  }
  unobserve() {}
  disconnect() {
    MockIntersectionObserver.instances.delete(this)
  }
  takeRecords() {
    return []
  }
  report(ratio: number) {
    this.callback(
      [
        {
          target: this.target as Element,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    )
  }
  static setOnScreen(ratio: number) {
    act(() => {
      MockIntersectionObserver.instances.forEach((o) => o.report(ratio))
    })
  }
}

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
const originalIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
beforeEach(() => {
  balance = 100
  mockPathname = '/'
  MockIntersectionObserver.instances.clear()
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = MockIntersectionObserver
  mockApi()
})
afterEach(() => {
  global.fetch = originalFetch
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIO
})

/** Every "+N" award chip in the DOM: the global pop plus the counter's own tag. */
function awardChips() {
  return [
    ...screen.queryAllByTestId('bubble-pop'),
    ...screen.queryAllByTestId('bubbles-counter-rise'),
  ].filter((el) => /\+\d/.test(el.textContent ?? ''))
}

async function award(client: QueryClient, to: number) {
  balance = to
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['bubbles'] })
  })
}

async function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
      <BubblePop />
    </QueryClientProvider>,
  )
  await screen.findByRole('group', { name: '100 bubbles' })
  return client
}

describe('one +N per award, never none (#843)', () => {
  it('on the kitchen home with the counter on screen, an award renders exactly one +N: the counter tag', async () => {
    const client = await renderHome()
    MockIntersectionObserver.setOnScreen(1)

    await award(client, 112)

    await waitFor(() => expect(screen.getByTestId('bubbles-counter-rise')).toHaveTextContent('+12'))
    expect(screen.queryByTestId('bubble-pop')).not.toBeInTheDocument()
    expect(awardChips()).toHaveLength(1)
  })

  it('with the home scrolled past its header, BubblePop shows so the award is not invisible', async () => {
    const client = await renderHome()
    MockIntersectionObserver.setOnScreen(0)

    await award(client, 112)

    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toHaveTextContent('+12'))
  })

  it('a counter only just peeking in (under half visible) does not claim the award', async () => {
    const client = await renderHome()
    MockIntersectionObserver.setOnScreen(0.3)

    await award(client, 112)

    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toBeInTheDocument())
  })

  it('follows the scroll: out of view then back in view', async () => {
    const client = await renderHome()
    MockIntersectionObserver.setOnScreen(0)
    await award(client, 105)
    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toHaveTextContent('+5'))

    // Wait the pop out, scroll the counter back into view, award again.
    await waitFor(() => expect(screen.queryByTestId('bubble-pop')).not.toBeInTheDocument(), {
      timeout: 3000,
    })
    MockIntersectionObserver.setOnScreen(1)
    await award(client, 117)
    await waitFor(() => expect(screen.getByTestId('bubbles-counter-rise')).toHaveTextContent('+12'))
    expect(screen.queryByTestId('bubble-pop')).not.toBeInTheDocument()
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

    await award(client, 112)
    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toHaveTextContent('+12'))
    expect(awardChips()).toHaveLength(1)
  })

  describe('without IntersectionObserver the counter\'s rectangle is checked at the award', () => {
    const rectOf = (top: number, bottom: number) =>
      jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const real = this.getAttribute('data-testid') === 'kitchen-bubbles-balance-group'
        return (real
          ? { top, bottom, left: 300, right: 376, width: 76, height: 44 }
          : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect
      })

    beforeEach(() => {
      ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined
    })
    afterEach(() => jest.restoreAllMocks())

    it('in view: BubblePop is quiet', async () => {
      rectOf(10, 54)
      const client = await renderHome()
      await award(client, 112)
      await waitFor(() => expect(screen.getByTestId('bubbles-counter-rise')).toBeInTheDocument())
      expect(screen.queryByTestId('bubble-pop')).not.toBeInTheDocument()
    })

    it('scrolled out of view: BubblePop shows', async () => {
      rectOf(-90, -46)
      const client = await renderHome()
      await award(client, 112)
      await waitFor(() => expect(screen.getByTestId('bubble-pop')).toHaveTextContent('+12'))
    })
  })

  it('a counter that is gone releases its claim', async () => {
    function Claimer({ show }: { show: boolean }) {
      const ref = useRef<HTMLDivElement>(null)
      useClaimBubbleReaction(ref, show)
      return <div ref={ref} />
    }
    mockPathname = '/chat'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (show: boolean) => (
      <QueryClientProvider client={client}>
        <Claimer show={show} />
        <BubblePop />
      </QueryClientProvider>
    )
    const view = render(tree(true))
    await waitFor(() => expect(client.getQueryData(['bubbles'])).toBeDefined())
    MockIntersectionObserver.setOnScreen(1)

    await award(client, 105)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByTestId('bubble-pop')).not.toBeInTheDocument()

    view.rerender(tree(false))
    expect(MockIntersectionObserver.instances.size).toBe(0)
    await award(client, 110)
    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toHaveTextContent('+5'))
  })
})
