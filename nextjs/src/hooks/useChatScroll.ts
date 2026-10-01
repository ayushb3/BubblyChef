'use client'

/**
 * Chat scroll anchoring (issue #811).
 *
 * - Sending a message scrolls so the sent message sits near the TOP of the
 *   thread; the reply streams in below it and the reader reads downward. A
 *   trailing spacer gives the page room to scroll that far while the reply is
 *   still short, and shrinks to nothing as the reply fills the viewport.
 * - Once the reply fills the viewport nothing follows it any more, so its first
 *   card stays in view.
 * - Any scroll by the user during the turn (wheel, touch, scroll keys,
 *   scrollbar) ends all auto-scrolling for that turn.
 * - "Jump to latest" shows whenever the thread isn't at its end, and resumes
 *   following the end of the reply.
 * - Restoring a saved conversation on open still lands at the bottom.
 *
 * The decisions are pure functions in `lib/chat-scroll.ts`; this hook only
 * measures the DOM and applies them.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@/types/chat'
import {
  ANCHOR_OFFSET_PX,
  decideTurnScroll,
  isNearBottom,
  replyFillsViewport,
  requiredSpacer,
} from '@/lib/chat-scroll'

/** Attribute the page puts on a sent message so the hook can find its anchor. */
export const USER_MESSAGE_ATTR = 'data-chat-user-message'

/** A smooth scroll is in flight for roughly this long; the pill waits it out. */
const SMOOTH_SETTLE_MS = 800

const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

interface Turn {
  userId: string
  /** The user scrolled during this turn: leave the position alone from now on. */
  userScrolled: boolean
  /** The user tapped "jump to latest" mid-stream: track the end of the reply. */
  following: boolean
}

function motionBehavior(): ScrollBehavior {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    return 'auto'
  }
  return 'smooth'
}

function scrollContainerTo(el: HTMLElement, top: number, behavior: ScrollBehavior) {
  if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior })
  else el.scrollTop = top
}

function setSpacer(spacer: HTMLElement, px: number) {
  const next = `${Math.round(px)}px`
  if (spacer.style.height !== next) spacer.style.height = next
}

export function useChatScroll({
  messages,
  isStreaming,
  hasThread,
}: {
  messages: ChatMessage[]
  isStreaming: boolean
  /** True while the message thread (not the empty state) is on screen. */
  hasThread: boolean
}) {
  /** The overflow-y-auto container. Must be `position: relative` (offsetTop math). */
  const scrollRef = useRef<HTMLDivElement>(null)
  /** The element wrapping the messages. */
  const threadRef = useRef<HTMLDivElement>(null)
  /** Blank room after the thread; its height is owned by this hook. */
  const spacerRef = useRef<HTMLDivElement>(null)

  const turnRef = useRef<Turn | null>(null)
  const lastUserIdRef = useRef<string | null>(null)
  const prevLengthRef = useRef(0)
  const settleUntilRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showJump, setShowJump] = useState(false)

  const updateJump = useCallback(() => {
    const c = scrollRef.current
    if (!c || !threadRef.current) {
      setShowJump(false)
      return
    }
    setShowJump(
      !isNearBottom({
        scrollTop: c.scrollTop,
        clientHeight: c.clientHeight,
        scrollHeight: c.scrollHeight,
      }),
    )
  }, [])

  const refreshJump = useCallback(() => {
    const remaining = settleUntilRef.current - performance.now()
    if (remaining > 0) {
      // Mid-animation the position is neither here nor there; look again after.
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(updateJump, remaining + 50)
      return
    }
    updateJump()
  }, [updateJump])

  /** Measures the live turn: anchor position, its height so far, and the content height. */
  const measure = useCallback(() => {
    const c = scrollRef.current
    const thread = threadRef.current
    const spacer = spacerRef.current
    const turn = turnRef.current
    if (!c || !thread || !spacer || !turn) return null
    const user = thread.querySelector<HTMLElement>(`[${USER_MESSAGE_ATTR}="${turn.userId}"]`)
    if (!user) return null
    // offsetTop, not getBoundingClientRect: it ignores the message's entrance
    // transform, so the anchor doesn't wobble while it animates in.
    const anchorTop = user.offsetTop
    return {
      c,
      spacer,
      turn,
      anchorTop,
      turnHeight: thread.offsetTop + thread.offsetHeight - anchorTop,
      contentHeight: c.scrollHeight - spacer.offsetHeight,
    }
  }, [])

  const beginSettle = useCallback((behavior: ScrollBehavior) => {
    settleUntilRef.current = behavior === 'smooth' ? performance.now() + SMOOTH_SETTLE_MS : 0
  }, [])

  // A new turn, a saved conversation arriving, or a fresh chat. Layout effect so
  // the spacer and the scroll land before the browser paints the new message.
  useLayoutEffect(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const lastUserId = lastUser?.id ?? null
    const userChanged = lastUserId !== lastUserIdRef.current
    const wasEmpty = prevLengthRef.current === 0
    lastUserIdRef.current = lastUserId
    prevLengthRef.current = messages.length

    if (messages.length === 0) {
      // New chat: nothing to anchor, nothing to reserve room for.
      turnRef.current = null
      if (spacerRef.current) setSpacer(spacerRef.current, 0)
      return
    }

    if (userChanged && lastUserId && isStreaming) {
      // The user just sent something (the message and the stream start commit
      // together). Anchor it to the top.
      turnRef.current = { userId: lastUserId, userScrolled: false, following: false }
      const m = measure()
      if (!m) return
      setSpacer(
        m.spacer,
        requiredSpacer({
          anchorTop: m.anchorTop,
          contentHeight: m.contentHeight,
          clientHeight: m.c.clientHeight,
        }),
      )
      const behavior = motionBehavior()
      beginSettle(behavior)
      scrollContainerTo(m.c, m.anchorTop - ANCHOR_OFFSET_PX, behavior)
      return
    }

    if (wasEmpty && !isStreaming) {
      // A saved conversation was restored on open: land at the end of it.
      turnRef.current = null
      const c = scrollRef.current
      if (c) c.scrollTop = c.scrollHeight
    }
  }, [messages, isStreaming, measure, beginSettle])

  // Content or viewport size changed: keep the spacer right, and apply the
  // turn's follow/stop decision.
  const onLayoutChange = useCallback(() => {
    const m = measure()
    if (m) {
      setSpacer(
        m.spacer,
        requiredSpacer({
          anchorTop: m.anchorTop,
          contentHeight: m.contentHeight,
          clientHeight: m.c.clientHeight,
        }),
      )
      const action = decideTurnScroll({
        userScrolled: m.turn.userScrolled,
        following: m.turn.following,
        replyFillsViewport: replyFillsViewport({
          turnHeight: m.turnHeight,
          clientHeight: m.c.clientHeight,
        }),
      })
      if (action === 'follow-bottom') {
        m.c.scrollTop = m.c.scrollHeight
      } else if (action === 'pin-anchor' && performance.now() >= settleUntilRef.current) {
        const target = m.anchorTop - ANCHOR_OFFSET_PX
        if (Math.abs(m.c.scrollTop - target) > 1) scrollContainerTo(m.c, target, 'auto')
      }
    }
    refreshJump()
  }, [measure, refreshJump])

  useEffect(() => {
    if (!hasThread || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(onLayoutChange)
    if (threadRef.current) ro.observe(threadRef.current)
    if (scrollRef.current) ro.observe(scrollRef.current)
    return () => ro.disconnect()
  }, [hasThread, onLayoutChange])

  // The user took the wheel: no more auto-scrolling this turn.
  useEffect(() => {
    const c = scrollRef.current
    if (!c) return
    const stop = () => {
      if (turnRef.current) turnRef.current.userScrolled = true
    }
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) stop()
    }
    // A click on the scrollbar targets the container itself; a tap on a card inside it does not.
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === c) stop()
    }
    c.addEventListener('wheel', stop, { passive: true })
    c.addEventListener('touchmove', stop, { passive: true })
    c.addEventListener('keydown', onKey)
    c.addEventListener('pointerdown', onPointerDown)
    c.addEventListener('scroll', refreshJump, { passive: true })
    return () => {
      c.removeEventListener('wheel', stop)
      c.removeEventListener('touchmove', stop)
      c.removeEventListener('keydown', onKey)
      c.removeEventListener('pointerdown', onPointerDown)
      c.removeEventListener('scroll', refreshJump)
    }
  }, [refreshJump])

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    },
    [],
  )

  const jumpToLatest = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    const turn = turnRef.current
    if (turn) {
      turn.userScrolled = false
      turn.following = true
    }
    const behavior = motionBehavior()
    beginSettle(behavior)
    scrollContainerTo(c, c.scrollHeight, behavior)
    refreshJump()
  }, [refreshJump, beginSettle])

  // The pill never shows over the empty state (New Chat).
  return { scrollRef, threadRef, spacerRef, showJump: showJump && hasThread, jumpToLatest }
}
