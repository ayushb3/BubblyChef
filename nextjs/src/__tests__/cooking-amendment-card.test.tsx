/**
 * Issues #303 (folded into #489) + #490 — the in-thread "Update what I'm
 * cooking" card: the amended list, one confirm, one decline, and a terminal
 * state that is never a live button after the amendment went through.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import CookingAmendmentCard from '@/components/chat/CookingAmendmentCard'
import type { RecipeAmendmentProposal } from '@/types/chat'

jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
      const { initial: _i, animate: _a, transition: _t, exit: _e, ...safe } = rest as Record<string, unknown>
      return React.createElement(Tag, safe, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) })
  // `useReducedMotion` is read by PixelPanel (the card's frame, issue #746).
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  }
})

const PROPOSAL: RecipeAmendmentProposal = {
  proposal_type: 'recipe_amendment',
  is_amendment: true,
  amended_ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g', optional: false, notes: null },
    { name: 'butter', quantity: 30, unit: 'g', optional: false, notes: null },
    { name: 'parsley', quantity: 1, unit: 'tbsp', optional: true, notes: null },
  ],
  change_summary: 'Swapped the cream for a butter and flour roux.',
  recipe_id: 'r1',
  recipe_title: 'Creamy pasta',
}

function setup(over: Partial<React.ComponentProps<typeof CookingAmendmentCard>> = {}) {
  const onApply = jest.fn()
  const onDismiss = jest.fn()
  render(
    <CookingAmendmentCard
      proposal={PROPOSAL}
      state="pending"
      actionable
      onApply={onApply}
      onDismiss={onDismiss}
      {...over}
    />,
  )
  return { onApply, onDismiss }
}

describe('CookingAmendmentCard', () => {
  it('shows the change summary and the full amended list, optional lines marked', () => {
    setup()
    expect(screen.getByText(/swapped the cream for a butter and flour roux/i)).toBeInTheDocument()
    expect(screen.getByText('Pasta')).toBeInTheDocument()
    expect(screen.getByText('Butter')).toBeInTheDocument()
    expect(screen.getByText('30 g')).toBeInTheDocument()
    expect(screen.getByText(/\(optional\)/i)).toBeInTheDocument()
  })

  it('pending: Update what I\'m cooking applies, Keep original declines', () => {
    const { onApply, onDismiss } = setup()
    fireEvent.click(screen.getByRole('button', { name: /update what i'm cooking/i }))
    expect(onApply).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /keep original/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('applying: both buttons are disabled so a second tap cannot fire', () => {
    const { onApply } = setup({ state: 'applying' })
    const apply = screen.getByRole('button', { name: /updating/i })
    expect(apply).toBeDisabled()
    expect(screen.getByRole('button', { name: /keep original/i })).toBeDisabled()
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('applied: a terminal status, no buttons, and it says the pantry update will use it', () => {
    setup({ state: 'applied' })
    expect(screen.getByRole('status')).toHaveTextContent(/updated/i)
    expect(screen.getByRole('status')).toHaveTextContent(/pantry/i)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('dismissed: says the original was kept, no buttons', () => {
    setup({ state: 'dismissed' })
    expect(screen.getByRole('status')).toHaveTextContent(/kept the original/i)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('failed: shows the reason and offers a retry that applies again', () => {
    const { onApply } = setup({ state: 'failed', errorMessage: 'Could not update. Try again.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not update. Try again.')
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('pending but no longer actionable (a stale or restored card): no buttons, says it was not applied', () => {
    setup({ actionable: false })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/not applied/i)
  })

  it('a card that is actionable:false but applied still reads as applied', () => {
    setup({ state: 'applied', actionable: false })
    expect(screen.getByRole('status')).toHaveTextContent(/updated/i)
  })
})
