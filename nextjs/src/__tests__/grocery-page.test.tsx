/**
 * Issue #497 (Spec B.5): the /grocery page. It is built on the data layer from
 * PR #701 (`lib/grocery*.ts`): the list is generated from the pantry (depleted
 * and about-to-expire food), lives in the browser's localStorage keyed by user
 * id, and is checkable, editable and shareable. Nothing here writes to the
 * database.
 */

import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { addManualLines, setLineChecked } from '@/lib/grocery'
import { loadGroceryLines, saveGroceryLines } from '@/lib/grocery-store'

const mockGetUser = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } }),
}))

const mockFetchPantry = jest.fn()
jest.mock('@/lib/api/pantry', () => ({
  fetchPantryItems: (...a: unknown[]) => mockFetchPantry(...a),
}))

// The header carries the notification bell, which has its own data needs;
// this page's tests are about the list.
jest.mock('@/components/layout/BubblesHeader', () => ({
  __esModule: true,
  default: ({ rightSlot }: { rightSlot?: React.ReactNode }) => (
    <header data-testid="header">{rightSlot}</header>
  ),
}))

import GroceryPage from '@/app/grocery/page'

const USER = 'user-1'

const PANTRY = [
  { name: 'eggs', category: 'dairy', quantity: 0, unit: 'item', days_until_expiry: null, is_expired: false },
  { name: 'milk', category: 'dairy', quantity: 1, unit: 'L', days_until_expiry: 1, is_expired: false },
  { name: 'rice', category: 'dry_goods', quantity: 3, unit: 'kg', days_until_expiry: 200, is_expired: false },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GroceryPage />
    </QueryClientProvider>,
  )
}

/** Wait for the first generation to land (the list leaves its loading state). */
async function ready() {
  await waitFor(() => expect(screen.queryByTestId('grocery-loading')).not.toBeInTheDocument())
}

const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share')
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setNavigator(prop: 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, prop, { value, configurable: true, writable: true })
}

beforeEach(() => {
  window.localStorage.clear()
  mockGetUser.mockReset()
  mockFetchPantry.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } } })
  mockFetchPantry.mockResolvedValue(PANTRY)
  setNavigator('share', undefined)
  setNavigator('clipboard', undefined)
})

afterEach(() => {
  for (const [prop, original] of [
    ['share', originalShare],
    ['clipboard', originalClipboard],
  ] as const) {
    if (original) Object.defineProperty(navigator, prop, original)
    else delete (navigator as unknown as Record<string, unknown>)[prop]
  }
})

describe('/grocery: what is on the list', () => {
  it('lists depleted and expiring food under category headings, and not fresh food', async () => {
    renderPage()
    await ready()

    const dairy = screen.getByRole('region', { name: /dairy and eggs/i })
    expect(within(dairy).getByRole('checkbox', { name: /eggs/i })).toBeInTheDocument()
    expect(within(dairy).getByRole('checkbox', { name: /milk/i })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /rice/i })).not.toBeInTheDocument()
  })

  it('says why a generated line is there', async () => {
    renderPage()
    await ready()
    expect(screen.getByText('Ran out')).toBeInTheDocument()
    expect(screen.getByText('Replace soon')).toBeInTheDocument()
  })

  it('shows how many items are still to buy', async () => {
    renderPage()
    await ready()
    expect(screen.getByTestId('grocery-count')).toHaveTextContent('2 to buy')
  })

  it('saves the generated list, so the count elsewhere in the app agrees', async () => {
    renderPage()
    await ready()
    expect(loadGroceryLines(USER).map((l) => l.key)).toEqual(['egg', 'milk'])
  })

  it('shows an empty state when nothing needs buying', async () => {
    mockFetchPantry.mockResolvedValue([PANTRY[2]])
    renderPage()
    await ready()
    expect(screen.getByText(/nothing on your list/i)).toBeInTheDocument()
    expect(screen.getByTestId('grocery-count')).toHaveTextContent('0 to buy')
  })

  it('shows the saved list, with a way to retry, when the pantry cannot be read', async () => {
    saveGroceryLines(USER, addManualLines([], ['paper towels']))
    mockFetchPantry.mockRejectedValue(new Error('boom'))
    renderPage()
    await ready()
    expect(screen.getByRole('checkbox', { name: /paper towels/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t check your pantry/i)
  })
})

describe('/grocery: checking off', () => {
  it('moves a ticked line into "Got it" and keeps it ticked after a reload', async () => {
    const first = renderPage()
    await ready()

    fireEvent.click(screen.getByRole('checkbox', { name: /eggs/i }))

    const gotIt = screen.getByRole('region', { name: /got it/i })
    expect(within(gotIt).getByRole('checkbox', { name: /eggs/i })).toBeChecked()
    expect(screen.getByTestId('grocery-count')).toHaveTextContent('1 to buy')
    expect(loadGroceryLines(USER).find((l) => l.key === 'egg')?.checked).toBe(true)

    first.unmount()
    renderPage()
    await ready()
    const gotItAgain = screen.getByRole('region', { name: /got it/i })
    expect(within(gotItAgain).getByRole('checkbox', { name: /eggs/i })).toBeChecked()
  })

  it('moves a line back to buy when it is unticked', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('checkbox', { name: /eggs/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /eggs/i }))

    expect(screen.queryByRole('region', { name: /got it/i })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: /dairy and eggs/i })).getByRole('checkbox', {
        name: /eggs/i,
      }),
    ).not.toBeChecked()
  })

  it('clears the "Got it" lines', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('checkbox', { name: /eggs/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear got it/i }))

    expect(screen.queryByRole('region', { name: /got it/i })).not.toBeInTheDocument()
    expect(loadGroceryLines(USER).map((l) => l.key)).toEqual(['milk'])
  })
})

describe('/grocery: editing', () => {
  it('edits a quantity and unit in place and keeps the edit', async () => {
    renderPage()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: /edit amount of eggs/i }))
    fireEvent.change(screen.getByRole('spinbutton', { name: /quantity of eggs/i }), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: /unit for eggs/i }), {
      target: { value: 'cartons' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save amount of eggs/i }))

    expect(screen.getByRole('button', { name: /edit amount of eggs/i })).toHaveTextContent('2 cartons')
    const saved = loadGroceryLines(USER).find((l) => l.key === 'egg')
    expect(saved).toMatchObject({ quantity: 2, unit: 'cartons', source: 'manual' })
  })

  it('saves on Enter and drops the edit on Escape', async () => {
    renderPage()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: /edit amount of milk/i }))
    const qty = screen.getByRole('spinbutton', { name: /quantity of milk/i })
    fireEvent.change(qty, { target: { value: '3' } })
    fireEvent.keyDown(qty, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /edit amount of milk/i })).toHaveTextContent('3 L')

    fireEvent.click(screen.getByRole('button', { name: /edit amount of milk/i }))
    const again = screen.getByRole('spinbutton', { name: /quantity of milk/i })
    fireEvent.change(again, { target: { value: '9' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /edit amount of milk/i })).toHaveTextContent('3 L')
  })

  it('does not save a quantity that is not a number', async () => {
    renderPage()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: /edit amount of milk/i }))
    fireEvent.change(screen.getByRole('spinbutton', { name: /quantity of milk/i }), {
      target: { value: '-4' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save amount of milk/i }))

    expect(screen.getByRole('spinbutton', { name: /quantity of milk/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(loadGroceryLines(USER).find((l) => l.key === 'milk')?.quantity).toBe(1)
  })

  it('removes a line', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /remove eggs/i }))

    expect(screen.queryByRole('checkbox', { name: /eggs/i })).not.toBeInTheDocument()
    expect(loadGroceryLines(USER).map((l) => l.key)).toEqual(['milk'])
  })

  it('adds a free-text item under Other, and clears the field', async () => {
    renderPage()
    await ready()

    const input = screen.getByRole('textbox', { name: /add an item/i })
    fireEvent.change(input, { target: { value: 'paper towels' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    const other = screen.getByRole('region', { name: /^other/i })
    expect(within(other).getByRole('checkbox', { name: /paper towels/i })).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(loadGroceryLines(USER).find((l) => l.key === 'paper towel')).toMatchObject({
      source: 'manual',
      category: 'other',
    })
  })

  it('adds with Enter, and will not add an empty line', async () => {
    renderPage()
    await ready()

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
    const input = screen.getByRole('textbox', { name: /add an item/i })
    fireEvent.change(input, { target: { value: 'bananas' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(screen.getByRole('checkbox', { name: /bananas/i })).toBeInTheDocument()
  })
})

describe('/grocery: Regenerate', () => {
  it('keeps ticked and added lines and refreshes the generated ones from the pantry', async () => {
    saveGroceryLines(
      USER,
      setLineChecked(addManualLines([], ['paper towels', 'eggs']), 'egg', true),
    )
    renderPage()
    await ready()
    // Milk is expiring and was picked up on open.
    expect(screen.getByRole('checkbox', { name: /milk/i })).toBeInTheDocument()

    // The pantry moves on: milk was restocked, butter has run out.
    mockFetchPantry.mockResolvedValue([
      { name: 'butter', category: 'dairy', quantity: 0, unit: 'item', days_until_expiry: null, is_expired: false },
      { name: 'milk', category: 'dairy', quantity: 2, unit: 'L', days_until_expiry: 9, is_expired: false },
    ])
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /milk/i })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('checkbox', { name: /butter/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /paper towels/i })).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: /got it/i })).getByRole('checkbox', {
        name: /eggs/i,
      }),
    ).toBeChecked()
  })

  it('leaves the list alone and says so when the pantry cannot be read', async () => {
    renderPage()
    await ready()
    mockFetchPantry.mockRejectedValue(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t check your pantry/i)
    expect(screen.getByRole('checkbox', { name: /eggs/i })).toBeInTheDocument()
  })
})

describe('/grocery: Share', () => {
  it('shares the unchecked lines as plain text with the Web Share API', async () => {
    const share = jest.fn().mockResolvedValue(undefined)
    setNavigator('share', share)
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('checkbox', { name: /eggs/i })) // got it: not shared

    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(share.mock.calls[0][0].text).toBe('- Milk (1 L)')
  })

  it('copies the text when there is no share sheet', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    setNavigator('clipboard', { writeText })
    renderPage()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('- Eggs\n- Milk (1 L)'))
    expect(await screen.findByRole('status')).toHaveTextContent(/copied/i)
  })

  it('shows the text to copy by hand when neither sharing nor copying works', async () => {
    renderPage()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: /share/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox')).toHaveValue('- Eggs\n- Milk (1 L)')
  })

  it('has nothing to share on an empty list', async () => {
    mockFetchPantry.mockResolvedValue([PANTRY[2]])
    renderPage()
    await ready()
    expect(screen.getByRole('button', { name: /share/i })).toBeDisabled()
  })
})

describe('/grocery: signed out', () => {
  it('asks the user to sign in rather than showing an empty list', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    renderPage()
    expect(await screen.findByText(/sign in to use your grocery list/i)).toBeInTheDocument()
    await act(async () => {})
    expect(mockFetchPantry).not.toHaveBeenCalled()
  })
})
