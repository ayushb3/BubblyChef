/**
 * Unit-conversion gaps (follow-up to #6) — a deduction worked out from a typical
 * weight, density or can size is shown as "≈", and the "imprecise" copy no longer
 * talks about packs, since most pack questions now resolve to an estimate.
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
    deduct_qty: 150,
    base_unit: 'g',
    substitution_note: null,
    ingredient_qty: 1,
    ingredient_unit: null,
    pantry_qty_available: 450,
    shortfall: null,
    ...over,
  }) as IngredientMatch

const proposalOf = (matches: IngredientMatch[]): CookReviewProposal => ({
  matches,
  missing: [],
  missing_notes: {},
  compound_suggestions: [],
  expired_items: [],
})

const renderBody = (proposal: CookReviewProposal) =>
  render(
    <CookReviewBody
      proposal={proposal}
      overrides={{}}
      onOverrideChange={jest.fn()}
      expiredDismissed
      onDismissExpired={jest.fn()}
    />,
  )

describe('approximate deduction', () => {
  it('shows an estimated amount with a leading ≈', () => {
    renderBody(
      proposalOf([match({ ingredient_name: 'onion', approximate: true, deduct_qty: 150 })]),
    )

    expect(screen.getByText('≈ 150 g')).toBeInTheDocument()
  })

  it('shows an exact amount as it always did, with no ≈', () => {
    renderBody(
      proposalOf([match({ ingredient_name: 'flour', approximate: false, deduct_qty: 200 })]),
    )

    expect(screen.getByText('200 g')).toBeInTheDocument()
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
  })

  it('treats a response without the field as exact', () => {
    renderBody(proposalOf([match({ ingredient_name: 'flour', deduct_qty: 200 })]))

    expect(screen.getByText('200 g')).toBeInTheDocument()
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
  })

  it('still deducts an estimated amount: it is a deduction, only labelled', () => {
    const summary = summariseDeductions(
      proposalOf([match({ pantry_item_id: 'p-onion', approximate: true, deduct_qty: 150 })]),
      {},
    )

    expect(summary.deductions).toEqual([
      { pantry_item_id: 'p-onion', deduct_qty: 150, base_unit: 'g' },
    ])
    expect(summary.skipped).toEqual([])
  })

  it('words the imprecise line as not working it out, not as a pack problem', () => {
    const proposal = proposalOf([
      match({ ingredient_name: 'bread', status: 'imprecise', deduct_qty: null }),
    ])

    render(<CookDeductionSummary summary={summariseDeductions(proposal, {})} mode="confirm" />)

    expect(
      screen.getByText(/we couldn.t work out how much the recipe uses/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/pack/i)).not.toBeInTheDocument()
  })
})
