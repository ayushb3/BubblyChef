'use client'

/**
 * Issue #653 — a small "what's after this" preview row under the Now card.
 * Presentational only. The dish colour dot is never the only signal — the
 * dish name is always printed next to it.
 */

import { COLUMN_COLORS } from './MealTimelineTable'
import type { StreamStep } from '@/lib/meal-cook-stream'

export interface MealNextUpProps {
  step: StreamStep | null
  clockLabel: (offsetMinutes: number) => string
}

export default function MealNextUp({ step, clockLabel }: MealNextUpProps) {
  if (!step) {
    return (
      <p
        className="text-sm"
        style={{ color: 'var(--color-muted)', fontFamily: 'Nunito, sans-serif' }}
        data-testid="meal-next-up"
      >
        That&apos;s the last step.
      </p>
    )
  }

  return (
    <div
      className="flex items-center gap-2 text-sm"
      style={{ color: 'var(--color-text)', fontFamily: 'Nunito, sans-serif' }}
      data-testid="meal-next-up"
      role="group"
      aria-label="Next up"
    >
      <span
        aria-hidden="true"
        className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
        style={{ background: COLUMN_COLORS[step.column] }}
      />
      <span className="font-bold">{step.dish_title}</span>
      <span>{step.label}</span>
      <span className="ml-auto text-xs" style={{ color: 'var(--color-muted)' }}>
        {clockLabel(step.start)}
      </span>
    </div>
  )
}
