/**
 * Issue #489 — CookModal matches the pantry against the list that was COOKED.
 * The caller hands it the amended list; the modal passes it to `cookRecipe` and
 * says so, and never applies it to a "what will this cost me?" preview.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const mockCookRecipe = jest.fn()
const mockConfirmCook = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  cookRecipe: (...args: unknown[]) => mockCookRecipe(...args),
  confirmCook: (...args: unknown[]) => mockConfirmCook(...args),
}))

import CookModal from '@/components/recipes/CookModal'
import type { CookProposal } from '@/types/recipes'

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
