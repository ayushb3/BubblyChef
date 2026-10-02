'use client'

import { useEffect, useRef, useState } from 'react'
import BubblesMascot from '@/components/ui/BubblesMascot'
import NotificationBell from '@/components/layout/NotificationBell'

/**
 * The one page header (issue #894): Bubbly, then the app's name, then the page's
 * controls. Chat, Recipes, Scan and Grocery all draw it, so the app reads as one
 * place.
 *
 * Contract for the hosts:
 *  - The title is fixed at "BubblyChef" (the `h1`). A page's own heading goes in
 *    its body, not here.
 *  - `leadingSlot`: page controls that sit before the notification bell (chat's
 *    New Chat, issue #906).
 *  - `rightSlot`: the page's controls, laid out after the notification bell.
 *  - `thinking`: Bubbly shows the thinking pose (chat while a reply streams).
 *    Otherwise the cheerful pose, resting with a gentle bob.
 *  - Tapping Bubbly plays a short mirror-flip, `REACTION_MS` long. A real button
 *    (44 px target, keyboard operable), still under reduced motion.
 *
 * Alignment: the cheerful art (`bubbles-celebrate.png`) is padded evenly, so the
 * image box and the picture share a centre and `items-center` centres the word on
 * it. (`bubbles-happy.png` is not: 12.6% blank above, 1.2% below, which puts its
 * picture ~2 px low in the box. Re-measure before swapping the pose.)
 */

interface BubblesHeaderProps {
  showSubtitle?: boolean
  leadingSlot?: React.ReactNode
  rightSlot?: React.ReactNode
  thinking?: boolean
}

/** How long the tap reaction runs. */
export const REACTION_MS = 600
/** The flip's beat during the reaction: quicker than the thinking pose's, so four cuts land in `REACTION_MS`. */
const REACTION_FLIP_MS = 150

export default function BubblesHeader({
  showSubtitle = false,
  leadingSlot,
  rightSlot,
  thinking = false,
}: BubblesHeaderProps) {
  const [reacting, setReacting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  function handleTap() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setReacting(true)
    timerRef.current = setTimeout(() => setReacting(false), REACTION_MS)
  }

  return (
    <div className="p-4 pb-3 flex items-center gap-2 flex-shrink-0 border-b border-[var(--color-border)]">
      {/* 44 px target around the 40 px mascot; the negative margins keep the
          header exactly as tall as it was with a bare mascot. */}
      <button
        type="button"
        onClick={handleTap}
        aria-label="Say hi to Bubbly"
        data-testid="header-mascot"
        data-reacting={reacting ? 'true' : undefined}
        className="-my-1 -ml-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-text)]"
      >
        <BubblesMascot
          state={thinking ? 'thinking' : 'celebrate'}
          size={40}
          burst={false}
          flip={thinking || reacting}
          flipMs={thinking ? undefined : REACTION_FLIP_MS}
        />
      </button>
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-extrabold text-[var(--color-text)] leading-tight">
          BubblyChef
        </h1>
        {showSubtitle && (
          <p className="text-xs text-[var(--color-muted)]">Your AI kitchen assistant</p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {/*
          Notification bell (#496) lives here, in the header itself, rather
          than being threaded through every page's `rightSlot` prop — this
          is "the existing rightSlot of BubblesHeader.tsx" the issue points
          at, and every caller that passes a `rightSlot` (usually
          `ProfileHeaderButton`) gets the bell next to it for free.
        */}
        {leadingSlot}
        <NotificationBell />
        {rightSlot}
      </div>
    </div>
  )
}
