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

  // Regression test for issue #381: "Focus escapes to <body> (not the
  // trigger) after closing a mounts-to-open modal". Confirmed root cause:
  // Safari and Firefox-on-macOS do NOT move DOM focus to a plain <button>
  // on mouse click by default (only text fields/links get focus-by-click
  // there — WebKit's "focus ring" policy; Chrome does focus buttons on
  // click, which is why this didn't reproduce with a Chrome-shaped click).
  // `fireEvent.click` alone never focuses in jsdom either, so calling
  // `trigger.focus()` first (as the test above and the shared hook's own
  // suite do) accidentally always modelled the Chrome-only case. Not
  // pre-focusing the trigger, but still firing `mousedown` (which every
  // browser dispatches regardless of whether it goes on to move focus),
  // models the Safari/Firefox-macOS path precisely. Before the fix this
  // failed — `useModalFocusTrap`'s tracker never recorded the trigger via
  // `focusin` in that scenario, so cleanup had nothing to restore focus to
  // and it silently landed on `<body>`.
  it('restores focus to the trigger on close even when the browser never natively focused it on click', () => {
    render(<Harness />)
    const trigger = screen.getByText('Import from URL')
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger) // deliberately no trigger.focus() — see comment above

    expect(screen.getByPlaceholderText(/allrecipes\.com/i)).toHaveFocus()

    fireEvent.click(screen.getByText('Cancel'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).not.toBe(document.body)
    expect(trigger).toHaveFocus()
  })
})
