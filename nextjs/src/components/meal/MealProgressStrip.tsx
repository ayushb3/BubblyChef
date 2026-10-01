'use client'

/**
 * Issue #745 — the cook-along's per-dish progress strip: one bar per dish,
 * filled with that dish's pastel as its steps are done or skipped, the dish
 * name and "N of M steps done" printed beneath (the bar is never the only
 * signal). Presentational; `dishProgress` (./dish-progress) builds the data.
 *
 * Under reduced motion the bar jumps; otherwise its fill eases on a short
 * tween. Renders nothing for an empty list.
 */

import { useMotionConfig } from '@/lib/motion'
import { DISH_BG } from './dish-style'
import type { DishProgress } from './dish-progress'

export interface MealProgressStripProps {
  progress: DishProgress[]
}

export default function MealProgressStrip({ progress }: MealProgressStripProps) {
  const { reduced } = useMotionConfig()
  if (progress.length === 0) return null

  return (
    <ul className="flex gap-3" aria-label="Progress by dish" data-testid="meal-progress-strip">
      {progress.map(({ column, title, done, total }) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0
        return (
          <li key={column} className="flex min-w-0 flex-1 flex-col gap-1">
            <span
              aria-hidden="true"
              className="block h-2 overflow-hidden rounded-full border-[1.5px] border-[color:var(--color-text)] bg-[var(--color-surface)]"
            >
              <span
                className={`block h-full ${DISH_BG[column]} ${reduced ? '' : 'transition-[width] duration-300 ease-out'}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="truncate text-[11px] leading-[14px] font-extrabold text-[color:var(--color-text)]">
              {title}
            </span>
            <span className="text-[11px] leading-[14px] font-bold text-[color:var(--color-text)] tabular-nums">
              <span aria-hidden="true">
                {done}/{total}
              </span>
              <span className="sr-only">
                {done} of {total} steps done
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
