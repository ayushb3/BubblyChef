'use client'

/**
 * The wait after a meal option is tapped (issue #887). Opening a meal expands
 * every dish with the model, which takes a while, and the thread used to show only
 * typing dots. This card says what is being opened (the option's title and its dish
 * names, both already known from the tapped option) beside a flip-book Bubbles, with
 * a short rotating status line so the wait reads as progress.
 *
 * Contract for `frontend`:
 *  - `title`: the picked option's title.
 *  - `dishes`: its dish names, main first (may be empty).
 *  - Render it where the typing indicator would go. It makes no request.
 *
 * It can't see per-dish progress, so the status lines are generic and never claim
 * a dish is finished. One polite status region names what is opening; the rotating
 * line is hidden from assistive tech so it doesn't chatter. Under reduced motion
 * Bubbles holds still and the line holds its first text.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import BubblesMascot from '@/components/ui/BubblesMascot'
import PixelPanel from '@/components/ui/PixelPanel'
import { useMotionConfig } from '@/lib/motion'

/** How long each status line stays before the next one. */
export const MEAL_OPEN_STATUS_MS = 2400

/** Generic on purpose: none says a dish is done. */
const STATUS_LINES = ['Writing the main…', 'Writing the sides…', 'Lining up the timeline…'] as const

interface MealOpenWaitingCardProps {
  title: string
  dishes: string[]
}

export default function MealOpenWaitingCard({ title, dishes }: MealOpenWaitingCardProps) {
  const { reduced } = useMotionConfig()
  const [line, setLine] = useState(0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setLine((n) => (n + 1) % STATUS_LINES.length), MEAL_OPEN_STATUS_MS)
    return () => clearInterval(id)
  }, [reduced])

  return (
    <motion.div
      data-testid="meal-open-waiting"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
      transition={{ duration: reduced ? 0.15 : 0.22, ease: 'easeOut' }}
    >
      <PixelPanel contentClassName="p-3" className="w-full">
        <div role="status" className="flex items-center gap-3">
          <BubblesMascot size={56} state="thinking" animate className="shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-[var(--color-text)]">
            <span className="sr-only">Opening {title}</span>
            <p aria-hidden="true" className="break-words text-[15px] leading-5 font-extrabold [overflow-wrap:anywhere]">
              {title}
            </p>
            {dishes.length > 0 && (
              <ul className="flex flex-col text-xs leading-4 font-bold">
                {dishes.map((name, i) => (
                  <li key={`${name}-${i}`} className="break-words [overflow-wrap:anywhere]">
                    {name}
                  </li>
                ))}
              </ul>
            )}
            <p
              aria-hidden="true"
              data-testid="meal-open-status-line"
              className="text-xs leading-4 font-bold text-[var(--color-muted)]"
            >
              {STATUS_LINES[line]}
            </p>
          </div>
        </div>
      </PixelPanel>
    </motion.div>
  )
}
