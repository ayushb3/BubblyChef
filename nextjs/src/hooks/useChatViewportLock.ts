'use client'

import { useEffect } from 'react'

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
 */
export function useChatViewportLock() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('overflow-hidden')

    const keepAtTop = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      }
    }
    window.addEventListener('scroll', keepAtTop, { passive: true })

    return () => {
      root.classList.remove('overflow-hidden')
      window.removeEventListener('scroll', keepAtTop)
    }
  }, [])
}
