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
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch

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
    // `useCookingTimers()` and the bell lists it. Dismissal itself is owned
    // by the cooking-timer dock (#495/#619), not this hub, so it isn't
    // exercised here — this only pins that an undismissed one stays listed.
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

    // Dismiss-only: no tap target, per the existing timer-entry convention.
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0].querySelector('a')).toBeNull()
  })
})
