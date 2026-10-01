/**
 * The way back to a pending scan (issue #803). A scan waits for put-away; the
 * Bubbles card is its first way back in, but "Not now" hides the card for the
 * day, and closing the sheet leaves the scan pending. The kitchen itself is the
 * other way: Bubbles stands at the door with the shopping, and any wall tag
 * reading +N, and tapping either reopens put-away. With nothing pending the wall
 * does what it always did.
 *
 * Fetches are mocked; no model is called. Local storage is the real jsdom one,
 * because the pending scan and the card's records live there.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HeroHome from '@/components/dashboard/HeroHome'
import { DOOR_BOX, PLACE_BOXES, TAG_UNITS } from '@/components/kitchen/KitchenWall'
import { BUBBLES_H, BUBBLES_W } from '@/lib/kitchen/bubbles-art'
import { BUBBLES_Y, SPOT_X } from '@/lib/kitchen/bubbles-spot'
import { WALL_H, WALL_W } from '@/lib/kitchen/slots'
import {
  clearPendingPutAway,
  pendingFromScan,
  readPendingPutAway,
  savePendingPutAway,
} from '@/lib/kitchen/pending-putaway'
import type { ScanResult } from '@/types/scan'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function scanned(name: string, location: string) {
  return {
    name,
    original_name: name.toLowerCase(),
    source_line: name.toUpperCase(),
    price: 1,
    quantity: 1,
    unit: 'item',
    category: 'other',
    location,
    confidence: 0.95,
  }
}

const SCAN: ScanResult = {
  ocr_text: 'GROCERY MART',
  ready_to_add: [scanned('Milk', 'fridge'), scanned('Eggs', 'fridge'), scanned('Peas', 'freezer')],
  needs_review: [],
  skipped: [],
  total_items: 3,
  warnings: [],
}

function mockFetch() {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/decorations')) return jsonResponse({ decorations: [], total: 0 })
    if (url.includes('/api/bubbles')) return jsonResponse({ balance: 0, recent: [], streak_weeks: 0 })
    if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
    if (url.includes('/api/pantry')) {
      return jsonResponse({
        items: [
          { id: 'a', name: 'Butter', category: 'dairy', location: 'fridge', quantity: 1, unit: 'item', expiry_date: null },
        ],
        total_count: 1,
      })
    }
    return jsonResponse({ recipes: [], total_count: 0 })
  }) as unknown as typeof fetch
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HeroHome displayName="ayush" />
    </QueryClientProvider>,
  )
}

const originalFetch = global.fetch
const originalScrollTo = window.scrollTo
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo
  mockFetch()
})
afterEach(() => {
  clearPendingPutAway()
})
afterAll(() => {
  global.fetch = originalFetch
  window.scrollTo = originalScrollTo
})

const DIALOG = 'Put the shopping away?'

/** Home with a scan pending, its sheet closed and its card answered "Not now". */
async function dismissedAndClosed() {
  savePendingPutAway(pendingFromScan(SCAN))
  renderHome()
  const dialog = await screen.findByRole('dialog', { name: DIALOG })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  fireEvent.click(within(await screen.findByTestId('bubbles-card')).getByRole('button', { name: 'Not now' }))
  await waitFor(() => expect(screen.queryByTestId('bubbles-card')).not.toBeInTheDocument())
  // The scan is still waiting, and there is no card and no sheet left to reach it by.
  expect(readPendingPutAway()).not.toBeNull()
}

describe('with a pending scan, its card dismissed and the sheet closed', () => {
  it('tapping the door reopens put-away', async () => {
    await dismissedAndClosed()

    fireEvent.click(screen.getByRole('button', { name: /put the shopping away/i }))

    expect(await screen.findByRole('dialog', { name: DIALOG })).toBeInTheDocument()
    // Reopening writes nothing and keeps the scan.
    expect(readPendingPutAway()).not.toBeNull()
  })

  it('tapping a tag reading +N reopens put-away, not the storage sheet', async () => {
    await dismissedAndClosed()
    const fridge = screen.getByRole('button', { name: /^Fridge/ })
    expect(fridge).toHaveTextContent('Fridge +2')

    fireEvent.click(fridge)

    expect(await screen.findByRole('dialog', { name: DIALOG })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Storage' })).not.toBeInTheDocument()
  })

  it('a place with nothing coming in still opens its storage sheet', async () => {
    await dismissedAndClosed()
    const basket = screen.getByRole('button', { name: /^Basket/ })
    expect(basket).not.toHaveTextContent('+')

    fireEvent.click(basket)

    expect(await screen.findByRole('tablist', { name: 'Storage' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: DIALOG })).not.toBeInTheDocument()
  })

  it('the door goes away once the scan is discarded', async () => {
    await dismissedAndClosed()
    fireEvent.click(screen.getByRole('button', { name: /put the shopping away/i }))
    const dialog = await screen.findByRole('dialog', { name: DIALOG })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard this scan' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, discard it' }))

    await waitFor(() => expect(readPendingPutAway()).toBeNull())
    expect(screen.queryByRole('button', { name: /put the shopping away/i })).not.toBeInTheDocument()
  })
})

describe('with nothing pending', () => {
  it('there is no door to tap, and a place opens its storage sheet as before', async () => {
    renderHome()
    const fridge = await screen.findByRole('button', { name: /^Fridge/ })
    await waitFor(() => expect(fridge).toHaveTextContent('Fridge 1'))
    expect(screen.queryByRole('button', { name: /put the shopping away/i })).not.toBeInTheDocument()

    fireEvent.click(fridge)

    expect(await screen.findByRole('tablist', { name: 'Storage' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: DIALOG })).not.toBeInTheDocument()
  })
})

describe('the door tap target', () => {
  type Box = readonly [x: number, y: number, w: number, h: number]
  const overlaps = (a: Box, b: Box) =>
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
  // The wall is 96 units across and 390px wide on the design phone.
  const PX_PER_UNIT = 390 / WALL_W

  it('is at least 44px a side at 390px wide', () => {
    expect(DOOR_BOX[2] * PX_PER_UNIT).toBeGreaterThanOrEqual(44)
    expect(DOOR_BOX[3] * PX_PER_UNIT).toBeGreaterThanOrEqual(44)
  })

  it('covers Bubbles where it stands at the door, inside the wall', () => {
    const [x, y, w, h] = DOOR_BOX
    expect(x).toBeLessThanOrEqual(SPOT_X.door)
    expect(x + w).toBeGreaterThanOrEqual(SPOT_X.door + BUBBLES_W)
    expect(y).toBeLessThanOrEqual(BUBBLES_Y)
    expect(y + h).toBeGreaterThanOrEqual(BUBBLES_Y + BUBBLES_H)
    expect(x + w).toBeLessThanOrEqual(WALL_W)
    expect(y + h).toBeLessThanOrEqual(WALL_H)
  })

  it('never covers a place’s tap target or its tag', () => {
    for (const [name, { box, tag, anchorRight }] of Object.entries(PLACE_BOXES)) {
      expect([name, overlaps(DOOR_BOX, box)]).toEqual([name, false])
      const w = TAG_UNITS.w[name as keyof typeof TAG_UNITS.w]
      const tagBox: Box = [anchorRight ? tag[0] - w : tag[0], tag[1], w, TAG_UNITS.h]
      expect([`${name} tag`, overlaps(DOOR_BOX, tagBox)]).toEqual([`${name} tag`, false])
    }
  })
})
