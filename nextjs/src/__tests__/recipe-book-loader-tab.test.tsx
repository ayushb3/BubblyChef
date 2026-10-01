/**
 * Issue #675 — deleting a meal lands the user on `/recipes?tab=meals`, so the
 * library's Meals tab (`RecipeBookLoader`) has to honour `?tab=meals`. Any
 * other value (or none) keeps the default Recipes tab.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'

let mockTab: string | null = null
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? mockTab : null) }),
}))

jest.mock('@/components/recipes/MealsList', () => ({
  __esModule: true,
  default: () => <div data-testid="meals-list" />,
}))
jest.mock('@/components/recipes/RecipeBook', () => ({
  __esModule: true,
  default: () => <div data-testid="recipe-book" />,
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecipeBookLoader = require('@/components/recipes/RecipeBookLoader').default as () => React.JSX.Element

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ recipes: [] }) }) as unknown as typeof fetch
})

describe('RecipeBookLoader ?tab= (issue #675)', () => {
  it('opens on the Meals tab for ?tab=meals', () => {
    mockTab = 'meals'
    render(<RecipeBookLoader />)
    expect(screen.getByRole('tab', { name: /Meals/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('meals-list')).toBeInTheDocument()
  })

  it('defaults to the Recipes tab with no param', () => {
    mockTab = null
    render(<RecipeBookLoader />)
    expect(screen.getByRole('tab', { name: /Recipes/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('meals-list')).not.toBeInTheDocument()
  })

  it('ignores an unknown tab value', () => {
    mockTab = 'banana'
    render(<RecipeBookLoader />)
    expect(screen.getByRole('tab', { name: /Recipes/ })).toHaveAttribute('aria-selected', 'true')
  })
})
