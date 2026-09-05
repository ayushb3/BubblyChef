/**
 * Issue #303: CookingAmendmentCard renders a proposal for ingredient amendments
 * when the backend emits a cooking_help response with requires_review=true.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import CookingAmendmentCard from '@/components/chat/CookingAmendmentCard'
import type { RecipeAmendmentProposal } from '@/types/chat'

const PROPOSAL: RecipeAmendmentProposal = {
  is_amendment: true,
  change_summary: 'Replaced cream with milk',
  amended_ingredients: [
    { name: 'milk', quantity: 250, unit: 'ml', optional: false, notes: null },
    { name: 'butter', quantity: 2, unit: 'tbsp', optional: false, notes: null },
    { name: 'parsley', quantity: 1, unit: 'tbsp', optional: true, notes: 'for garnish' },
  ],
}

describe('CookingAmendmentCard', () => {
  it('renders all ingredients from the proposal', () => {
    render(
      <CookingAmendmentCard
        proposal={PROPOSAL}
        onApply={jest.fn()}
        onDismiss={jest.fn()}
        state="pending"
      />
    )
    // Each name is rendered by titleCase — check at least one element matches each name.
    expect(screen.getAllByText(/Milk/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Butter/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Parsley/i).length).toBeGreaterThan(0)
  })

  it('shows the change_summary in the header', () => {
    render(
      <CookingAmendmentCard
        proposal={PROPOSAL}
        onApply={jest.fn()}
        onDismiss={jest.fn()}
        state="pending"
      />
    )
    expect(screen.getByText('Replaced cream with milk')).toBeInTheDocument()
  })

  it('falls back to "Recipe updated" when change_summary is null', () => {
    const noSummary: RecipeAmendmentProposal = { ...PROPOSAL, change_summary: null }
    render(
      <CookingAmendmentCard
        proposal={noSummary}
        onApply={jest.fn()}
        onDismiss={jest.fn()}
        state="pending"
      />
    )
    expect(screen.getByText('Recipe updated')).toBeInTheDocument()
  })

  it('calls onApply when "Update what I\'m cooking" is clicked', () => {
    const onApply = jest.fn()
    render(
      <CookingAmendmentCard
        proposal={PROPOSAL}
        onApply={onApply}
        onDismiss={jest.fn()}
        state="pending"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /update what i'm cooking/i }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when "Keep original" is clicked', () => {
    const onDismiss = jest.fn()
    render(
      <CookingAmendmentCard
        proposal={PROPOSAL}
        onApply={jest.fn()}
        onDismiss={onDismiss}
        state="pending"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /keep original/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows "Recipe updated!" and hides action buttons when state is applied', () => {
    render(
      <CookingAmendmentCard
        proposal={PROPOSAL}
        onApply={jest.fn()}
        onDismiss={jest.fn()}
        state="applied"
      />
    )
    expect(screen.getByText('Recipe updated!')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /update what i'm cooking/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep original/i })).not.toBeInTheDocument()
  })

  it('shows "Kept original" and hides action buttons when state is dismissed', () => {
    render(
      <CookingAmendmentCard
        proposal={PROPOSAL}
        onApply={jest.fn()}
        onDismiss={jest.fn()}
        state="dismissed"
      />
    )
    expect(screen.getByText('Kept original')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /update what i'm cooking/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep original/i })).not.toBeInTheDocument()
  })

  it('marks optional ingredients with "(optional)"', () => {
    render(
      <CookingAmendmentCard
        proposal={PROPOSAL}
        onApply={jest.fn()}
        onDismiss={jest.fn()}
        state="pending"
      />
    )
    expect(screen.getByText('(optional)')).toBeInTheDocument()
  })
})
