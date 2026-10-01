'use client'

/**
 * Issue #653 — a small "what's after this" preview row under the Now card.
 * Presentational only. Issue #745 (signature): the row carries a vertical bar
 * in the dish's pastel; the dish name is always printed next to it, so the
 * colour is never the only signal.
 */

import { DISH_BG } from './dish-style'
import type { StreamStep } from '@/lib/meal-cook-stream'

export interface MealNextUpProps {
  step: StreamStep | null
  clockLabel: (offsetMinutes: number) => string
}

export default function MealNextUp({ step, clockLabel }: MealNextUpProps) {
  if (!step) {
    return (
      <p className="text-sm font-semibold text-[color:var(--color-text)]" data-testid="meal-next-up">
        That&apos;s the last step.
      </p>
    )
  }

  return (
    <div
      className="flex items-stretch gap-2.5 text-sm text-[color:var(--color-text)]"
      data-testid="meal-next-up"
      role="group"
      aria-label="Next up"
    >
      <span
        aria-hidden="true"
        className={`w-2 flex-shrink-0 self-stretch rounded-full border-[1.5px] border-[color:var(--color-text)] ${DISH_BG[step.column]}`}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[11px] leading-4 font-extrabold tracking-wide uppercase">Next up</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-extrabold">{step.dish_title}</span>
          <span>{step.label}</span>
        </span>
      </div>
      <span className="flex-shrink-0 self-center text-xs font-bold tabular-nums">{clockLabel(step.start)}</span>
    </div>
  )
}
