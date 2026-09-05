/**
 * RecipeImportModal focus-trap wiring (issue #291).
 *
 * RecipeImportModal is a "mounts-to-open" modal (no `isOpen` prop — its
 * presence in the tree is the open signal), and its URL input carries its
 * own `autoFocus`. This pins down that the shared hook respects that
 * existing autoFocus instead of stealing it, and still restores focus to
 * whatever triggered the modal once it unmounts.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecipeImportModal from '@/components/recipes/RecipeImportModal'

function Harness() {
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Import from URL</button>
      {open && (
        <RecipeImportModal onImported={jest.fn()} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

describe('RecipeImportModal focus trap', () => {
  it('is a labelled dialog and keeps its own autoFocus on the URL field', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Import from URL'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(/import from url/i)

    expect(screen.getByPlaceholderText(/allrecipes\.com/i)).toHaveFocus()
  })

  it('restores focus to the trigger button on Escape', async () => {
    render(<Harness />)
    const trigger = screen.getByText('Import from URL')
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})
