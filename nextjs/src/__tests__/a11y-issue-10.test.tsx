/**
 * Issue #10 — keyboard + screen-reader operability pass.
 *
 * Three things asserted here, matching the three claims in the PM report
 * that are actually testable in jsdom (no browser, no real AT):
 *  1. BottomNav marks the active tab with `aria-current="page"`.
 *  2. Pantry item cards give their edit button an accessible name that
 *     states the action, not just the item's visible text.
 *  3. The shared `useModalFocusTrap` hook (wired into AddItemModal and
 *     RecipeEditModal as the stays-mounted and mounts-to-open cases) moves
 *     focus in on open, traps Tab inside the panel, and returns focus to
 *     the trigger on close.
 */
import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BottomNav from '@/components/layout/BottomNav'
import PantryPage from '@/app/pantry/page'
import { ThemeProvider } from '@/components/ThemeProvider'
import AddItemModal from '@/components/pantry/AddItemModal'
import RecipeEditModal from '@/components/recipes/RecipeEditModal'
import type { Recipe } from '@/components/recipes/RecipePage'

let mockPathname = '/'
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

describe('BottomNav aria-current (#10)', () => {
  afterEach(() => {
    mockPathname = '/'
  })

  it('marks only the active tab as aria-current="page"', () => {
    mockPathname = '/pantry'
    render(<BottomNav />)

    const pantryLink = screen.getByRole('link', { name: 'Pantry' })
    expect(pantryLink).toHaveAttribute('aria-current', 'page')

    for (const label of ['Home', 'Chat', 'Recipes']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('names the nav landmark so a screen reader can distinguish it from any other nav', () => {
    render(<BottomNav />)
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})

describe('Pantry edit button accessible name (#10)', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('states the action and the item, not just the item', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        items: [
          { id: 'p1', name: 'milk', category: 'dairy', location: 'fridge', quantity: 1, unit: 'gallon', expiry_date: null },
        ],
      }),
    ) as unknown as typeof fetch

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <PantryPage />
        </ThemeProvider>
      </QueryClientProvider>,
    )

    // Distinct from a bare "Milk" name — the button states what it does.
    expect(await screen.findByRole('button', { name: 'Edit Milk' })).toBeInTheDocument()
  })
})

describe('useModalFocusTrap — stays-mounted case (AddItemModal) (#10)', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open add item
        </button>
        <AddItemModal isOpen={open} onClose={() => setOpen(false)} />
      </>
    )
  }

  it('moves focus into the panel on open and back to the trigger on close', () => {
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Open add item' })
    trigger.focus()
    fireEvent.click(trigger)

    // First focusable field in the panel — the modal has no autoFocus of its
    // own, so this is entirely the hook's doing.
    const nameInput = screen.getByPlaceholderText('e.g., Milk, Eggs, Rice...')
    expect(document.activeElement).toBe(nameInput)

    // Escape closes it (AddItemModal has no onKeyDown of its own — this is
    // the hook), and focus lands back on whatever opened it.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })

  it('traps Tab inside the panel — wraps at both ends', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open add item' }))

    const nameInput = screen.getByPlaceholderText('e.g., Milk, Eggs, Rice...')
    const submitButton = screen.getByRole('button', { name: 'Add to Pantry' })

    submitButton.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(nameInput)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(submitButton)
  })
})

describe('useModalFocusTrap — mounts-to-open case (RecipeEditModal) (#10)', () => {
  const recipe: Recipe = {
    id: 'r1',
    user_id: 'u1',
    created_at: '2026-01-01',
    title: 'Soup',
    description: '',
    tags: [],
    ingredients: [],
    instructions: [],
  } as unknown as Recipe

  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open edit
        </button>
        {open && (
          <RecipeEditModal
            recipe={recipe}
            onSave={async () => {}}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }

  it('focuses the panel on mount and returns focus to the trigger on unmount', async () => {
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Open edit' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Edit Recipe' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
