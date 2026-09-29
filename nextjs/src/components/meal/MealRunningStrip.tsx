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
 */

import { COLUMN_COLORS } from './MealTimelineTable'
import type { StreamStep } from '@/lib/meal-cook-stream'

export interface MealRunningStripProps {
  steps: StreamStep[]
  clockLabel: (offsetMinutes: number) => string
}

export default function MealRunningStrip({ steps, clockLabel }: MealRunningStripProps) {
  if (steps.length === 0) return null

  return (
    <ul
      className="flex flex-col gap-1.5"
      style={{ fontFamily: 'Nunito, sans-serif' }}
      data-testid="meal-running-strip"
      aria-label="Running now"
    >
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full inline-block flex-shrink-0"
            style={{ background: COLUMN_COLORS[step.column] }}
          />
          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
            {step.dish_title}
          </span>
          <span>
            {step.ongoing_label ?? step.label} · until {clockLabel(step.end)}
          </span>
        </li>
      ))}
    </ul>
  )
}
