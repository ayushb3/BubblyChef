/**
 * The pixel Bubbles on the kitchen home (issue #752): where it stands for each
 * state of the kitchen, and that it is decorative to assistive tech.
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

import HeroHome from '@/components/dashboard/HeroHome'
import { SPOT_X } from '@/lib/kitchen/bubbles-spot'
import { startGuidedCookSession, endCookSession } from '@/lib/cook-session'
import { startMealCookSession } from '@/lib/meal-cook-session'
import { addDaysToDateString, localDateString } from '@/lib/date'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function daysFromNow(n: number): string {
  return addDaysToDateString(localDateString(), n)
}

function mockFetch(items: Array<Record<string, unknown>> = []) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) return jsonResponse({ items, total_count: items.length })
    return jsonResponse({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

const fresh = { id: 'a', name: 'rice', location: 'pantry', quantity: 1, expiry_date: '2099-01-01' }
const wilting = () => ({
  id: 'b',
  name: 'spinach',
  location: 'fridge',
  quantity: 1,
  expiry_date: daysFromNow(1),
})

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )
}

const bubbles = () => screen.getByTestId('pixel-bubbles')
const loaded = () => waitFor(() => expect(screen.getByTestId('kitchen-wall')).toBeInTheDocument())

const originalFetch = global.fetch
beforeEach(() => {
  mockReduced = false
  window.localStorage.clear()
})
afterEach(() => {
  global.fetch = originalFetch
  window.localStorage.clear()
})

describe('Bubbles on the kitchen home (#752)', () => {
  it('rests at the stove, with no steam, in an ordinary kitchen', async () => {
    mockFetch([fresh])
    renderHome()
    await loaded()
    await waitFor(() => expect(screen.getByText(/1 item in pantry/)).toBeInTheDocument())
    expect(bubbles()).toHaveAttribute('data-spot', 'stove')
    expect(bubbles()).toHaveAttribute('data-x', String(SPOT_X.stove))
    expect(screen.queryByTestId('stove-steam')).toBeNull()
  })

  it('is at the stove with steam when a cook was started in another tab and you come home', async () => {
    startGuidedCookSession('recipe-1')
    mockFetch([fresh])
    renderHome()
    await loaded()
    expect(bubbles()).toHaveAttribute('data-spot', 'stove')
    expect(bubbles()).toHaveAttribute('data-x', String(SPOT_X.stove))
    expect(screen.getByTestId('stove-steam')).toBeInTheDocument()
  })

  it('counts a meal cook-along as a cook too', async () => {
    startMealCookSession('meal-1', ['a'], Date.now(), ['1:x'])
    mockFetch([fresh])
    renderHome()
    await loaded()
    expect(screen.getByTestId('stove-steam')).toBeInTheDocument()
  })

  it('walks to the fridge once the pantry loads with something going off', async () => {
    mockFetch([fresh, wilting()])
    renderHome()
    await waitFor(() => expect(bubbles()).toHaveAttribute('data-spot', 'fridge'))
    // it gets there by walking, then rests at the fridge
    await waitFor(() => expect(bubbles()).toHaveAttribute('data-pose', 'side'))
    await waitFor(
      () => {
        expect(bubbles()).toHaveAttribute('data-x', String(SPOT_X.fridge))
        expect(bubbles()).toHaveAttribute('data-pose', 'threeQuarter')
      },
      { timeout: 4000 },
    )
    expect(bubbles()).toHaveAttribute('data-moving', 'false')
  })

  it('stays at the stove, cooking, even with food going off; clearing the cook sends it to the fridge', async () => {
    startGuidedCookSession('recipe-1')
    mockFetch([wilting()])
    renderHome()
    await waitFor(() => expect(screen.getByText(/1 item in pantry/)).toBeInTheDocument())
    expect(bubbles()).toHaveAttribute('data-spot', 'stove')
    expect(screen.getByTestId('stove-steam')).toBeInTheDocument()

    act(() => {
      endCookSession('recipe-1')
      window.dispatchEvent(new StorageEvent('storage', { key: 'bubblychef:cook:activeSession' }))
    })
    await waitFor(() => expect(bubbles()).toHaveAttribute('data-spot', 'fridge'))
    expect(screen.queryByTestId('stove-steam')).toBeNull()
  })

  it('describes Bubbles in the scene’s label and draws it decoratively', async () => {
    startGuidedCookSession('recipe-1')
    mockFetch([fresh])
    renderHome()
    await loaded()
    const group = screen.getByRole('group', { name: /Bubbly is at the stove, cooking/ })
    expect(group).toBe(screen.getByTestId('kitchen-wall'))
    // the sprite itself is hidden from assistive tech: nothing to tab to or announce
    expect(bubbles().closest('[aria-hidden="true"]')).not.toBeNull()
    expect(bubbles().closest('a, button')).toBeNull()
  })

  it('under reduced motion puts Bubbles at the right spot in a still pose, with no steam loop', async () => {
    mockReduced = true
    startGuidedCookSession('recipe-1')
    mockFetch([wilting()])
    renderHome()
    await waitFor(() => expect(screen.getByText(/1 item in pantry/)).toBeInTheDocument())
    expect(bubbles()).toHaveAttribute('data-x', String(SPOT_X.stove))
    expect(bubbles()).toHaveAttribute('data-pose', 'front')
    expect(bubbles()).toHaveAttribute('data-moving', 'false')
    const frame = screen.getByTestId('stove-steam').getAttribute('data-frame')

    // the cook ends: it is at the fridge at once, never walking
    act(() => {
      endCookSession('recipe-1')
      window.dispatchEvent(new StorageEvent('storage', { key: 'bubblychef:cook:activeSession' }))
    })
    await waitFor(() => expect(bubbles()).toHaveAttribute('data-x', String(SPOT_X.fridge)))
    expect(bubbles()).toHaveAttribute('data-moving', 'false')
    expect(bubbles()).not.toHaveAttribute('data-pose', 'side')
    expect(frame).not.toBeNull()
  })
})
