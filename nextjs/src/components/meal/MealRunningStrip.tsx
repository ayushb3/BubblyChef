'use client'

/**
 * Issue #653 — the hands-off steps running right now, e.g. "the sauce
 * simmers · until 7:22". Presentational only; the live countdown itself
 * lives in the timer dock, not here.
 *
 * Contract §3's `StreamStep` (the type this renders) carries `label`
 * ("Simmer the sauce", a short imperative) but no `ongoing_label` field —
 * that field exists on the structured `Step` the scheduler consumes, not on
 * the derived stream step the contract specifies here. The contract's own
 * example phrasing ("the sauce simmers") reads like an `ongoing_label`, so
 * this is flagged as a likely contract gap rather than silently reproduced:
 * this component renders `step.label` since that's the only text `StreamStep`
 * actually has.
 */

import { COLUMN_COLORS } from './MealTimelineTable'
import type { StreamStep } from './streamTypes'

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
            {step.label} · until {clockLabel(step.end)}
          </span>
        </li>
      ))}
    </ul>
  )
}
