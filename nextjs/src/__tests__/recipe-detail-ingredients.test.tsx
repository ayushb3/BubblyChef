/**
 * Regression test for #315 — blank ingredient rows on the recipe detail
 * page.
 *
 * Recipe `ingredients` are stored in the DB in two shapes: `Ingredient`
 * objects (AI generation / URL import) and plain strings (RecipeEditModal
 * flattens to `string[]` on save). The detail page previously handled only
 * the object shape, so a string-shaped element rendered an empty label —
 * correct row count, invisible text. This test asserts on *visible text*,
 * not row count, so it actually catches the regression.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import RecipeDetailPage from '@/app/recipes/[id]/page'

const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'recipe-1' }),
  useRouter: () => ({ push: pushMock }),
}))

function mockFetchOnce(body: unknown, status = 200) {
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('RecipeDetailPage ingredient rendering (#315)', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
    pushMock.mockClear()
  })

  it('renders visible text for string-shaped ingredients (the regression)', async () => {
    mockFetchOnce({
      id: 'recipe-1',
      title: 'Scrambled Eggs',
      ingredients: ['2 large eggs', 'a pinch of salt', 'butter'],
      instructions: ['Whisk eggs', 'Cook in butter'],
    })

    render(<RecipeDetailPage />)

    expect(await screen.findByText('2 large eggs')).toBeInTheDocument()
    expect(screen.getByText('a pinch of salt')).toBeInTheDocument()
    expect(screen.getByText('butter')).toBeInTheDocument()
  })

  it('still renders object-shaped ingredients correctly (shape not silently swapped)', async () => {
    mockFetchOnce({
      id: 'recipe-1',
      title: 'Pancakes',
      ingredients: [
        { name: 'flour', quantity: 2, unit: 'cups' },
        { name: 'egg', quantity: 1, unit: null, preparation: 'beaten', optional: false },
        { name: 'vanilla extract', quantity: null, unit: null, optional: true },
      ],
      instructions: ['Mix', 'Cook'],
    })

    render(<RecipeDetailPage />)

    expect(await screen.findByText('2 cups flour')).toBeInTheDocument()
    expect(screen.getByText('1 egg')).toBeInTheDocument()
    expect(screen.getByText('(beaten)')).toBeInTheDocument()
    expect(screen.getByText('vanilla extract')).toBeInTheDocument()
    expect(screen.getByText('optional')).toBeInTheDocument()
  })

  it('renders a mixed-shape ingredient list (real-world DB state) without blank rows', async () => {
    mockFetchOnce({
      id: 'recipe-1',
      title: 'Mixed Recipe',
      ingredients: ['1 onion, diced', { name: 'olive oil', quantity: 2, unit: 'tbsp' }],
      instructions: ['Saute'],
    })

    render(<RecipeDetailPage />)

    expect(await screen.findByText('1 onion, diced')).toBeInTheDocument()
    expect(screen.getByText('2 tbsp olive oil')).toBeInTheDocument()
  })
})
