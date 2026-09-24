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
  it('renders a single card with Open recipe and Cook this actions', () => {
    render(<SavedRecipeMatches matches={ONE} onSelect={jest.fn()} />)
    expect(screen.getByText('Butter Chicken')).toBeInTheDocument()
    const openLink = screen.getByRole('link', { name: 'Open recipe' })
    expect(openLink).toHaveAttribute('href', '/recipes/r1')
    const cookLink = screen.getByRole('link', { name: 'Cook this' })
    expect(cookLink).toHaveAttribute('href', '/chat?cooking=r1')
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

  it('fires onSelect with the tapped match', () => {
    const onSelect = jest.fn()
    render(<SavedRecipeMatches matches={MANY} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${MANY[1].title}` }))
    expect(onSelect).toHaveBeenCalledWith(MANY[1])
  })

  it('does not fire onSelect when disabled', () => {
    // A native <button disabled> swallows the click before onClick ever
    // runs, so fireEvent.click alone would pass regardless of whether the
    // `!disabled && onSelect(match)` guard exists (PR #614 review, finding
    // 3). Assert the disabled attribute directly — the guard this covers —
    // in addition to the click having no effect.
    const onSelect = jest.fn()
    render(<SavedRecipeMatches matches={MANY} onSelect={onSelect} disabled />)
    const item = screen.getByRole('listitem', { name: `Pick ${MANY[0].title}` })
    expect(item).toBeDisabled()
    fireEvent.click(item)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows the cuisine pill and description when present', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} />)
    expect(screen.getAllByText('Indian').length).toBeGreaterThan(0)
    expect(screen.getByText('Creamy tomato curry.')).toBeInTheDocument()
  })

  it('omits the affordance row on disabled cards', () => {
    render(<SavedRecipeMatches matches={MANY} onSelect={jest.fn()} disabled />)
    expect(screen.queryByText(/Tap to pick/)).not.toBeInTheDocument()
  })
})
