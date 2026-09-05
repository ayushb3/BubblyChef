'use client'

import { useEffect, useRef } from 'react'

/**
 * Shared modal keyboard/focus behaviour — issue #291.
 *
 * Every bottom-sheet/dialog in the app (`AddItemModal`, `PantryAddSheet`,
 * `CookModal`, `RecipeEditModal`, `RecipeImportModal`,
 * `RecipeRefinementModal`, `RecipeDeleteConfirm`, `ThemePicker`) rolled its
 * own backdrop + `motion.div`, but none of them moved focus in on open,
 * trapped Tab inside the panel, closed on Escape, or gave focus back to
 * whatever opened them. Rather than duplicate that logic eight times over
 * (and have it rot into eight subtly different behaviours), it lives here
 * once. Callers still own their own `role="dialog"` / `aria-modal` /
 * `aria-labelledby` markup since that is tied to their own heading ids.
 *
 * Two call shapes, matching the two ways modals exist in this codebase:
 *  - Stays-mounted sheets (`AddItemModal`, `PantryAddSheet`,
 *    `RecipeRefinementModal`) pass their own `isOpen` prop through — the
 *    effect re-arms every time it flips to true.
 *  - Mounts-to-open modals (`RecipeEditModal`, `RecipeImportModal`,
 *    `CookModal`, `RecipeDeleteConfirm`) have no `isOpen` prop; their
 *    presence in the tree *is* the signal, so callers pass a fixed `true`
 *    and the effect runs once on mount, cleaning up (restoring focus) on
 *    unmount.
 *
 * Because Tab is fully intercepted and cycled within the panel while a
 * trap is active, background content is never keyboard-reachable while a
 * modal is open — there is nothing further to "inert" (requirement #4 of
 * issue #291 falls out of #1 for free here, since nothing in this codebase
 * hides sections with CSS on an otherwise-focusable element; every state is
 * conditional JSX).
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(panel: HTMLElement): HTMLElement[] {
  // Deliberately not filtering by `offsetParent`/layout visibility: every
  // modal in this codebase hides sections by not rendering them (conditional
  // JSX per state), not by CSS-hiding a focusable element that's still in the
  // DOM, so there's nothing here that would actually need it — and
  // `offsetParent` is always null under jsdom (no layout engine), which would
  // silently empty this list in tests.
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

export function useModalFocusTrap(
  isOpen: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
) {
  // Latest `onClose` in a ref, not the effect's dependency array — these
  // callbacks are re-created every parent render (they're rarely wrapped in
  // useCallback), and re-running setup/teardown on every keystroke inside the
  // modal would steal focus back out of whatever field the user is typing in.
  // Synced in its own effect (not written during render) per the
  // react-hooks/refs rule — refs are only safe to read/write outside render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  const triggerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  // Captured during render, not in an effect: for "mounts-to-open" modals
  // whose first focusable field carries its own `autoFocus` (e.g.
  // RecipeImportModal's URL input), React applies that `autoFocus` during
  // the commit's mutation phase, which runs *before* any passive effect —
  // so by the time a `useEffect` here could read `document.activeElement`,
  // the modal's own field would already have stolen it, and "the trigger"
  // would wrongly resolve to the modal's own input instead of whatever
  // opened the modal. Reading it here, synchronously in the render body,
  // guarantees it happens before that commit — this is a deliberate,
  // guarded (`wasOpenRef`) read-during-render, not a stray side effect: it
  // only ever runs once per open, exactly on the render where `isOpen`
  // transitions to true.
  if (isOpen && !wasOpenRef.current) {
    triggerRef.current = document.activeElement as HTMLElement | null
  }
  wasOpenRef.current = isOpen

  useEffect(() => {
    if (!isOpen) return

    // Whatever had focus when the modal opened — almost always the button
    // that triggered it — gets it back on close (captured above, during
    // render). For the common case (a page-level button opens a modal),
    // that is exactly the right element and it stays mounted for as long as
    // the modal is open, so restore-on-close just works. For a modal that
    // opens *directly* from within another modal in the very same commit
    // (e.g. `RecipeImportModal` handing off to `RecipeEditModal` for the
    // import-review step), the captured "trigger" can itself be a node
    // that's about to unmount — the `isConnected` check below is what keeps
    // that from crashing or focusing a detached element; native browser
    // behaviour (moving focus to <body>) is the honest fallback in that
    // narrower case rather than a wrong guess.

    const panel = panelRef.current
    if (panel) {
      // Respect a field's own `autoFocus` (e.g. RecipeImportModal's URL
      // input) instead of always jumping to the first focusable element.
      // This is also what solves the nested-swap case (requirement #5):
      // when a view swaps inside an already-open panel (e.g.
      // RecipeDeleteConfirm's "Confirm Delete" / "Cancel" row replacing the
      // "Delete" trigger that just unmounted), the trap re-arms on the new
      // `isOpen`/mount, finds nothing already focused inside the panel, and
      // deliberately moves focus onto the first focusable element of the new
      // view rather than leaving it to fall back to <body>.
      const alreadyFocusedInside =
        document.activeElement !== document.body && panel.contains(document.activeElement)
      if (!alreadyFocusedInside) {
        const focusable = getFocusable(panel)
        ;(focusable[0] ?? panel).focus()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }

      if (e.key !== 'Tab' || !panel) return

      // Recomputed on every Tab press, not cached at mount — several of
      // these modals swap their own content mid-flight (confirm-delete
      // swaps, loading -> review -> success), which changes what's focusable.
      const focusables = getFocusable(panel)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Guard against the trigger having been removed from the DOM while the
      // modal was open (e.g. the pantry card that opened it got deleted, or
      // it lived inside a dropdown that has since closed and unmounted) —
      // calling .focus() on a detached node is a silent no-op in every
      // browser, but checking `isConnected` first makes that a deliberate
      // choice rather than an accident, and keeps this branch honest about
      // requirement #6 (don't strand focus on an unmounted trigger).
      if (triggerRef.current?.isConnected) {
        triggerRef.current.focus()
      }
    }
  }, [isOpen, panelRef])
}
