'use client'

/**
 * Issue #653 — the hands-off steps running right now, e.g. "the sauce
 * simmers · until 7:22". Presentational only; the live countdown itself
 * lives in the timer dock, not here.
 *
 * `StreamStep.ongoing_label` (a contract addendum after this component's
 * first pass — see `lib/meal-cook-stream.ts`) is the in-progress clause
 * ("the sauce simmers"); falls back to `label` ("Simmer the sauce") when a
 * step has none.
 *
 * Issue #745 (signature): a running step is "just cooking", so each row is
 * drawn hatched with a dashed edge — the timeline's own language — with a
 * pastel bar for its dish and the dish name printed beside it.
 */

import { DISH_BG, HATCHED } from './dish-style'
import type { StreamStep } from '@/lib/meal-cook-stream'

export interface MealRunningStripProps {
  steps: StreamStep[]
  clockLabel: (offsetMinutes: number) => string
}

export default function MealRunningStrip({ steps, clockLabel }: MealRunningStripProps) {
  if (steps.length === 0) return null

  return (
    <ul className="flex flex-col gap-1.5" data-testid="meal-running-strip" aria-label="Running now">
      {steps.map((step) => (
        <li
          key={step.key}
          data-look="hatched"
          className={`flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-xs text-[color:var(--color-text)] ${HATCHED}`}
        >
          <span
            aria-hidden="true"
            className={`h-4 w-1.5 flex-shrink-0 rounded-full border-[1.5px] border-[color:var(--color-text)] ${DISH_BG[step.column]}`}
          />
          <span className="font-extrabold">{step.dish_title}</span>
          <span className="font-semibold">
            {step.ongoing_label ?? step.label} · until {clockLabel(step.end)}
          </span>
        </li>
      ))}
    </ul>
  )
}
