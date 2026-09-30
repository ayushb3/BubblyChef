/**
 * Issue #489 — CookModal matches the pantry against the list that was COOKED.
 * The caller hands it the amended list; the modal passes it to `cookRecipe` and
 * says so, and never applies it to a "what will this cost me?" preview.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

const mockCookRecipe = jest.fn()
const mockConfirmCook = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  cookRecipe: (...args: unknown[]) => mockCookRecipe(...args),
  confirmCook: (...args: unknown[]) => mockConfirmCook(...args),
}))

import CookModal from '@/components/recipes/CookModal'
import type { CookProposal } from '@/types/recipes'
import { startCookSession, saveAmendedCook, getAmendedIngredients } from '@/lib/cook-session'

function QueryWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const PROPOSAL = {
  recipe_id: 'r1',
  recipe_title: 'Creamy pasta',
  matches: [],
  missing: [],
  unit_conflicts: [],
  compound_suggestions: [],
} as unknown as CookProposal

const ROUX = [
  { name: 'butter', quantity: 30, unit: 'g' },
  { name: 'flour', quantity: 30, unit: 'g' },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockCookRecipe.mockResolvedValue(PROPOSAL)
})

function open(props: Partial<React.ComponentProps<typeof CookModal>> = {}) {
  return render(
    <CookModal recipeId="r1" recipeTitle="Creamy pasta" onClose={jest.fn()} onCooked={jest.fn()} {...props} />,
    { wrapper: QueryWrapper },
  )
}

describe('CookModal with an amended list', () => {
  it('asks for the match with the amended list, and says it is using it', async () => {
    open({ amendedIngredients: ROUX })
    await waitFor(() => expect(mockCookRecipe).toHaveBeenCalledWith('r1', ROUX))
    expect(await screen.findByTestId('cook-modal-amended-note')).toHaveTextContent(/your changes/i)
  })

  it('without an amendment it asks exactly as before, with no note', async () => {
    open()
    await waitFor(() => expect(mockCookRecipe).toHaveBeenCalledWith('r1'))
    await screen.findByRole('button', { name: /cancel/i })
    expect(screen.queryByTestId('cook-modal-amended-note')).not.toBeInTheDocument()
  })

  it('an empty amendment is no amendment', async () => {
    open({ amendedIngredients: [] })
    await waitFor(() => expect(mockCookRecipe).toHaveBeenCalledWith('r1'))
  })

  it('a preview (not yet cooking) never uses an amendment', async () => {
    open({ amendedIngredients: ROUX, mode: 'preview', onStartCooking: jest.fn() })
    await waitFor(() => expect(mockCookRecipe).toHaveBeenCalledWith('r1'))
    expect(screen.queryByTestId('cook-modal-amended-note')).not.toBeInTheDocument()
  })
})

// Confirming ends the cook, which clears the stored amendment, which changes what
// a caller reading the store hands the modal. That must not re-fetch the proposal,
// flip the success sheet back to review, or cancel the redirect timer (#489).
describe('CookModal: the amendment clearing after a confirm', () => {
  const READY = {
    ingredient_name: 'butter',
    pantry_item_id: 'p1',
    pantry_item_name: 'butter',
    status: 'ready',
    match_type: 'exact',
    deduct_qty: 30,
    base_unit: 'g',
    substitution_note: null,
  }
  const WITH_MATCH = { ...PROPOSAL, matches: [READY] } as unknown as CookProposal

  // A caller that reads the store on every render, like the chat page used to.
  function Harness({ isDraft = false }: { tick: number; isDraft?: boolean }) {
    return (
      <CookModal
        recipeId="r1"
        recipeTitle="Creamy pasta"
        isDraft={isDraft}
        amendedIngredients={getAmendedIngredients('r1')}
        onClose={jest.fn()}
        onCooked={jest.fn()}
      />
    )
  }

  beforeEach(() => {
    window.localStorage.clear()
    mockPush.mockClear()
    mockCookRecipe.mockResolvedValue(WITH_MATCH)
    mockConfirmCook.mockResolvedValue(undefined)
    startCookSession('r1')
    saveAmendedCook('r1', { title: 'Creamy pasta', ingredients: ROUX })
  })

  async function confirmToSuccess(isDraft: boolean) {
    const view = render(<Harness tick={1} isDraft={isDraft} />, { wrapper: QueryWrapper })
    fireEvent.click(await screen.findByRole('button', { name: /yes, i cooked this/i }))
    await screen.findByText(/pantry updated/i)
    expect(getAmendedIngredients('r1')).toBeNull() // the confirm cleared it
    view.rerender(<Harness tick={2} isDraft={isDraft} />)
    return view
  }

  it('keeps the success sheet and makes no second proposal fetch', async () => {
    await confirmToSuccess(true)
    expect(screen.getByText(/pantry updated/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /yes, i cooked this/i })).not.toBeInTheDocument()
    expect(mockCookRecipe).toHaveBeenCalledTimes(1)
  })

  it('does not cancel the redirect timer', async () => {
    await confirmToSuccess(false)
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat?cooking=r1'), { timeout: 3000 })
    expect(mockCookRecipe).toHaveBeenCalledTimes(1)
  })
})
