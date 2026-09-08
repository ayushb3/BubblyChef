/**
 * Tests for the assumed-staples feature in CookModal (#305).
 *
 * Covers:
 * - summariseDeductions: assumed rows are not counted in matchedCount or deductions
 * - CookModal render: assumed rows are collapsed into one "Basics assumed:" line
 * - CookModal render: assumed items do NOT appear in the main ingredient table
 * - CookModal render: non-staple missing items still show the warning section
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { summariseDeductions, MissingItemsList } from '@/components/recipes/CookModal'
import type { CookProposal, IngredientMatch } from '@/types/recipes'

// Minimal mock helpers matching the pattern in cook-flow-redesign.test.tsx

const match = (over: Partial<IngredientMatch>): IngredientMatch =>
  ({
    ingredient_name: 'thing',
    pantry_item_id: 'p1',
    pantry_item_name: 'thing',
    status: 'ready',
    match_type: 'exact',
    deduct_qty: 10,
    base_unit: 'g',
    substitution_note: null,
    ingredient_qty: 10,
    ingredient_unit: 'g',
    pantry_qty_available: 50,
    shortfall: null,
    ...over,
  } as IngredientMatch)

const proposalOf = (
  matches: IngredientMatch[],
  missing: string[] = [],
): CookProposal =>
  ({
    recipe_id: 'r1',
    recipe_title: 'Test',
    matches,
    missing,
    unit_conflicts: [],
    compound_suggestions: [],
    missing_notes: {},
  } as unknown as CookProposal)

// ---------------------------------------------------------------------------
// summariseDeductions — assumed rows
// ---------------------------------------------------------------------------

describe('summariseDeductions — assumed staples (#305)', () => {
  it('assumed rows are not included in matchedCount', () => {
    const p = proposalOf([
      match({ ingredient_name: 'pasta', pantry_item_id: 'p1', status: 'ready', deduct_qty: 50 }),
      match({ ingredient_name: 'salt', pantry_item_id: null, status: 'assumed', deduct_qty: null }),
    ])
    const { matchedCount, deductions } = summariseDeductions(p, {})
    // Only the ready pasta row counts; assumed row has null pantry_item_id → skipped
    expect(matchedCount).toBe(1)
    expect(deductions).toHaveLength(1)
    expect(deductions[0].pantry_item_id).toBe('p1')
  })

  it('assumed rows do not appear in the skipped list', () => {
    const p = proposalOf([
      match({ ingredient_name: 'salt', pantry_item_id: null, status: 'assumed', deduct_qty: null }),
    ])
    const { skipped } = summariseDeductions(p, {})
    expect(skipped).toHaveLength(0)
  })

  it('assumed rows and real missing rows both leave deductions empty', () => {
    const p = proposalOf(
      [
        match({ ingredient_name: 'salt', pantry_item_id: null, status: 'assumed', deduct_qty: null }),
      ],
      ['truffle oil'],
    )
    const { deductions } = summariseDeductions(p, {})
    expect(deductions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// CookModal rendering — assumed staples collapsed
// ---------------------------------------------------------------------------

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/lib/api/recipes', () => ({
  cookRecipe: jest.fn(),
  confirmCook: jest.fn(),
}))
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
    button: ({
      children,
      ...rest
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import CookModal from '@/components/recipes/CookModal'
const { cookRecipe: mockCookRecipe } = jest.requireMock('@/lib/api/recipes') as {
  cookRecipe: jest.Mock
}

const assumedProposal = (assumedNames: string[], nonStapleMissing: string[] = []): CookProposal => ({
  recipe_id: 'r1',
  recipe_title: 'Simple Pasta',
  matches: [
    match({ ingredient_name: 'pasta', pantry_item_id: 'p1', status: 'ready', deduct_qty: 200 }),
    ...assumedNames.map((n) =>
      match({
        ingredient_name: n,
        pantry_item_id: null,
        status: 'assumed',
        deduct_qty: null,
        base_unit: null,
      }),
    ),
  ],
  missing: nonStapleMissing,
  unit_conflicts: [],
  compound_suggestions: [],
  missing_notes: {},
} as unknown as CookProposal)

describe('CookModal — assumed staples rendering (#305)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the "Basics assumed:" summary line with staple names', async () => {
    mockCookRecipe.mockResolvedValue(assumedProposal(['salt', 'black pepper', 'olive oil']))

    render(
      <CookModal recipeId="r1" recipeTitle="Simple Pasta" onClose={jest.fn()} onCooked={jest.fn()} />,
    )

    const summary = await screen.findByLabelText(/assumed culinary staples/i)
    expect(summary).toBeInTheDocument()
    expect(summary.textContent).toMatch(/salt/i)
    expect(summary.textContent).toMatch(/black pepper/i)
    expect(summary.textContent).toMatch(/olive oil/i)
  })

  it('does NOT show assumed items in the main ingredient table rows', async () => {
    mockCookRecipe.mockResolvedValue(assumedProposal(['salt']))

    render(
      <CookModal recipeId="r1" recipeTitle="Simple Pasta" onClose={jest.fn()} onCooked={jest.fn()} />,
    )

    await screen.findByLabelText(/assumed culinary staples/i)

    // The table should contain pasta (the real match) but NOT a row badge saying "Assumed"
    // The badge label "Assumed" must not appear inside a table cell
    const assumedBadges = screen.queryAllByText(/^Assumed$/)
    expect(assumedBadges).toHaveLength(0)
  })

  it('does NOT render the "Basics assumed:" line when no assumed items exist', async () => {
    mockCookRecipe.mockResolvedValue(assumedProposal([]))

    render(
      <CookModal recipeId="r1" recipeTitle="Simple Pasta" onClose={jest.fn()} onCooked={jest.fn()} />,
    )

    // Wait for the loading state to resolve
    await screen.findByText(/pasta/i)

    expect(screen.queryByLabelText(/assumed culinary staples/i)).not.toBeInTheDocument()
  })

  it('shows missing section for non-staple missing items alongside assumed summary', async () => {
    mockCookRecipe.mockResolvedValue(assumedProposal(['salt'], ['truffle oil']))

    render(
      <CookModal recipeId="r1" recipeTitle="Simple Pasta" onClose={jest.fn()} onCooked={jest.fn()} />,
    )

    await screen.findByLabelText(/assumed culinary staples/i)
    expect(screen.getByText(/⚠️ truffle oil/i)).toBeInTheDocument()
  })
})
