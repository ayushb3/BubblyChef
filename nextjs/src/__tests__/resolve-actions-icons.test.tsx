/**
 * Issue #813: the three card actions (cook, used it, tossed) are one row of
 * icon-only buttons. The words repeated on every card cost two rows of height,
 * so the meaning lives in the aria-label (assistive tech) and a native `title`
 * (hover), not in visible text. The Tossed two-step confirm is unchanged.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import ResolveActions from '@/components/pantry/ResolveActions'

const COOK_HREF = '/chat?use=spinach'

function renderActions(props: Partial<React.ComponentProps<typeof ResolveActions>> = {}) {
  const onResolve = jest.fn()
  const view = render(
    <ResolveActions
      itemName="spinach"
      onResolve={onResolve}
      variant="pills"
      cookHref={COOK_HREF}
      {...props}
    />,
  )
  return { onResolve, ...view }
}

describe('ResolveActions: one row of icon buttons', () => {
  it('names each action for assistive tech', () => {
    renderActions()
    expect(screen.getByRole('link', { name: 'Cook something with spinach' })).toHaveAttribute(
      'href',
      COOK_HREF,
    )
    expect(screen.getByRole('button', { name: 'Mark spinach as used up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark spinach as tossed' })).toBeInTheDocument()
  })

  it('shows no repeated word labels, only icons', () => {
    renderActions()
    expect(screen.queryByText(/cook this/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/used it/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/tossed/i)).not.toBeInTheDocument()
  })

  it('puts the three actions in a single row, cook first', () => {
    renderActions()
    const cook = screen.getByRole('link', { name: /Cook something with/ })
    const used = screen.getByRole('button', { name: /as used up/ })
    const tossed = screen.getByRole('button', { name: /as tossed/ })
    const row = cook.parentElement as HTMLElement
    expect(used.parentElement).toBe(row)
    expect(tossed.parentElement).toBe(row)
    expect(Array.from(row.children)).toEqual([cook, used, tossed])
  })

  it('gives every action a 44px by 44px minimum target', () => {
    renderActions()
    for (const el of [
      screen.getByRole('link', { name: /Cook something with/ }),
      screen.getByRole('button', { name: /as used up/ }),
      screen.getByRole('button', { name: /as tossed/ }),
    ]) {
      expect(el.className).toContain('min-h-[44px]')
      expect(el.className).toContain('min-w-[44px]')
    }
  })

  it('offers the word as a native title tooltip so the icon can be discovered', () => {
    renderActions()
    expect(screen.getByRole('link', { name: /Cook something with/ })).toHaveAttribute(
      'title',
      'Cook this',
    )
    expect(screen.getByRole('button', { name: /as used up/ })).toHaveAttribute('title', 'Used it')
    expect(screen.getByRole('button', { name: /as tossed/ })).toHaveAttribute('title', 'Tossed')
  })

  it('hides the decorative icons from assistive tech', () => {
    const { container } = renderActions()
    const icons = container.querySelectorAll('[aria-hidden="true"]')
    expect(icons).toHaveLength(3)
  })

  it('keeps the colour coding: fresh for used, expired for tossed', () => {
    renderActions()
    expect(screen.getByRole('button', { name: /as used up/ }).className).toContain(
      'bg-[var(--color-fresh)]',
    )
    expect(screen.getByRole('button', { name: /as tossed/ }).className).toContain(
      'bg-[var(--color-expired)]',
    )
  })

  it('leaves the cook link out when the item has nothing to cook', () => {
    renderActions({ cookHref: undefined })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /as used up/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /as tossed/ })).toBeInTheDocument()
  })

  it('works the same in the default bar variant', () => {
    renderActions({ variant: undefined })
    expect(screen.getByRole('link', { name: 'Cook something with spinach' })).toBeInTheDocument()
    expect(screen.queryByText(/used it/i)).not.toBeInTheDocument()
  })

  it('commits "used" on one tap', () => {
    const { onResolve } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Mark spinach as used up' }))
    expect(onResolve).toHaveBeenCalledWith('used')
  })

  it('turns the buttons off while a resolve is in flight', () => {
    renderActions({ pending: true })
    expect(screen.getByRole('button', { name: /as used up/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /as tossed/ })).toBeDisabled()
  })
})

describe('ResolveActions: the Tossed two-step confirm', () => {
  it('does not toss on the first tap; it asks first', () => {
    const { onResolve } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Mark spinach as tossed' }))
    expect(onResolve).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm spinach was tossed' })).toHaveTextContent(
      'Really toss?',
    )
    // The other actions step aside while the question is open.
    expect(screen.queryByRole('button', { name: /as used up/ })).not.toBeInTheDocument()
  })

  it('tosses only on the second tap', () => {
    const { onResolve } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Mark spinach as tossed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm spinach was tossed' }))
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith('tossed')
  })

  it('Cancel backs out with nothing resolved and puts the row back', () => {
    const { onResolve, container } = renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Mark spinach as tossed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onResolve).not.toHaveBeenCalled()
    const row = container.firstElementChild as HTMLElement
    expect(within(row).getByRole('link', { name: /Cook something with/ })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /as used up/ })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /as tossed/ })).toBeInTheDocument()
  })

  it('keeps keyboard focus in the row: Cancel on open, the Tossed key after Cancel', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Mark spinach as tossed' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Mark spinach as tossed' })).toHaveFocus()
  })

  it('keeps the confirm and Cancel at a 44px target', () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Mark spinach as tossed' }))
    expect(screen.getByRole('button', { name: /Confirm spinach/ }).className).toContain(
      'min-h-[44px]',
    )
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('min-h-[44px]')
  })
})
