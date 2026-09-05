/**
 * RecipeDeleteConfirm nested-swap focus handling (issue #291, requirement
 * #5) — the one genuinely tricky case in this ticket.
 *
 * The "Delete" trigger that opens this swap view is expected to unmount in
 * the same update (it typically lives inside an overflow menu that closes
 * at the same time), so React/the browser will NOT naturally carry focus
 * anywhere sensible on their own — this harness models exactly that
 * unmount-on-swap shape and asserts focus lands deliberately on the new
 * view's own button, never falling back to <body>.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecipeDeleteConfirm from '@/components/recipes/RecipeDeleteConfirm'

function SwapHarness() {
  const [confirming, setConfirming] = React.useState(false)
  const [deleted, setDeleted] = React.useState(false)

  if (deleted) return <p>Deleted</p>

  return (
    <div>
      {!confirming && (
        // The trigger unmounts the instant confirming flips true — same
        // shape as RecipeBook's overflow menu, which closes (setMenuOpen
        // (false)) in the same handler that opens the confirm swap.
        <button onClick={() => setConfirming(true)}>🗑️ Delete</button>
      )}
      {confirming && (
        <RecipeDeleteConfirm
          recipeTitle="Pancakes"
          onConfirm={async () => setDeleted(true)}
          onCancel={() => setConfirming(false)}
          deleting={false}
        />
      )}
    </div>
  )
}

describe('RecipeDeleteConfirm nested-swap focus (issue #291)', () => {
  it('moves focus onto the new view instead of stranding it on <body> when the trigger unmounts', () => {
    render(<SwapHarness />)
    fireEvent.click(screen.getByText('🗑️ Delete'))

    // The old trigger is gone...
    expect(screen.queryByText('🗑️ Delete')).not.toBeInTheDocument()
    // ...and focus did not fall back to <body> — it landed inside the swap view.
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByRole('alertdialog')).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('button', { name: /^delete$/i })).toHaveFocus()
  })

  it('labels the swap view from its own text, describing what will be deleted', () => {
    render(<SwapHarness />)
    fireEvent.click(screen.getByText('🗑️ Delete'))

    const dialog = screen.getByRole('alertdialog')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    // Rendered text uses curly quotes (&ldquo;/&rdquo;), not straight ones.
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(/delete .pancakes.\?/i)
  })

  it('Escape cancels the swap, same as every other modal in the app', () => {
    render(<SwapHarness />)
    fireEvent.click(screen.getByText('🗑️ Delete'))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('🗑️ Delete')).toBeInTheDocument()
  })

  it('Tab wraps between Delete and Cancel instead of escaping the swap view', () => {
    render(<SwapHarness />)
    fireEvent.click(screen.getByText('🗑️ Delete'))

    const deleteBtn = screen.getByRole('button', { name: /^delete$/i })
    const cancelBtn = screen.getByRole('button', { name: /^cancel$/i })
    expect(deleteBtn).toHaveFocus()

    // Forward Tab from the last focusable element wraps back to the first —
    // this is the boundary the hook actually intercepts (jsdom doesn't
    // simulate native mid-panel Tab traversal, only real browsers do).
    cancelBtn.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(deleteBtn).toHaveFocus()

    // Shift+Tab from the first element wraps forward to the last.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(cancelBtn).toHaveFocus()
  })

  it('confirming the delete works end to end through the swap view', async () => {
    render(<SwapHarness />)
    fireEvent.click(screen.getByText('🗑️ Delete'))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(screen.getByText('Deleted')).toBeInTheDocument())
  })
})
