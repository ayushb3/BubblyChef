'use client'

import { useEffect, useRef } from 'react'

/**
 * Modal keyboard/focus behaviour — issue #10.
 *
 * Every bottom-sheet/dialog in the app (`AddItemModal`, `PantryAddSheet`,
 * `RecipeEditModal`, `RecipeImportModal`, `CookModal`) rolled its own
 * backdrop + `motion.div` but none of them moved focus in on open, trapped
 * Tab inside the panel, closed on Escape, or gave focus back to whatever
 * opened them. Rather than duplicate that logic five times, it lives here
 * once; callers still own their own `role="dialog"` / `aria-modal` /
 * `aria-labelledby` markup since that's tied to their own heading ids.
 *
 * Two call shapes, matching the two ways modals exist in this codebase:
 *  - Stays-mounted sheets (`AddItemModal`, `PantryAddSheet`) pass their own
 *    `isOpen` prop through — the effect re-arms every time it flips to true.
 *  - Mounts-to-open modals (`RecipeEditModal`, `RecipeImportModal`,
 *    `CookModal`) have no `isOpen` prop; their presence in the tree *is* the
 *    signal, so callers pass a fixed `true` and the effect runs once on
 *    mount, cleaning up (returning focus) on unmount.
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

  useEffect(() => {
    if (!isOpen) return

    // Whatever had focus when the modal opened — almost always the button
    // that triggered it — gets it back on close.
    triggerRef.current = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    if (panel) {
      // Respect a field's own `autoFocus` (e.g. RecipeImportModal's URL
      // input) instead of always jumping to the first focusable element.
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
      // modal was open (e.g. the pantry card that opened it got deleted).
      triggerRef.current?.focus?.()
    }
  }, [isOpen, panelRef])
}
