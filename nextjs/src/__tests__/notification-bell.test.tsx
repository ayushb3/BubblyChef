/**
 * Component tests for the header bell (#496, Spec B.4).
 * Covers the AC's badge-count and empty-state behaviour, and that opening
 * the dropdown lists entries with the expired one first.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationBell from '@/components/layout/NotificationBell'
import { CookingTimersProvider } from '@/lib/useCookingTimers'

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

/** A failed fetch — the shared shape behind every "refresh fails" scenario below. */
function errorResponse(): Response {
  return { ok: false, status: 500, json: async () => ({}) } as Response
}

/** Matches `pantryItems: []`/`recipes` with a recent cook — no expiry/nudge noise. */
function mockQuietFetch() {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/pantry')) return jsonResponse({ items: [], total_count: 0 })
    if (url.includes('/api/recipes'))
      return jsonResponse({ recipes: [{ last_cooked_at: new Date().toISOString() }] })
    return jsonResponse({})
  }) as unknown as typeof fetch
}

// useInboxEntries fetches through React Query (#496 standards fix — server
// state goes through React Query, not hand-rolled useState/useEffect), so
// every render needs a provider, same as HeroHome's tests.
function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>,
  )
}

/**
 * Same as `renderBell`, but wrapped in the real `CookingTimersProvider`
 * (#619) — `useInboxEntries` reads timers through `useCookingTimers()`,
 * which falls back to an inert no-op store outside this provider (see
 * `lib/useCookingTimers.tsx`'s `NOOP_CONTEXT_VALUE`), so a test that wants a
 * real timer to appear needs the real provider mounted, same as the app tree.
 */
function renderBellWithTimers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CookingTimersProvider>
        <NotificationBell />
      </CookingTimersProvider>
    </QueryClientProvider>,
  )
}

/** Matches `useCookingTimers.tsx`'s own `STORAGE_KEY` — not exported, so pinned here. */
const TIMERS_STORAGE_KEY = 'bubblychef:timers:v1'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  window.localStorage.removeItem(TIMERS_STORAGE_KEY)
  jest.restoreAllMocks()
})

describe('NotificationBell', () => {
  it('shows no badge when there is nothing to do', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry')) return jsonResponse({ items: [], total_count: 0 })
      if (url.includes('/api/recipes'))
        return jsonResponse({ recipes: [{ last_cooked_at: new Date().toISOString() }] })
      return jsonResponse({})
    }) as unknown as typeof fetch

    renderBell()

    await waitFor(() => {
      expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument()
    })
  })

  it('shows a badge count of 2 and lists the expired item first', async () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const isoDate = (d: Date) => d.toISOString().slice(0, 10)

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry')) {
        return jsonResponse({
          items: [
            {
              id: 'expired-1',
              name: 'Old Milk',
              quantity: 1,
              expiry_date: isoDate(yesterday),
              days_until_expiry: -1,
              is_expired: true,
              is_expiring_soon: false,
            },
            {
              id: 'expiring-1',
              name: 'Fresh Bread',
              quantity: 1,
              expiry_date: isoDate(tomorrow),
              days_until_expiry: 1,
              is_expired: false,
              is_expiring_soon: true,
            },
          ],
          total_count: 2,
        })
      }
      if (url.includes('/api/recipes'))
        return jsonResponse({ recipes: [{ last_cooked_at: today.toISOString() }] })
      return jsonResponse({})
    }) as unknown as typeof fetch

    renderBell()

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('2')
    })

    fireEvent.click(screen.getByTestId('notification-bell'))

    await waitFor(() => {
      expect(screen.getByText(/Old Milk/)).toBeInTheDocument()
    })

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Old Milk')
    expect(items[1]).toHaveTextContent('Fresh Bread')
  })

  it('shows a gentle error state instead of "nothing to do" when the fetch fails', async () => {
    // A 401/500 must not read as an all-clear (#496 review): `fetchPantryItems`
    // now throws on a non-ok response instead of degrading to `[]`, so the
    // dropdown should show an explicit error, not the empty-inbox mascot.
    global.fetch = jest.fn(async () => errorResponse()) as unknown as typeof fetch

    renderBell()
    fireEvent.click(screen.getByTestId('notification-bell'))

    await waitFor(() => {
      expect(screen.getByText(/couldn.t check right now/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/nothing to do right now/i)).not.toBeInTheDocument()
  })

  it('shows a completed timer surfaced by the real Spec B.3 store, until dismissed (#619)', async () => {
    // #496's acceptance criteria: "With Spec B.3 merged, a completed timer
    // appears as an entry until dismissed." Issue #619 merged the real
    // store (`lib/useCookingTimers.tsx`) — seed its own persisted shape
    // directly (a completed, undismissed timer) rather than racing a real
    // countdown, then confirm `useInboxEntries` picks it up through
    // `useCookingTimers()` and the bell lists it.
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
    mockQuietFetch()

    renderBellWithTimers()

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('1')
    })

    fireEvent.click(screen.getByTestId('notification-bell'))

    await waitFor(() => {
      expect(screen.getByText('Pasta timer finished')).toBeInTheDocument()
    })

    // No `<a>` — it's a dismiss button, not a navigation link.
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0].querySelector('a')).toBeNull()
  })

  it('dismisses a completed timer through the real store, removing it from the bell (#496 tap-target: "timer → dismiss")', async () => {
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
    mockQuietFetch()

    renderBellWithTimers()

    fireEvent.click(await screen.findByTestId('notification-bell'))
    const dismissButton = await screen.findByRole('button', { name: /dismiss.*pasta timer finished/i })

    fireEvent.click(dismissButton)

    // Removed from the DOM and the badge, not just visually hidden.
    await waitFor(() => {
      expect(screen.queryByText('Pasta timer finished')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument()

    // The real store's own persisted record is gone too — this went through
    // `useCookingTimers().dismiss()`, not just local component state, so the
    // timer dock (`TimerDock.tsx`) sees the same removal.
    const stored = JSON.parse(window.localStorage.getItem(TIMERS_STORAGE_KEY) ?? '[]')
    expect(stored).toEqual([])
  })

  it('hides the numeric badge after a failed refresh, instead of asserting the stale pre-error count', async () => {
    // #496 review round 4: React Query keeps the last successful `data`
    // around through a failed refetch, so `entries`/`overflowCount` can
    // still reflect the *old* state here. Showing that stale number would
    // claim knowledge the app doesn't actually have any more.
    const today = new Date()
    let callCount = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      callCount += 1
      // First render's fetch pair succeeds (call 1: pantry, call 2: recipes);
      // every fetch from the second refresh() onward fails.
      const isFirstLoad = callCount <= 2
      if (url.includes('/api/pantry')) {
        if (!isFirstLoad) return errorResponse()
        return jsonResponse({
          items: [
            {
              id: 'expired-1',
              name: 'Old Milk',
              quantity: 1,
              expiry_date: today.toISOString().slice(0, 10),
              days_until_expiry: -1,
              is_expired: true,
              is_expiring_soon: false,
            },
          ],
          total_count: 1,
        })
      }
      if (url.includes('/api/recipes')) {
        if (!isFirstLoad) return errorResponse()
        return jsonResponse({ recipes: [{ last_cooked_at: today.toISOString() }] })
      }
      return jsonResponse({})
    }) as unknown as typeof fetch

    renderBell()

    // Successful initial load: badge shows a real count.
    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('1')
    })

    // Opening the dropdown calls refresh() -> refetch(), which now fails.
    fireEvent.click(screen.getByTestId('notification-bell'))

    await waitFor(() => {
      expect(screen.getByText(/couldn.t check right now/i)).toBeInTheDocument()
    })
    // No numeric badge — hidden outright rather than showing the stale "1".
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument()
  })

  it('hides the "and N more" footer after a failed refresh, instead of showing it beside the error panel', async () => {
    // #496 review round 5: the footer read the same stale memoised
    // `overflowCount` the round-4 badge fix stopped trusting, so it rendered
    // outside the loading/error/empty branch — a failed refresh showed
    // "Couldn't check right now" with "and 4 more" underneath it. 14 expired
    // rows (cap 10) reproduces the reviewer's own repro: overflowCount 4.
    const today = new Date()
    const isoDate = today.toISOString().slice(0, 10)
    const expiredItems = Array.from({ length: 14 }, (_, i) => ({
      id: `expired-${i}`,
      name: `Item ${i}`,
      quantity: 1,
      expiry_date: isoDate,
      days_until_expiry: -1,
      is_expired: true,
      is_expiring_soon: false,
    }))

    let callCount = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      callCount += 1
      const isFirstLoad = callCount <= 2
      if (url.includes('/api/pantry')) {
        if (!isFirstLoad) return errorResponse()
        return jsonResponse({ items: expiredItems, total_count: expiredItems.length })
      }
      if (url.includes('/api/recipes')) {
        if (!isFirstLoad) return errorResponse()
        return jsonResponse({ recipes: [{ last_cooked_at: today.toISOString() }] })
      }
      return jsonResponse({})
    }) as unknown as typeof fetch

    renderBell()

    // Successful initial load: badge shows the real count (10 shown + 4 overflow).
    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('14')
    })

    // Opening the dropdown renders the cached success data synchronously
    // (before the refetch below resolves) and calls refresh() -> refetch(),
    // which now fails.
    fireEvent.click(screen.getByTestId('notification-bell'))

    await waitFor(() => {
      expect(screen.getByText(/and 4 more/i)).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText(/couldn.t check right now/i)).toBeInTheDocument()
    })
    // The footer must not survive alongside the error panel, even though
    // the memoised `overflowCount` from the last successful fetch is still 4.
    expect(screen.queryByText(/and 4 more/i)).not.toBeInTheDocument()
  })

  it('closes the dropdown on window scroll and resize, since it is position: fixed and only measures its top once on open', async () => {
    // #496 review round 1/5: `top` is measured once when the dropdown opens
    // and never re-measured, so scrolling (or resizing, e.g. a mobile
    // orientation change) leaves it floating detached from the bell. Closing
    // on either event is simpler and safer than re-measuring on every frame.
    mockQuietFetch()
    renderBell()

    fireEvent.click(await screen.findByTestId('notification-bell'))
    expect(await screen.findByRole('region')).toBeInTheDocument()

    fireEvent.scroll(window)

    await waitFor(() => {
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })

    fireEvent.click(await screen.findByTestId('notification-bell'))
    expect(await screen.findByRole('region')).toBeInTheDocument()

    fireEvent(window, new Event('resize'))

    await waitFor(() => {
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })
  })
})
