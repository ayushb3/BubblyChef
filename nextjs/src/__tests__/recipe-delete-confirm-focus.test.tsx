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

// Models RecipeBook's *actual* overflow-menu shape (RecipeBook.tsx's
// `onClick={() => { setMenuOpen(false); setDeleteOpen(true) }}`): a
// "More options" (⋮) toggle that stays mounted, a menu of items (including
// "Delete") that unmounts the instant Delete is clicked, in the SAME state
// update that mounts RecipeDeleteConfirm. `SwapHarness` above models only
// the swap-in (requirement #5); this models the round trip back out,
// which is what issue #381 is about.
function OverflowMenuHarness() {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  return (
    <div>
      <button aria-label="More options" onClick={() => setMenuOpen((o) => !o)}>
        ⋮
      </button>
      {menuOpen && (
        <div>
          <button
            onClick={() => {
              setMenuOpen(false)
              setDeleteOpen(true)
            }}
          >
            🗑️ Delete
          </button>
        </div>
      )}
      {deleteOpen && (
        <RecipeDeleteConfirm
          recipeTitle="Pancakes"
          onConfirm={async () => setDeleteOpen(false)}
          onCancel={() => setDeleteOpen(false)}
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

  // Regression test for issue #381: "Focus escapes to <body> (not the
  // trigger) after closing a mounts-to-open modal". Confirmed root cause:
  // `document.activeElement` falls back to `<body>` synchronously the
  // instant a focused element is removed from the DOM, with no
  // `focusin`/`focusout` fired for that transition. Here the "Delete" menu
  // item unmounts (along with the rest of the overflow menu) in the very
  // same commit that mounts RecipeDeleteConfirm, so by the time the shared
  // hook's effect runs, `document.activeElement` is already `<body>` — not
  // the "Delete" trigger, and not usable as one. Before the fix, the hook
  // resolved the restore target straight from that already-`<body>`
  // `activeElement`, and since `<body>.isConnected` is always `true`, its
  // guard treated that as "found a valid trigger" and called a silent
  // no-op `.focus()` on `<body>` — the bug. This exercises the real
  // wiring (`SwapHarness` above only models the swap-in, not the round
  // trip back out) and asserts focus deliberately returns to the
  // still-mounted "More options" toggle, not `<body>`.
  it('returns focus to the still-mounted "More options" toggle (not <body>) after cancelling', () => {
    render(<OverflowMenuHarness />)
    const moreOptions = screen.getByLabelText('More options')
    moreOptions.focus()
    fireEvent.click(moreOptions)

    const deleteTrigger = screen.getByText('🗑️ Delete')
    deleteTrigger.focus()
    fireEvent.click(deleteTrigger)
    expect(screen.queryByText('🗑️ Delete')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(document.activeElement).not.toBe(document.body)
    expect(moreOptions).toHaveFocus()
  })
})
