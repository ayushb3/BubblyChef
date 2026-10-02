/**
 * Issue #906: through the real bell, every kind of entry can be dismissed; the
 * dismissal survives a reload, comes back when the entry's own state changes,
 * "Clear all" empties the list, and nothing is ever written to pantry or grocery
 * data. Timers keep going through the timer store.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationBell from '@/components/layout/NotificationBell'
import { CookingTimersProvider } from '@/lib/useCookingTimers'
import { addManualLines } from '@/lib/grocery'
import { saveGroceryLines } from '@/lib/grocery-store'
import { inboxDismissalsKey } from '@/lib/inbox-dismissals-store'

const mockGetUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => mockGetUser() } }),
}))

const TIMERS_STORAGE_KEY = 'bubblychef:timers:v1'
const DAY = 86_400_000

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * DAY).toISOString()
}
function isoDate(daysFromNow: number): string {
  return iso(daysFromNow).slice(0, 10)
}

interface Feed {
  items: unknown[]
  /** `last_cooked_at` of the one saved recipe. */
  lastCooked: string | null
}

const recentCook = () => iso(-1)
let feed: Feed
let fetchMock: jest.Mock

const expiredItem = (expiry = isoDate(-3)) => ({
  id: 'e1',
  name: 'Old Yogurt',
  quantity: 1,
  unit: 'item',
  category: 'dairy',
  expiry_date: expiry,
  days_until_expiry: -3,
  is_expired: true,
  is_expiring_soon: false,
})
const expiringItem = (expiry = isoDate(1)) => ({
  id: 'x1',
  name: 'Fresh Bread',
  quantity: 1,
  unit: 'item',
  category: 'bakery',
  expiry_date: expiry,
  days_until_expiry: 1,
  is_expired: false,
  is_expiring_soon: true,
})
const emptyItem = (quantity = 0) => ({
  id: 'o1',
  name: 'Eggs',
  quantity,
  unit: 'item',
  category: 'dairy',
  expiry_date: null,
  days_until_expiry: null,
  is_expired: false,
  is_expiring_soon: false,
})

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

beforeEach(() => {
  window.localStorage.clear()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  feed = { items: [], lastCooked: recentCook() }
  fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/pantry'))
      return jsonResponse({ items: feed.items, total_count: feed.items.length })
    if (url.includes('/api/recipes')) return jsonResponse({ recipes: [{ last_cooked_at: feed.lastCooked }] })
    return jsonResponse({})
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CookingTimersProvider>
        <NotificationBell />
      </CookingTimersProvider>
    </QueryClientProvider>,
  )
}

async function openBell() {
  fireEvent.click(await screen.findByTestId('notification-bell'))
}

/** A "reload": throw the whole tree away and mount a fresh one on the same storage. */
async function reload(unmount: () => void) {
  unmount()
  const next = mount()
  await openBell()
  return next
}

const dismissButton = (copy: RegExp) => screen.findByRole('button', { name: copy })

/** The badge's number (0 when there is no badge). */
const badgeCount = () => Number(screen.queryByTestId('notification-badge')?.textContent ?? 0)

/** The text of every row in the open dropdown. A pantry row can also put a pointer on
 *  the grocery list, so a kind's own row is judged by its copy, not by the badge alone. */
const rowTexts = () => screen.queryAllByRole('listitem').map((li) => li.textContent ?? '')
const showing = (copy: RegExp) => rowTexts().some((t) => copy.test(t))
const settled = () => waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument())

interface Kind {
  name: string
  /** Seeds the feed so this kind of entry shows. */
  seed: () => void
  copy: RegExp
  /** Changes the underlying state so the entry has a new reason to show. */
  change: () => void
  /** What the entry reads after `change` (its count may differ). */
  backCopy: RegExp
}

const KINDS: Kind[] = [
  {
    name: 'expired item',
    seed: () => {
      feed.items = [expiredItem()]
    },
    copy: /old yogurt expired/i,
    change: () => {
      feed.items = [expiredItem(isoDate(-2))] // restocked with a new expiry date
    },
    backCopy: /old yogurt expired/i,
  },
  {
    name: 'expiring item',
    seed: () => {
      feed.items = [expiringItem()]
    },
    copy: /fresh bread expires/i,
    change: () => {
      feed.items = [expiringItem(isoDate(2))] // a new expiry date
    },
    backCopy: /fresh bread expires/i,
  },
  {
    name: 'cook nudge',
    seed: () => {
      feed.lastCooked = iso(-10)
    },
    copy: /haven.t cooked in a while/i,
    change: () => {
      feed.lastCooked = iso(-9) // a different last cook, still past the threshold
    },
    backCopy: /haven.t cooked in a while/i,
  },
  {
    name: 'grocery pointer',
    seed: () => {
      saveGroceryLines('u1', addManualLines([], ['paper towels', 'bananas']))
    },
    copy: /2 items on your grocery list/i,
    change: () => {
      saveGroceryLines('u1', addManualLines([], ['paper towels', 'bananas', 'rice']))
    },
    backCopy: /3 items on your grocery list/i,
  },
]

// The out-of-stock item has its own "comes back" case below (restocked, then out again).
const DISMISSABLE: Array<Pick<Kind, 'name' | 'seed' | 'copy'>> = [
  ...KINDS,
  {
    name: 'out-of-stock item',
    seed: () => {
      feed.items = [emptyItem()]
    },
    copy: /eggs is out of stock/i,
  },
]

describe.each(DISMISSABLE)('dismissing the $name', ({ seed, copy }) => {
  it('hides it, lowers the badge, and keeps it hidden across a reload', async () => {
    seed()
    const { unmount } = mount()
    await waitFor(() => expect(badgeCount()).toBeGreaterThan(0))
    const before = badgeCount()
    await openBell()

    fireEvent.click(await dismissButton(copy))

    await waitFor(() => expect(badgeCount()).toBe(before - 1))
    expect(showing(copy)).toBe(false)

    await reload(unmount)
    await settled()
    expect(showing(copy)).toBe(false)
    expect(badgeCount()).toBe(before - 1)
  })

  it('writes nothing to pantry or grocery data', async () => {
    seed()
    mount()
    await openBell()
    fireEvent.click(await dismissButton(copy))
    await waitFor(() => expect(showing(copy)).toBe(false))

    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
    expect(writes).toEqual([])
  })
})

describe.each(KINDS)('the dismissed $name', ({ seed, copy, change, backCopy }) => {
  it('comes back when its underlying state changes', async () => {
    seed()
    const { unmount } = mount()
    await openBell()
    fireEvent.click(await dismissButton(copy))
    await waitFor(() => expect(showing(copy)).toBe(false))

    change()
    await reload(unmount)

    await settled()
    expect(showing(backCopy)).toBe(true)
  })
})

describe('an out-of-stock item that was restocked and ran out again', () => {
  it('shows again', async () => {
    feed.items = [emptyItem()]
    const { unmount } = mount()
    await openBell()
    fireEvent.click(await dismissButton(/eggs is out of stock/i))
    await waitFor(() => expect(showing(/eggs is out of stock/i)).toBe(false))

    feed.items = [emptyItem(2)] // restocked
    const second = await reload(unmount)
    await settled()
    expect(showing(/eggs/i)).toBe(false)
    // Give the forgetting step a beat to run.
    await waitFor(() => {
      const raw = window.localStorage.getItem(inboxDismissalsKey('u1')) ?? ''
      expect(raw).not.toContain('low_stock:o1')
    })

    feed.items = [emptyItem()] // ran out again
    await reload(second.unmount)
    await settled()
    expect(showing(/eggs is out of stock/i)).toBe(true)
  })
})

describe('dismissals are per user', () => {
  it("one account's dismissal does not hide the entry for another", async () => {
    feed.items = [expiringItem()]
    const { unmount } = mount()
    await openBell()
    fireEvent.click(await dismissButton(/fresh bread expires/i))
    await waitFor(() => expect(showing(/fresh bread expires/i)).toBe(false))

    mockGetUser.mockResolvedValue({ data: { user: { id: 'u2' } } })
    await reload(unmount)
    await settled()
    expect(showing(/fresh bread expires/i)).toBe(true)
  })
})

describe('Clear all', () => {
  it('is not offered for a single entry', async () => {
    feed.lastCooked = iso(-10) // the cook nudge, and nothing else
    mount()
    await openBell()
    await screen.findByText(/haven.t cooked in a while/i)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('dismisses every entry, updates the badge, and persists across a reload', async () => {
    feed.items = [expiredItem(), expiringItem(), emptyItem()]
    const { unmount } = mount()
    await waitFor(() => expect(badgeCount()).toBeGreaterThanOrEqual(3))
    await openBell()

    fireEvent.click(await screen.findByRole('button', { name: /clear all/i }))

    await waitFor(() => expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument())
    expect(screen.getByText(/nothing to do right now/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()

    await reload(unmount)
    expect(await screen.findByText(/nothing to do right now/i)).toBeInTheDocument()
  })

  it('also clears the entries hidden behind "and N more"', async () => {
    feed.items = Array.from({ length: 12 }, (_, i) => ({
      ...expiringItem(),
      id: `x${i}`,
      name: `Item ${i}`,
    }))
    mount()
    await openBell()
    expect(await screen.findByText(/and [0-9]+ more/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))

    await waitFor(() => expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument())
    expect(screen.getByText(/nothing to do right now/i)).toBeInTheDocument()
  })

  it('also dismisses a finished timer, through the timer store', async () => {
    window.localStorage.setItem(
      TIMERS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'timer-1',
          label: 'Pasta',
          durationSeconds: 600,
          endAt: null,
          frozenRemaining: 0,
          status: 'completed',
        },
      ]),
    )
    feed.items = [expiringItem()]
    mount()
    await waitFor(() => expect(badgeCount()).toBeGreaterThanOrEqual(2))
    await openBell()

    fireEvent.click(await screen.findByRole('button', { name: /clear all/i }))

    await waitFor(() => expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument())
    expect(JSON.parse(window.localStorage.getItem(TIMERS_STORAGE_KEY) ?? '[]')).toEqual([])
  })
})

describe('the dismiss control', () => {
  it('is a labelled button of at least 44px on every row, next to the row link', async () => {
    feed.items = [expiringItem()]
    mount()
    await openBell()
    const row = (await screen.findByText(/fresh bread expires/i)).closest('li') as HTMLElement
    const button = within(row).getByRole('button', { name: /^dismiss fresh bread expires/i })
    expect(button.className).toMatch(/min-h-\[44px\]/)
    expect(button.className).toMatch(/min-w-\[44px\]/)
    // The row's link still navigates; the dismiss button is not inside it.
    expect(within(row).getByRole('link')).not.toContainElement(button)
  })

  it('dismisses a finished timer when the row body is tapped, as well as by the keycap', async () => {
    window.localStorage.setItem(
      TIMERS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'timer-1',
          label: 'Pasta',
          durationSeconds: 600,
          endAt: null,
          frozenRemaining: 0,
          status: 'completed',
        },
      ]),
    )
    mount()
    await openBell()
    fireEvent.click(await screen.findByText('Pasta timer finished'))

    await waitFor(() => expect(screen.queryByText('Pasta timer finished')).not.toBeInTheDocument())
    expect(JSON.parse(window.localStorage.getItem(TIMERS_STORAGE_KEY) ?? '[]')).toEqual([])
  })

  it('leaves a finished timer on the timer store, with no inbox record kept for it', async () => {
    window.localStorage.setItem(
      TIMERS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'timer-1',
          label: 'Pasta',
          durationSeconds: 600,
          endAt: null,
          frozenRemaining: 0,
          status: 'completed',
        },
      ]),
    )
    mount()
    await openBell()
    fireEvent.click(await dismissButton(/^dismiss pasta timer finished/i))

    await waitFor(() => expect(screen.queryByText('Pasta timer finished')).not.toBeInTheDocument())
    expect(JSON.parse(window.localStorage.getItem(TIMERS_STORAGE_KEY) ?? '[]')).toEqual([])
    expect(window.localStorage.getItem(inboxDismissalsKey('u1')) ?? '').not.toContain('timer')
  })
})
