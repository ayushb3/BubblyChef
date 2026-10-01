/**
 * Issue #756 — a seasoning line with no amount ("salt and pepper", "to taste")
 * shows as one quiet "Not deducted: to taste" line. It is not a table row, not a
 * unit conflict, and not part of the footer counts.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import {
  CookReviewBody,
  CookDeductionSummary,
  summariseDeductions,
} from '@/components/recipes/CookReviewBody'
import type { CookReviewProposal } from '@/components/recipes/CookReviewBody'
import type { IngredientMatch } from '@/types/recipes'

const match = (over: Partial<IngredientMatch>): IngredientMatch =>
  ({
    ingredient_name: 'thing',
    pantry_item_id: 'p1',
    pantry_item_name: 'thing',
    status: 'ready',
    match_type: 'exact',
    deduct_qty: 1,
    base_unit: 'count',
    substitution_note: null,
    ingredient_qty: 1,
    ingredient_unit: 'count',
    pantry_qty_available: 3,
    shortfall: null,
    ...over,
  }) as IngredientMatch

const toTaste = (name: string): IngredientMatch =>
  match({
    ingredient_name: name,
    pantry_item_id: null,
    pantry_item_name: null,
    status: 'to_taste',
    match_type: 'none',
    deduct_qty: null,
    base_unit: null,
    ingredient_qty: null,
    ingredient_unit: null,
    pantry_qty_available: null,
  })

const proposalOf = (matches: IngredientMatch[]): CookReviewProposal => ({
  matches,
  missing: [],
  missing_notes: {},
  compound_suggestions: [],
  expired_items: [],
})

describe('to-taste seasoning line (#756)', () => {
  it('is left out of the footer counts and the not-deducted list', () => {
    const proposal = proposalOf([
      match({ ingredient_name: 'lemon', pantry_item_id: 'p-lemon' }),
      toTaste('salt and pepper'),
    ])

    const summary = summariseDeductions(proposal, {})

    expect(summary.matchedCount).toBe(1)
    expect(summary.matchesDeductionCount).toBe(1)
    expect(summary.skipped).toEqual([])
    expect(summary.deductions).toHaveLength(1)
  })

  it('never lets a to-taste row count even if it carried a pantry id', () => {
    const proposal = proposalOf([match({ status: 'to_taste', pantry_item_id: 'p-salt' })])

    const summary = summariseDeductions(proposal, {})

    expect(summary.matchedCount).toBe(0)
    expect(summary.skipped).toEqual([])
  })

  it('renders one quiet line, with no table row, badge or quantity box for it', () => {
    render(
      <CookReviewBody
        proposal={proposalOf([
          match({ ingredient_name: 'lemon', pantry_item_id: 'p-lemon' }),
          toTaste('salt and pepper'),
        ])}
        overrides={{}}
        onOverrideChange={jest.fn()}
        expiredDismissed
        onDismissExpired={jest.fn()}
      />,
    )

    const line = screen.getByLabelText(/seasonings to taste/i)
    expect(line.textContent).toBe('Not deducted: to taste (salt and pepper)')
    expect(screen.queryByText('Unit conflict')).not.toBeInTheDocument()
    expect(screen.queryByText('To taste')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/deduct quantity for salt and pepper/i)).not.toBeInTheDocument()
    // Only the lemon is a table row.
    expect(screen.getAllByRole('row')).toHaveLength(2) // header + lemon
  })

  it('renders no table at all when to-taste is the only line, and no footer warning', () => {
    const proposal = proposalOf([toTaste('salt and pepper')])

    render(
      <>
        <CookReviewBody
          proposal={proposal}
          overrides={{}}
          onOverrideChange={jest.fn()}
          expiredDismissed
          onDismissExpired={jest.fn()}
        />
        <CookDeductionSummary summary={summariseDeductions(proposal, {})} mode="confirm" />
      </>,
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/seasonings to taste/i)).toBeInTheDocument()
    expect(screen.queryByText(/not deducted: salt/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ingredient/i)).not.toBeInTheDocument()
  })

  it('renders no line when nothing is to taste', () => {
    render(
      <CookReviewBody
        proposal={proposalOf([match({})])}
        overrides={{}}
        onOverrideChange={jest.fn()}
        expiredDismissed
        onDismissExpired={jest.fn()}
      />,
    )

    expect(screen.queryByLabelText(/seasonings to taste/i)).not.toBeInTheDocument()
  })
})
