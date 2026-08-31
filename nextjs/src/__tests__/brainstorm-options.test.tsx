/**
 * Issue #286: brainstorm option cards must not wear the user's colour.
 *
 * The reported failure was purely visual — three assistant suggestions rendered
 * as solid `--color-primary` blocks, the same token MessageBubble gives the
 * user's own messages, so the transcript read as if the user had sent them.
 *
 * A snapshot would not catch a regression here in any useful way, so these
 * assert the one property that actually matters: primary belongs to the user,
 * and nothing in this component may claim it.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import BrainstormOptions from '@/components/chat/BrainstormOptions'

const IDEAS = ['Loaded Chicken Potato Skins', 'Spicy Chicken Potato Bites']

function markup(container: HTMLElement): string {
  return container.innerHTML
}

describe('BrainstormOptions', () => {
  it('renders one card per idea', () => {
    render(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} />)
    IDEAS.forEach((idea) => expect(screen.getByText(idea)).toBeInTheDocument())
  })

  it('renders nothing when there are no ideas', () => {
    const { container } = render(<BrainstormOptions ideas={[]} onSelect={jest.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  // ── The actual bug ────────────────────────────────────────────────────────

  it('never uses --color-primary, which is the user-message colour', () => {
    const { container } = render(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} />)
    expect(markup(container)).not.toContain('--color-primary')
  })

  it('uses the accent family so the cards read as assistant content', () => {
    const { container } = render(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} />)
    expect(markup(container)).toContain('--color-accent')
  })

  it('does not put white text on the accent strip', () => {
    // White on accent measures 1.28–1.67:1 across the six themes.
    const { container } = render(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} />)
    expect(markup(container)).not.toContain('text-white')
  })

  it('renders the affordance at full opacity, not a faded variant', () => {
    // At /80 the affordance fell to 3.87:1 in the mint theme.
    render(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} />)
    const affordances = screen.getAllByText(/Tap to make/)
    affordances.forEach((el) => {
      expect(el.className).toContain('text-[var(--color-text)]')
      expect(el.className).not.toMatch(/text-\[var\(--color-text\)\]\/\d+/)
    })
  })

  // ── Behaviour that had to survive the re-treatment ────────────────────────

  it('fires onSelect with the idea that was tapped', () => {
    const onSelect = jest.fn()
    render(<BrainstormOptions ideas={IDEAS} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${IDEAS[1]}` }))
    expect(onSelect).toHaveBeenCalledWith(IDEAS[1])
  })

  it('shows the tap affordance only on interactive cards', () => {
    const { rerender } = render(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} />)
    expect(screen.getAllByText(/Tap to make/)).toHaveLength(IDEAS.length)

    rerender(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} disabled />)
    expect(screen.queryByText(/Tap to make/)).not.toBeInTheDocument()
  })

  it('does not fire onSelect when disabled', () => {
    const onSelect = jest.fn()
    render(<BrainstormOptions ideas={IDEAS} onSelect={onSelect} disabled />)

    fireEvent.click(screen.getByRole('listitem', { name: `Pick ${IDEAS[0]}` }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps the idea titles legible when disabled', () => {
    // Older brainstorm messages stay readable rather than fading out entirely.
    render(<BrainstormOptions ideas={IDEAS} onSelect={jest.fn()} disabled />)
    IDEAS.forEach((idea) => expect(screen.getByText(idea)).toBeInTheDocument())
  })
})
