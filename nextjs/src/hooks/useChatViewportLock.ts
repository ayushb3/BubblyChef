'use client'

import { useEffect } from 'react'

/** The visual viewport this much shorter than the window means the keyboard is up. */
const KEYBOARD_MIN_PX = 120

/** Wait for the keyboard to finish closing before putting the page back. */
const BLUR_SETTLE_MS = 150

function isTextFieldFocused(): boolean {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

function keyboardIsUp(): boolean {
  const vv = window.visualViewport
  return Boolean(vv) && window.innerHeight - vv!.height > KEYBOARD_MIN_PX
}

/**
 * The chat surface is exactly one dynamic viewport tall (`CHAT_VIEWPORT_CLASS`)
 * and its message list is the only thing meant to scroll (issues #731, #900).
 * So while /chat is mounted the document must never scroll.
 *
 * Two parts:
 * - `overflow-hidden` on <html> stops the user scrolling it (#731).
 * - That does not stop the browser or a script. The root layout's <body> is
 *   sized in `dvh`, but a phone's collapsing toolbar, a focus move or a sheet
 *   opening can still scroll the document by a few dozen pixels. The column
 *   then rides up under the browser chrome (header gone) and leaves a dead band
 *   of the same height between the composer and the fixed bottom nav (#900).
 *   Nothing on this page wants a scrolled document, so any scroll is undone.
 *
 * One exception: it never fights the keyboard. iOS Safari (and Android with some
 * `interactive-widget` settings) scrolls the document to keep a focused input
 * above the keyboard; snapping that back would put the composer under it. So no
 * snapping while a text field is focused or the keyboard is up, and the page is
 * put back once the field loses focus.
 */
export function useChatViewportLock() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('overflow-hidden')

    const keepAtTop = () => {
      if (isTextFieldFocused() || keyboardIsUp()) return
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      }
    }

    let blurTimer: ReturnType<typeof setTimeout> | null = null
    const onFocusOut = () => {
      if (blurTimer) clearTimeout(blurTimer)
      blurTimer = setTimeout(keepAtTop, BLUR_SETTLE_MS)
    }

    window.addEventListener('scroll', keepAtTop, { passive: true })
    document.addEventListener('focusout', onFocusOut)

    return () => {
      root.classList.remove('overflow-hidden')
      window.removeEventListener('scroll', keepAtTop)
      document.removeEventListener('focusout', onFocusOut)
      if (blurTimer) clearTimeout(blurTimer)
    }
  }, [])
}
