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

// `offsetParent !== null` is the usual cheap visibility check, but every
// modal panel in this codebase (`AddItemModal`, `PantryAddSheet`, `CookModal`,
// `RecipeEditModal`, `RecipeImportModal`, `RecipeRefinementModal`) is itself
// `position: fixed`, and `offsetParent` is spec'd to be `null` for a
// fixed-position element's own layout box regardless of visibility — it would
// misreport every focusable descendant as hidden the moment a future caller's
// panel (or an ancestor between panel and element) is fixed-positioned too.
// It's also always `null` under jsdom (no layout engine), which would empty
// this list for every existing test.
//
// `getComputedStyle`, walked up from the element to the document root,
// avoids both problems: it reflects `display`/`visibility` regardless of
// positioning scheme, and jsdom *does* compute `display`/`visibility` from
// inline styles (verified with a `style={{ display: 'none' }}` test below),
// so a CSS-collapsed accordion section or a `display:none`'d advanced-options
// block that stays mounted (rather than being removed via conditional JSX)
// is correctly excluded from the tab order and never receives initial focus.
//
// Known gap: this only catches `display: none`, `visibility: hidden`, and the
// `hidden` attribute. It does NOT catch an element that is technically
// "displayed" but not actually visible/reachable for other reasons —
// zero-size clipping (`overflow: hidden` on a zero-height ancestor),
// `opacity: 0`, or off-screen positioning (`transform: translateX(-9999px)`).
// None of the 8 modals currently do any of that; if a future one does, this
// filter won't catch it and the same audit will need extending.
function isVisible(el: HTMLElement): boolean {
  let node: HTMLElement | null = el
  while (node) {
    if (node.hidden) return false
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    node = node.parentElement
  }
  return true
}

function getFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
}

// Module-level focus tracker, not component state — this is what lets the
// hook resolve "the trigger" correctly even when a mounts-to-open modal's
// first field steals focus via `autoFocus` during the commit's mutation
// phase (e.g. RecipeImportModal's URL input), which happens before any
// React effect runs. A `focusin` listener sees every focus change in the
// document — including the browser's own autoFocus-on-insert — as it
// happens, in the order it happens, regardless of which React phase (render,
// commit, passive effect) triggered it. That sidesteps the ordering bet the
// previous render-body-capture approach depended on (see the effect below
// for what that bet was and why it broke `react-hooks/refs`). Guarded for
// SSR: this module is imported during server render, where `document`
// doesn't exist.
let currentlyFocused: HTMLElement | null = null
let previouslyFocused: HTMLElement | null = null

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      const target = e.target as HTMLElement | null
      if (target === currentlyFocused) return
      previouslyFocused = currentlyFocused
      currentlyFocused = target
    },
    { passive: true },
  )
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

    const panel = panelRef.current

    // Resolve "the trigger" — whatever had focus right before this modal
    // claimed it — using the module-level tracker above, not
    // `document.activeElement` read fresh here. By the time this effect
    // runs, a mounts-to-open modal's own `autoFocus` field (if any) may
    // already have stolen `document.activeElement` during commit; in that
    // case the *actual* trigger is one step further back in the tracker's
    // history (`previouslyFocused`), not the current value. Writing this
    // into a ref inside an effect, rather than during render, is what the
    // `react-hooks/refs` rule requires — refs are only safe to read/write
    // outside render, which the tracker's own module-level state already
    // satisfies (it's plain mutable state, not a React ref, so nothing
    // about touching it during render would even be meaningful).
    const activeElement = document.activeElement as HTMLElement | null
    const activeIsInsidePanel = !!(panel && activeElement && panel.contains(activeElement))
    const resolvedTrigger = activeIsInsidePanel ? previouslyFocused : activeElement
    // Never restore focus into the panel itself — it's about to unmount (or
    // is the thing capturing Tab), so a trigger resolved to a node inside it
    // would restore focus to something that's gone by the time cleanup runs.
    triggerRef.current =
      resolvedTrigger && panel && panel.contains(resolvedTrigger) ? null : resolvedTrigger

    // Whatever had focus when the modal opened — almost always the button
    // that triggered it — gets it back on close (resolved above). For the
    // common case (a page-level button opens a modal), that is exactly the
    // right element and it stays mounted for as long as the modal is open,
    // so restore-on-close just works. For a modal that opens *directly*
    // from within another modal in the very same commit (e.g.
    // `RecipeImportModal` handing off to `RecipeEditModal` for the
    // import-review step), the resolved "trigger" can itself be a node
    // that's about to unmount — the `isConnected` check below is what keeps
    // that from crashing or focusing a detached element; native browser
    // behaviour (moving focus to <body>) is the honest fallback in that
    // narrower case rather than a wrong guess.

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
