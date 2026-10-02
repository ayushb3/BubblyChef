/**
 * Issue #907 — the bubbles balance lives in the kitchen scene's top-right corner,
 * a HUD on the pixel wall, not in the page header.
 *
 * jsdom has no layout, so these cover where the counter is in the tree, what it
 * keeps (value, testId, the +N tag on an earn) and that it never takes a tap.
 * Where it sits against each place's tap target at 375 and 412 px is measured in a
 * real browser: `e2e/kitchen-balance-hud.spec.ts`.
 */
import React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import KitchenHeader from '@/components/kitchen/KitchenHeader'
import KitchenScene from '@/components/kitchen/KitchenScene'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

let balance = 240
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
  balance = 240
  mockApi()
})
afterEach(() => {
  global.fetch = originalFetch
})

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )
  return { client, ...view }
}

describe('the balance sits in the kitchen scene (#907)', () => {
  it('is inside the scene, not the header', async () => {
    renderHome()
    const counter = await screen.findByTestId('kitchen-bubbles-balance')

    expect(counter).toHaveAttribute('aria-label', '240 bubbles')
    expect(counter.closest('[data-testid="kitchen-scene"]')).not.toBeNull()
    const header = screen.getByRole('heading', { name: 'Your kitchen' }).closest('header')!
    expect(within(header).queryByTestId('kitchen-bubbles-balance')).not.toBeInTheDocument()
    expect(within(header).queryByTestId('kitchen-bubbles-balance-group')).not.toBeInTheDocument()
  })

  it('is on the wall itself, as a HUD that never takes a tap', async () => {
    renderHome()
    const counter = await screen.findByTestId('kitchen-bubbles-balance')
    const wall = screen.getByTestId('kitchen-wall')

    const hud = counter.closest('[data-testid="kitchen-bubbles-balance-group"]') as HTMLElement
    expect(wall.contains(hud)).toBe(true)
    // Not a button or a link, and the box around it lets taps through to the wall.
    expect(counter.closest('button, a')).toBeNull()
    expect(hud.className).toContain('pointer-events-none')
  })

  it('is not drawn until the balance is known, and the wall is unchanged without it', async () => {
    const { container } = render(<KitchenScene unlocked={[]} onOpenPlace={jest.fn()} balance={null} />)
    expect(screen.queryByTestId('kitchen-bubbles-balance')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="kitchen-bubbles-balance-group"]')).toBeNull()
  })

  it('shows the value it is given', () => {
    render(<KitchenScene unlocked={[]} onOpenPlace={jest.fn()} balance={1240} />)
    expect(screen.getByTestId('kitchen-bubbles-balance')).toHaveAttribute('aria-label', '1240 bubbles')
  })

  it('leaves the header with its other items and no reserved counter slot', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <KitchenHeader eyebrow="Friday night" />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Your kitchen' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /notification/i })).toBeInTheDocument()
    expect(screen.queryByTestId('kitchen-bubbles-balance-group')).not.toBeInTheDocument()
  })

  it('plays the earn +N tag in the scene when the balance rises', async () => {
    const { client } = renderHome()
    await screen.findByRole('group', { name: '240 bubbles' })

    balance = 252
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['bubbles'] })
    })

    const tag = await screen.findByTestId('bubbles-counter-rise')
    expect(tag).toHaveTextContent('+12')
    expect(screen.getByTestId('kitchen-scene').contains(tag)).toBe(true)
    await waitFor(() => expect(screen.getByRole('group', { name: '252 bubbles' })).toBeInTheDocument())
  })

  it('every place and the chalkboard stay real, tappable controls with the counter drawn', async () => {
    renderHome()
    await screen.findByTestId('kitchen-bubbles-balance')
    for (const name of [/^Fridge/, /^Freezer/, /^Shelves/, /^Basket/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Plan dinner' })).toBeInTheDocument()
  })
})
