/**
 * Issue #650 / #744 — the compact meal card in chat: Open meal, Save meal, and the
 * "a second tap never creates a second meal" guard (asserted at the
 * component level as "the button disables the instant it's tapped, and
 * onOpenMeal/onSaveMeal each fire at most once per render" — the actual
 * create-once guarantee lives in `ensureMeal` in `app/chat/page.tsx`,
 * covered by `chat-meal-card-actions.test.tsx`).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import RecipeCard, { compactPropsFromProposal, type CompactCardProps } from '@/components/recipes/RecipeCard'
import type { MealProposal } from '@/types/chat'

/**
 * Issue #744: the old CompactMealCard is the `compact` variant of the one recipe
 * card. This adapter keeps these behaviour tests on the old prop names so they
 * run unchanged against the new card.
 */
function CompactMealCard({
  proposal,
  onOpenMeal,
  onSaveMeal,
  ...rest
}: { proposal: MealProposal; onOpenMeal: () => void; onSaveMeal: () => void } & Partial<CompactCardProps>) {
  return (
    <RecipeCard
      variant="compact"
      {...compactPropsFromProposal(proposal)}
      onOpen={onOpenMeal}
      onSave={onSaveMeal}
      {...rest}
    />
  )
}

const PROPOSAL: MealProposal = {
  proposal_type: 'meal',
  title: 'Lemon chicken dinner',
  servings: 2,
  constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
  dishes: [
    { role: 'main', position: 0, recipe: { title: 'Lemon butter chicken' } },
    { role: 'side', position: 1, recipe: { title: 'Buttered orzo' } },
  ],
  missing_ingredients: ['parsley'],
}

describe('CompactMealCard', () => {
  beforeAll(() => {
    // jsdom has no layout engine, so scrollIntoView isn't implemented —
    // matches the stub other chat suites use (chat-meal-card-actions.test.tsx).
    Element.prototype.scrollIntoView = jest.fn()
  })

  // The stub above is one shared mock on the prototype (not per-element), so
  // clear its call count between tests — otherwise the focusSaveToken tests'
  // "called once" assertions pick up calls left over from earlier tests.
  beforeEach(() => {
    ;(Element.prototype.scrollIntoView as jest.Mock).mockClear()
  })

  it('renders the title and every dish, main first', () => {
    render(<CompactMealCard proposal={PROPOSAL} onOpenMeal={jest.fn()} onSaveMeal={jest.fn()} />)
    expect(screen.getByText('Lemon chicken dinner')).toBeInTheDocument()
    // One meta line (the board's compact card has no per-dish role tags).
    expect(screen.getByText('Lemon butter chicken · Buttered orzo')).toBeInTheDocument()
  })

  it('shows missing ingredients when present', () => {
    render(<CompactMealCard proposal={PROPOSAL} onOpenMeal={jest.fn()} onSaveMeal={jest.fn()} />)
    expect(screen.getByText('1 to buy')).toBeInTheDocument()
    expect(screen.getByText(/parsley/)).toBeInTheDocument()
  })

  it('calls onOpenMeal when Open meal is tapped', () => {
    const onOpenMeal = jest.fn()
    render(<CompactMealCard proposal={PROPOSAL} onOpenMeal={onOpenMeal} onSaveMeal={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Open meal/ }))
    expect(onOpenMeal).toHaveBeenCalledTimes(1)
  })

  it('calls onSaveMeal when Save meal is tapped', () => {
    const onSaveMeal = jest.fn()
    render(<CompactMealCard proposal={PROPOSAL} onOpenMeal={jest.fn()} onSaveMeal={onSaveMeal} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save meal' }))
    expect(onSaveMeal).toHaveBeenCalledTimes(1)
  })

  it('disables Open meal once its state leaves idle, so a second tap cannot fire onOpenMeal again', () => {
    const onOpenMeal = jest.fn()
    const { rerender } = render(
      <CompactMealCard proposal={PROPOSAL} onOpenMeal={onOpenMeal} onSaveMeal={jest.fn()} openState="pending" />,
    )
    const button = screen.getByRole('button', { name: 'Opening…' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onOpenMeal).not.toHaveBeenCalled()

    rerender(
      <CompactMealCard proposal={PROPOSAL} onOpenMeal={onOpenMeal} onSaveMeal={jest.fn()} openState="opened" />,
    )
    const opened = screen.getByRole('button', { name: '✓ Opened' })
    expect(opened).toBeDisabled()
    fireEvent.click(opened)
    expect(onOpenMeal).not.toHaveBeenCalled()
  })

  it('disables Save meal while saving and once saved, so a second tap cannot fire onSaveMeal again', () => {
    const onSaveMeal = jest.fn()
    const { rerender } = render(
      <CompactMealCard proposal={PROPOSAL} onOpenMeal={jest.fn()} onSaveMeal={onSaveMeal} saveState="saving" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }))
    expect(onSaveMeal).not.toHaveBeenCalled()

    rerender(
      <CompactMealCard proposal={PROPOSAL} onOpenMeal={jest.fn()} onSaveMeal={onSaveMeal} saveState="saved" />,
    )
    fireEvent.click(screen.getByRole('button', { name: '✓ Saved!' }))
    expect(onSaveMeal).not.toHaveBeenCalled()
  })

  describe('focusSaveToken (issue #651 — the "Save this meal" pill)', () => {
    it('bumping it focuses the Save meal button, scrolls it into view, and highlights it', () => {
      const { rerender } = render(
        <CompactMealCard
          proposal={PROPOSAL}
          onOpenMeal={jest.fn()}
          onSaveMeal={jest.fn()}
          focusSaveToken={0}
        />,
      )
      const button = screen.getByRole('button', { name: 'Save meal' })
      expect(button).not.toHaveFocus()

      rerender(
        <CompactMealCard
          proposal={PROPOSAL}
          onOpenMeal={jest.fn()}
          onSaveMeal={jest.fn()}
          focusSaveToken={1}
        />,
      )

      expect(button).toHaveFocus()
      expect(button.scrollIntoView).toHaveBeenCalledTimes(1)
      expect(button.className).toMatch(/ring-2/)
    })

    it('re-rendering with the same token does nothing further', () => {
      const { rerender } = render(
        <CompactMealCard
          proposal={PROPOSAL}
          onOpenMeal={jest.fn()}
          onSaveMeal={jest.fn()}
          focusSaveToken={1}
        />,
      )
      const button = screen.getByRole('button', { name: 'Save meal' })
      const scrollSpy = button.scrollIntoView as jest.Mock
      const callsAfterFirstMount = scrollSpy.mock.calls.length

      button.blur()
      rerender(
        <CompactMealCard
          proposal={PROPOSAL}
          onOpenMeal={jest.fn()}
          onSaveMeal={jest.fn()}
          focusSaveToken={1}
        />,
      )

      expect(scrollSpy).toHaveBeenCalledTimes(callsAfterFirstMount)
      expect(button).not.toHaveFocus()
    })

    it('is a no-op while the Save meal button is disabled (saveState saved)', () => {
      render(
        <CompactMealCard
          proposal={PROPOSAL}
          onOpenMeal={jest.fn()}
          onSaveMeal={jest.fn()}
          saveState="saved"
          focusSaveToken={1}
        />,
      )
      const button = screen.getByRole('button', { name: '✓ Saved!' })
      expect(button).not.toHaveFocus()
      expect(button.scrollIntoView).not.toHaveBeenCalled()
    })
  })
})
