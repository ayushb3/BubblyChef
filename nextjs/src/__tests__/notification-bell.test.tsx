/**
 * Component tests for the header bell (#496, Spec B.4).
 * Covers the AC's badge-count and empty-state behaviour, and that opening
 * the dropdown lists entries with the expired one first.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationBell from '@/components/layout/NotificationBell'

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
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

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
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

    const items = screen.getAllByRole('menuitem')
    expect(items[0]).toHaveTextContent('Old Milk')
    expect(items[1]).toHaveTextContent('Fresh Bread')
  })
})
