'use client'

/**
 * Issue #495 — Spec B.3, shape C: step-level ⏱ chips.
 *
 * Renders one chip per parseable duration in a step's text (usually one).
 * Replaces the non-functional placeholder that used to live inline in
 * `GuidedCookFlow.tsx` (`TimerChip`, "real timers = issue #45 / Spec B").
 * Renders nothing when the step has no parseable duration — callers don't
 * need to guard on `parseDurations` themselves.
 */

import { useCookingTimers } from '@/lib/useCookingTimers'
import { parseDurations, deriveStepLabel, formatDuration } from '@/lib/timers'

export interface StepTimerChipsProps {
  stepText: string
  className?: string
}

export default function StepTimerChips({ stepText, className }: StepTimerChipsProps) {
  const { start } = useCookingTimers()
  const durations = parseDurations(stepText)

  if (durations.length === 0) return null

  const stepLabel = deriveStepLabel(stepText)

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      {durations.map((d, i) => (
        <button
          key={`${d.seconds}-${i}`}
          type="button"
          onClick={() => start(`${stepLabel} · ${formatDuration(d.seconds)}`, d.seconds)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold active:scale-95 transition-transform"
          style={{
            background: 'var(--color-bg)',
            color: 'var(--color-primary-dark)',
            border: '1px solid var(--color-border)',
            fontFamily: 'Nunito, sans-serif',
          }}
          aria-label={`Start a ${d.label} timer for ${stepLabel}`}
          title={`Start timer: ${d.label}`}
          data-testid="step-timer-chip"
        >
          ⏱️ {d.label}
        </button>
      ))}
    </span>
  )
}
