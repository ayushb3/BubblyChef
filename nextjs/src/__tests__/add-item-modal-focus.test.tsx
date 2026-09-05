/**
 * AddItemModal focus-trap wiring (issue #291).
 *
 * AddItemModal stays mounted and toggles via its own `isOpen` prop (rather
 * than mounting/unmounting), so this exercises the "stays-mounted sheet"
 * call shape of `useModalFocusTrap` end to end through the real component,
 * not just the hook in isolation.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddItemModal from '@/components/pantry/AddItemModal'

function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = React.useState(initialOpen)
  return (
    <div>
      <button onClick={() => setIsOpen(true)}>Add item</button>
      <AddItemModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  )
}

describe('AddItemModal focus trap', () => {
  it('has the required dialog ARIA wiring, labelled by its own heading', () => {
    render(<Harness initialOpen />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(/add item/i)
  })

  it('moves focus into the panel when opened', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Add item'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('restores focus to the trigger button when closed via Escape', async () => {
    render(<Harness />)
    const trigger = screen.getByText('Add item')
    // A real click focuses the button first; fireEvent.click alone doesn't
    // simulate that, so it's done explicitly here to model what the hook
    // actually captures as "whatever had focus when the modal opened".
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    // AnimatePresence keeps the exiting node mounted through its exit
    // transition, so the dialog only leaves the DOM after that settles.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('traps Tab so it never lands on the trigger button behind the modal', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Add item'))
    const dialog = screen.getByRole('dialog')

    // Move focus to the last focusable element in the dialog, then Tab once
    // more — it must wrap back inside the dialog, never onto "Add item".
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    const last = focusables[focusables.length - 1]
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).not.toBe(screen.getByText('Add item'))
  })
})
