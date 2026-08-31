/**
 * Issue #140: resolve actions — "Used it up" / "Tossed it" with recordable outcomes.
 *
 * Two surfaces, deliberately different: expiring and expired cards get visible
 * buttons because urgency earns the real estate, and every other card resolves
 * by a graduated swipe so normal stock stays visually clean.
 *
 * The swipe's safety property is the thing worth pinning — a short drag must
 * reveal without committing, because that graduation replaces the confirm
 * dialog the spec deliberately dropped.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import ResolveActions from '@/components/pantry/ResolveActions'
import SwipeToResolve, {
  COMMIT_DISTANCE,
  REVEAL_DISTANCE,
  gestureVerdict,
} from '@/components/pantry/SwipeToResolve'

describe('ResolveActions', () => {
  it('commits "used" on a single tap — the happy path is not gated', () => {
    const onResolve = jest.fn()
    render(<ResolveActions itemName="spinach" onResolve={onResolve} />)

    fireEvent.click(screen.getByRole('button', { name: /used up/i }))
    expect(onResolve).toHaveBeenCalledWith('used')
  })

  it('does not toss on first tap — it swaps to a confirm', () => {
    const onResolve = jest.fn()
    render(<ResolveActions itemName="spinach" onResolve={onResolve} />)

    fireEvent.click(screen.getByRole('button', { name: /tossed/i }))
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm spinach was tossed/i })).toBeInTheDocument()
  })

  it('commits "tossed" only after the confirm', () => {
    const onResolve = jest.fn()
    render(<ResolveActions itemName="spinach" onResolve={onResolve} />)

    fireEvent.click(screen.getByRole('button', { name: /tossed/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm spinach was tossed/i }))
    expect(onResolve).toHaveBeenCalledWith('tossed')
  })

  it('lets the user back out of the toss confirm', () => {
    const onResolve = jest.fn()
    render(<ResolveActions itemName="spinach" onResolve={onResolve} />)

    fireEvent.click(screen.getByRole('button', { name: /tossed/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /used up/i })).toBeInTheDocument()
  })

  it('disables both actions while a resolve is in flight', () => {
    render(<ResolveActions itemName="spinach" onResolve={jest.fn()} pending />)
    expect(screen.getByRole('button', { name: /used up/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /tossed/i })).toBeDisabled()
  })

  it('gives every action a 44px target', () => {
    // WCAG 2.5.5 — the labels stay text-xs so the 2-column grid doesn't reflow.
    render(<ResolveActions itemName="spinach" onResolve={jest.fn()} />)
    expect(screen.getByRole('button', { name: /used up/i }).className).toContain('min-h-[44px]')
    expect(screen.getByRole('button', { name: /tossed/i }).className).toContain('min-h-[44px]')
  })
})

describe('SwipeToResolve — gesture thresholds', () => {
  /**
   * The graduation IS the safety mechanism: the spec dropped the confirm dialog
   * on the grounds that a light swipe cannot commit. framer-motion's drag does
   * not run under jsdom, so this is tested through the pure decision function
   * rather than through a simulated pointer sequence that would assert nothing.
   */

  it('treats a stray touch as a no-op', () => {
    expect(gestureVerdict(0)).toEqual({ kind: 'reset' })
    expect(gestureVerdict(12)).toEqual({ kind: 'reset' })
    expect(gestureVerdict(-12)).toEqual({ kind: 'reset' })
  })

  it('reveals — but does not commit — at the reveal distance', () => {
    expect(gestureVerdict(REVEAL_DISTANCE)).toEqual({ kind: 'reveal', outcome: 'used' })
    expect(gestureVerdict(-REVEAL_DISTANCE)).toEqual({ kind: 'reveal', outcome: 'tossed' })
  })

  it('still only reveals just below the commit distance', () => {
    // The gap between the two thresholds is the whole safety margin.
    expect(gestureVerdict(COMMIT_DISTANCE - 1).kind).toBe('reveal')
    expect(gestureVerdict(-(COMMIT_DISTANCE - 1)).kind).toBe('reveal')
  })

  it('commits at and beyond the commit distance', () => {
    expect(gestureVerdict(COMMIT_DISTANCE)).toEqual({ kind: 'commit', outcome: 'used' })
    expect(gestureVerdict(400)).toEqual({ kind: 'commit', outcome: 'used' })
    expect(gestureVerdict(-COMMIT_DISTANCE)).toEqual({ kind: 'commit', outcome: 'tossed' })
    expect(gestureVerdict(-400)).toEqual({ kind: 'commit', outcome: 'tossed' })
  })

  it('maps right to used and left to tossed, never the reverse', () => {
    // Getting this backwards would silently bin food the user meant to keep.
    expect(gestureVerdict(200)).toEqual({ kind: 'commit', outcome: 'used' })
    expect(gestureVerdict(-200)).toEqual({ kind: 'commit', outcome: 'tossed' })
  })

  it('keeps reveal strictly below commit', () => {
    expect(REVEAL_DISTANCE).toBeLessThan(COMMIT_DISTANCE)
  })
})

describe('SwipeToResolve — rendering', () => {
  it('renders its child', () => {
    render(
      <SwipeToResolve itemName="rice" onResolve={jest.fn()}>
        <div>rice card</div>
      </SwipeToResolve>
    )
    expect(screen.getByText('rice card')).toBeInTheDocument()
  })

  it('offers both outcomes in the action layer', () => {
    render(
      <SwipeToResolve itemName="rice" onResolve={jest.fn()}>
        <div>rice card</div>
      </SwipeToResolve>
    )
    expect(screen.getByText(/Used it/)).toBeInTheDocument()
    expect(screen.getByText(/Tossed/)).toBeInTheDocument()
  })

  it('does not commit on mount', () => {
    const onResolve = jest.fn()
    render(
      <SwipeToResolve itemName="rice" onResolve={onResolve}>
        <div>rice card</div>
      </SwipeToResolve>
    )
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('hides the action layer from assistive tech', () => {
    // A screen-reader user must never be asked to perform a drag; the buttons
    // on urgent cards, and the reduced-motion fallback, are the accessible path.
    const { container } = render(
      <SwipeToResolve itemName="rice" onResolve={jest.fn()}>
        <div>rice card</div>
      </SwipeToResolve>
    )
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument()
  })
})
