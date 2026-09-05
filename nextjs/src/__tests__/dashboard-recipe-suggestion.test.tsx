/**
 * Regression tests for GitHub issue #306.
 *
 * Before the fix, HeroHome's "Open recipe" action linked to the bare `/recipes`
 * list, regardless of which recipe was surfaced. The defect meant users landed on
 * a list page instead of the specific recipe, and the "Feel like trying X?" copy
 * had no corresponding deep link.
 *
 * These tests verify:
 *  1. When the recipe list is non-empty, the hero action href is `/recipes/<id>`
 *     (not the bare `/recipes` list).
 *  2. When the recipe list is empty, no recipe suggestion card appears and no
 *     error is thrown.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import HeroHome from '@/components/dashboard/HeroHome'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('HeroHome recipe-suggestion href (#306)', () => {
  const recipe = {
    id: 'recipe-abc-123',
    title: 'Lemon Garlic Pasta',
    total_time_minutes: 25,
  }

  beforeEach(() => {
    // Match the stub pattern used in deep-link-entrypoints.test.tsx:
    // url-pattern dispatch on the three fetches HeroHome fires in parallel.
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) {
        return jsonResponse({ items: [], count: 0 })
      }
      if (url.includes('/api/pantry')) {
        return jsonResponse({ items: [{ id: 'p1', name: 'eggs' }], total_count: 1 })
      }
      // /api/recipes — return one recipe so the suggestion branch is entered.
      return jsonResponse({ recipes: [recipe], total_count: 1 })
    }) as unknown as typeof fetch
  })

  it('links the hero action to the specific recipe, not the bare list (#306 regression)', async () => {
    render(<HeroHome displayName="ayush" />)

    // Wait for the data-dependent hero to paint (loading skeleton disappears).
    const link = await screen.findByRole('link', { name: /open recipe/i })
    // THE CORE ASSERTION: href must be the specific-recipe deep link.
    expect(link.getAttribute('href')).toBe(`/recipes/${recipe.id}`)
    // Guard against the pre-fix regression: bare /recipes is wrong.
    expect(link.getAttribute('href')).not.toBe('/recipes')
  })

  it('surfaces the recipe title in the hero message', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() =>
      expect(screen.getByText(/lemon garlic pasta/i)).toBeInTheDocument()
    )
  })
})

describe('HeroHome empty recipe list (#306)', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) {
        return jsonResponse({ items: [], count: 0 })
      }
      if (url.includes('/api/pantry')) {
        // Non-empty pantry so the "empty pantry" branch doesn't fire, forcing
        // the recipe-absent fallback to be exercised.
        return jsonResponse({ items: [{ id: 'p1', name: 'eggs' }], total_count: 1 })
      }
      // No saved recipes.
      return jsonResponse({ recipes: [], total_count: 0 })
    }) as unknown as typeof fetch
  })

  it('does not render an "Open recipe" link when the list is empty', async () => {
    render(<HeroHome displayName="ayush" />)

    // Wait for the skeleton to clear so we know the resolved state is rendered.
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    )
    // The skeleton resolves but no recipe link must appear.
    expect(screen.queryByRole('link', { name: /open recipe/i })).toBeNull()
  })

  it('renders without throwing when pickRandomRecipe returns null', async () => {
    // If this test passes, the null-guard in HeroHome is working correctly.
    expect(() => render(<HeroHome displayName="ayush" />)).not.toThrow()
  })
})
