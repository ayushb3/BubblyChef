/**
 * Issue #444 — one key for a pantry-proposal row: `proposalActionKey`, the
 * name trimmed and lower-cased. The server records applied and failed rows by
 * that key, so every place that matches rows by name must use the same
 * expression, or "Spinach " and "spinach" become two rows and can both write.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import PantryProposalCard from '@/components/chat/PantryProposalCard'
import { filterResolvedTerms, mergeActions } from '@/types/chat'
import type { PantryProposalAction } from '@/types/chat'

const row = (name: string, quantity: number, unit = 'item'): PantryProposalAction => ({
  action_type: 'add',
  item: { name, quantity, unit },
  confidence: 0.9,
})

describe('mergeActions', () => {
  it('merges "Spinach " and "spinach" into one row, the newer values winning', () => {
    expect(mergeActions([row('Spinach ', 1)], [row('spinach', 3)])).toEqual([row('spinach', 3)])
  })
})

describe('filterResolvedTerms', () => {
  it('treats a padded action name as the suggestion it resolves', () => {
    const terms = [{ term: 'veggies', suggestions: ['Spinach', 'Carrot'] }]
    expect(filterResolvedTerms(terms, [row(' spinach ', 1)])).toEqual([])
  })
})

describe('PantryProposalCard reconcile', () => {
  it('keeps an inline edit when the same row comes back under a padded or differently cased name', () => {
    const onActionsChange = jest.fn()
    const card = (spinach: string) => (
      <PantryProposalCard
        proposal={{ actions: [row(spinach, 1), row('Milk', 1)] }}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        state="pending"
        onActionsChange={onActionsChange}
      />
    )
    const { rerender } = render(card('Spinach '))
    const spinachQty = screen.getByRole('spinbutton', { name: /quantity for spinach/i })
    fireEvent.change(spinachQty, { target: { value: '3' } })
    fireEvent.blur(spinachQty)

    // The same row returns as "spinach"; the edit above must survive.
    rerender(card('spinach'))
    const milkQty = screen.getByRole('spinbutton', { name: /quantity for milk/i })
    fireEvent.change(milkQty, { target: { value: '2' } })
    fireEvent.blur(milkQty)

    const sent = onActionsChange.mock.calls[onActionsChange.mock.calls.length - 1][0] as PantryProposalAction[]
    expect(sent.find((a) => a.item.name.trim().toLowerCase() === 'spinach')?.item.quantity).toBe(3)
  })
})
