/**
 * Issue #497: the notification bell's grocery pointer ("N items on your grocery
 * list", `inbox-helpers.ts`) is fed for real now that `/grocery` exists. The
 * count is what the page shows: the saved list merged with what the pantry says
 * to buy, unchecked lines only. It reads the pantry the inbox already fetched,
 * so the bell costs no extra request.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotificationBell from '@/components/layout/NotificationBell'
import { addManualLines, setLineChecked } from '@/lib/grocery'
import { saveGroceryLines } from '@/lib/grocery-store'

const mockGetUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: () => mockGetUser() } }),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

function mockFetch(pantryItems: unknown[]) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/pantry'))
      return jsonResponse({ items: pantryItems, total_count: pantryItems.length })
    if (url.includes('/api/recipes'))
      return jsonResponse({ recipes: [{ last_cooked_at: new Date().toISOString() }] })
    return jsonResponse({})
  }) as unknown as typeof fetch
}

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>,
  )
}

const originalFetch = global.fetch
beforeEach(() => {
  window.localStorage.clear()
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})
afterEach(() => {
  global.fetch = originalFetch
})

describe('NotificationBell: grocery pointer', () => {
  it('points at /grocery with the count of lines still to buy', async () => {
    let lines = addManualLines([], ['paper towels', 'bananas', 'rice'])
    lines = setLineChecked(lines, 'rice', true) // got it: not counted
    saveGroceryLines('u1', lines)
    mockFetch([])

    renderBell()
    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('1'))
    fireEvent.click(screen.getByTestId('notification-bell'))

    const link = await screen.findByRole('link', { name: /2 items on your grocery list/i })
    expect(link).toHaveAttribute('href', '/grocery')
  })

  it('counts what the pantry says to buy, the same as the page will show', async () => {
    mockFetch([
      {
        id: 'e',
        name: 'eggs',
        category: 'dairy',
        quantity: 0,
        unit: 'item',
        expiry_date: null,
        days_until_expiry: null,
        is_expired: false,
      },
    ])
    renderBell()
    fireEvent.click(screen.getByTestId('notification-bell'))
    expect(
      await screen.findByRole('link', { name: /1 item on your grocery list/i }),
    ).toHaveAttribute('href', '/grocery')
  })

  it('shows no pointer when the list is empty', async () => {
    mockFetch([])
    renderBell()
    fireEvent.click(screen.getByTestId('notification-bell'))
    await screen.findByText(/nothing to do right now/i)
    expect(screen.queryByRole('link', { name: /grocery list/i })).not.toBeInTheDocument()
  })
})
