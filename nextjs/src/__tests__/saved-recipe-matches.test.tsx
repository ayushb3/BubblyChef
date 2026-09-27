/**
 * Issue #494: saved-recipe search results render as tappable cards, robust
 * to whatever count the backend returns — zero, one, or many matches.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import SavedRecipeMatches from '@/components/chat/SavedRecipeMatches'
import type { SavedRecipeMatch } from '@/types/chat'

const ONE: SavedRecipeMatch[] = [
  { id: 'r1', title: 'Butter Chicken', description: 'Creamy tomato curry.', cuisine: 'Indian' },
]

const MANY: SavedRecipeMatch[] = [
  { id: 'r1', title: 'Butter Chicken', description: 'Creamy tomato curry.', cuisine: 'Indian' },
  { id: 'r2', title: 'Chicken Tikka Masala', description: 'Smoky and rich.', cuisine: 'Indian' },
  { id: 'r3', title: 'Chicken Curry', cuisine: 'Indian' },
]

describe('SavedRecipeMatches', () => {
  // ── Zero ───────────────────────────────────────────────────────────────
  it('renders nothing when there are no matches', () => {
    const { container } = render(
      <SavedRecipeMatches matches={[]} onSelect={jest.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  // ── One ────────────────────────────────────────────────────────────────
  it('renders a single card with an Open recipe link and a Cook this button', () => {
    render(<SavedRecipeMatches matches={ONE} onSelect={jest.fn()} />)
    expect(screen.getByText('Butter Chicken')).toBeInTheDocument()
    const openLink = screen.getByRole('link', { name: 'Open recipe' })
    expect(openLink).toHaveAttribute('href', '/recipes/r1')
    // Cook this is a <button>, not a <Link> — see the PR #614 round-4 note
    // below: it defers entirely to the shared onSelect handler instead of
    // owning its own navigation/cook-session logic.
    expect(screen.getByRole('button', { name: 'Cook this' })).toBeInTheDocument()
  })

  it('does not render a picker list for a single match', () => {
    render(<SavedRecipeMatches matches={ONE} onSelect={jest.fn()} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('disables the single card actions when not the latest message', () => {
    render(<SavedRecipeMatches matches={ONE} onSelect={jest.fn()} disabled />)
    const openLink = screen.getByRole('link', { name: 'Open recipe' })
    expect(openLink).toHaveAttribute('aria-disabled', 'true')
    expect(openLink.className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: 'Cook this' })).toBeDisabled()
  })

  it('calls onSelect with the match when Cook this is tapped (single match)', () => {
    // PR #614 round 4: the single-match card's Cook this button must route
    // through the exact same onSelect callback the many-match tap uses —
    // one function (handlePickSavedRecipe in app/chat/page.tsx) owns
    // starting the cook session, clearing a stale dismissal, and pinning
    // via router.replace, so the two entry points cannot drift out of sync
    // again the way they did across rounds 2 and 3 (each fix landed in only
    // one of the two paths).
    const onSelect = jest.fn()
    render(<SavedRecipeMatches matches={ONE} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cook this' }))
    expect(onSelect).toHaveBeenCalledWith(ONE[0])
  })

  it('does not call onSelect when the disabled Cook this button is tapped', () => {
    const onSelect = jest.fn()
    render(<SavedRecipeMatches matches={ONE} onSelect={onSelect} disabled />)
    const button = screen.getByRole('button', { name: 'Cook this' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onSelect).not.toHaveBeenCalled()
  })

  // ── Many ───────────────────────────────────────────────────────────────
  it('renders one card per match, in backend-returned order', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Butter Chicken')
    expect(items[1]).toHaveTextContent('Chicken Tikka Masala')
    expect(items[2]).toHaveTextContent('Chicken Curry')
  })

  // Ayush's decision (2026-09-27): tapping a mini card in the many-match list
  // must NOT act on the recipe directly any more — it expands inline into
  // that recipe's single-match card (the same component the one-match case
  // renders), with the same Open recipe / Cook this actions. Nothing starts
  // cooking until Cook this is pressed. This replaces the earlier behavior
  // (PR #614 rounds 1-4) where tapping a mini card called onSelect straight
  // away and jumped into a cooking session with no way to preview or back out.
  it('does not call onSelect when a mini card is tapped — it expands instead', () => {
    const onSelect = jest.fn()
    render(<SavedRecipeMatches matches={MANY} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${MANY[1].title}` }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('expands the tapped mini card into its single-match card with both actions', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} />)
    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${MANY[1].title}` }))

    // The expanded card reuses SingleMatchCard: same Open recipe link and
    // Cook this button, now scoped to the tapped match.
    const openLink = screen.getByRole('link', { name: 'Open recipe' })
    expect(openLink).toHaveAttribute('href', `/recipes/${MANY[1].id}`)
    expect(screen.getByRole('button', { name: 'Cook this' })).toBeInTheDocument()
    // Only two mini cards remain tappable — the expanded one is no longer
    // rendered as a "Pick X" affordance button.
    expect(screen.queryByRole('listitem', { name: `Pick ${MANY[1].title}` })).not.toBeInTheDocument()
  })

  it('calls onSelect with the match when Cook this is tapped inside the expanded card', () => {
    const onSelect = jest.fn()
    render(<SavedRecipeMatches matches={MANY} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${MANY[1].title}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Cook this' }))
    expect(onSelect).toHaveBeenCalledWith(MANY[1])
  })

  it('switches the expansion when a different mini card is tapped', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} />)

    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${MANY[0].title}` }))
    expect(screen.getByRole('link', { name: 'Open recipe' })).toHaveAttribute(
      'href',
      `/recipes/${MANY[0].id}`,
    )

    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${MANY[2].title}` }))
    expect(screen.getByRole('link', { name: 'Open recipe' })).toHaveAttribute(
      'href',
      `/recipes/${MANY[2].id}`,
    )
    // Only one card is expanded at a time.
    expect(screen.getAllByRole('link', { name: 'Open recipe' })).toHaveLength(1)
    // The previously-expanded card is back to being a tappable mini card.
    expect(screen.getByRole('listitem', { name: `Pick ${MANY[0].title}` })).toBeInTheDocument()
  })

  it('expands via the keyboard (Enter/Space activate the mini card button)', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} />)
    const card = screen.getByRole('listitem', { name: `Pick ${MANY[0].title}` })
    // The mini card is a real <button>, so Enter/Space activation is native
    // browser behavior — fireEvent.click is the faithful jsdom equivalent of
    // that native keydown-triggered activation for a focused button.
    card.focus()
    expect(card).toHaveFocus()
    fireEvent.click(card)
    expect(screen.getByRole('button', { name: 'Cook this' })).toBeInTheDocument()
  })

  it('moves focus into the expanded card so it does not land on the unmounted mini card', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} />)
    const card = screen.getByRole('listitem', { name: `Pick ${MANY[1].title}` })
    card.focus()
    fireEvent.click(card)
    expect(screen.getByRole('link', { name: 'Open recipe' })).toHaveFocus()
  })

  it('does not expand when disabled', () => {
    // A native <button disabled> swallows the click before onClick ever
    // runs, so fireEvent.click alone would pass regardless of whether the
    // `!disabled && setExpandedId(match.id)` guard exists (PR #614 review,
    // finding 3, carried forward to the expand guard). Assert the disabled
    // attribute directly in addition to the click having no effect.
    const onSelect = jest.fn()
    render(<SavedRecipeMatches matches={MANY} onSelect={onSelect} disabled />)
    const item = screen.getByRole('listitem', { name: `Pick ${MANY[0].title}` })
    expect(item).toBeDisabled()
    fireEvent.click(item)
    expect(screen.queryByRole('button', { name: 'Cook this' })).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows the cuisine pill and description when present', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} />)
    expect(screen.getAllByText('Indian').length).toBeGreaterThan(0)
    expect(screen.getByText('Creamy tomato curry.')).toBeInTheDocument()
  })

  it('omits the affordance row on disabled cards', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} disabled />)
    expect(screen.queryByText(/Tap to view/)).not.toBeInTheDocument()
  })
})
