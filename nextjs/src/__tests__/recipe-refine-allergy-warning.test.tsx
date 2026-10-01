/**
 * Issue #500 — the library refine surfaces `allergy_warning`.
 *
 * `/v1/recipes/refine` returns it when the user's own saved recipe still carries an
 * ingredient on their allergy list (the card is kept as they made it). The client
 * type carries it through, and the refinement modal shows it as a one-line notice.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecipeRefinementModal from '@/components/recipes/RecipeRefinementModal'
import { refineRecipe } from '@/lib/api/recipes'
import type { GenerateRecipeResponse } from '@/types/recipes'

const WARNING = 'This recipe contains peanut, which is on your allergy list.'
const fetchMock = jest.fn()

function responseBody(extra: Partial<GenerateRecipeResponse> = {}): GenerateRecipeResponse {
  return {
    recipe: { title: 'Spicy Satay', ingredients: [], instructions: [] },
    ingredients_status: [],
    missing_count: 0,
    have_count: 0,
    partial_count: 0,
    pantry_match_score: 1,
    ...extra,
  } as unknown as GenerateRecipeResponse
}

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.clearAllMocks()
})

describe('refineRecipe client', () => {
  it('returns allergy_warning from the server response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => responseBody({ allergy_warning: WARNING }),
    })
    const res = await refineRecipe({ recipe: { title: 'Satay' }, prompt: 'make it spicier' })
    expect(res.allergy_warning).toBe(WARNING)
  })

  it('leaves it absent when the server sends none', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => responseBody() })
    const res = await refineRecipe({ recipe: { title: 'Satay' }, prompt: 'make it spicier' })
    expect(res.allergy_warning ?? null).toBeNull()
  })
})

describe('RecipeRefinementModal allergy notice', () => {
  async function refineOnce(body: GenerateRecipeResponse) {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body })
    render(
      <RecipeRefinementModal
        isOpen
        onClose={jest.fn()}
        recipe={{ title: 'Satay', ingredients: [], instructions: [] }}
        onSave={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Refinement prompt'), {
      target: { value: 'make it spicier' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText(/1 refinement applied/i)).toBeInTheDocument())
  }

  it('shows the one-line warning after a refine that returns one', async () => {
    await refineOnce(responseBody({ allergy_warning: WARNING }))
    expect(screen.getByText(WARNING)).toBeInTheDocument()
  })

  it('shows nothing when there is no warning', async () => {
    await refineOnce(responseBody())
    expect(screen.queryByText(/allergy list/i)).not.toBeInTheDocument()
  })
})
