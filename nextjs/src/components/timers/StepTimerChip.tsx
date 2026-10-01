'use client'

/**
 * Issue #495 — Spec B.3, shape C: step-level ⏱ chips.
 *
 * Renders one chip per parseable duration in a step's text (usually one).
 * Replaces the non-functional placeholder that used to live inline in
 * `GuidedCookFlow.tsx` (`TimerChip`, "real timers = issue #45 / Spec B").
 * Renders nothing when the step has no parseable duration — callers don't
 * need to guard on `parseDurations` themselves.
 *
 * Issue #825: `keycap` draws each chip as the secondary keycap (the same key the
 * meal cook's action row uses) instead of the small flat pill. Behaviour, test
 * ids and accessible names are identical; the default stays the pill, which the
 * recipe page's step list still uses.
 */

/** Layout of a keycap chip: wraps instead of overflowing a narrow card. */
const KEYCAP_LAYOUT =
  'inline-flex max-w-full items-center justify-center gap-2 px-[18px] py-2.5 text-sm leading-5 text-center'

import { useCookingTimers } from '@/lib/useCookingTimers'
import SpringButton from '@/components/ui/SpringButton'
import { parseDurations, deriveStepLabel, formatDuration } from '@/lib/timers'

export interface StepTimerChipsProps {
  stepText: string
  className?: string
  /** Issue #757 — called with the new timer's id, so the caller can tie it to its step. */
  onStart?: (timerId: string) => void
  /** Issue #825 — draw the chips as secondary keycaps (see above). */
  keycap?: boolean
}

export default function StepTimerChips({ stepText, className, onStart, keycap = false }: StepTimerChipsProps) {
  const { start } = useCookingTimers()
  const durations = parseDurations(stepText)

  if (durations.length === 0) return null

  const stepLabel = deriveStepLabel(stepText)

  return (
    <span className={`inline-flex flex-wrap items-center ${keycap ? 'gap-2.5' : 'gap-1.5'} ${className ?? ''}`}>
      {durations.map((d, i) => {
        const startThis = () => {
          const id = start(
            `${stepLabel} · ${formatDuration(d.seconds)}${d.rangeNote ? ` (${d.rangeNote})` : ''}`,
            d.seconds,
          )
          onStart?.(id)
        }
        if (keycap) {
          return (
            <SpringButton
              key={`${d.seconds}-${i}`}
              variant="secondary"
              className={KEYCAP_LAYOUT}
              onClick={startThis}
              aria-label={`Start a ${d.label} timer for ${stepLabel}`}
              title={`Start timer: ${d.label}`}
              data-testid="step-timer-chip"
            >
              ⏱️ {d.label}
            </SpringButton>
          )
        }
        return (
        <button
          key={`${d.seconds}-${i}`}
          type="button"
          onClick={startThis}
          className="font-sans inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold active:scale-95 transition-transform"
          style={{
            background: 'var(--color-bg)',
            color: 'var(--color-primary-dark)',
            border: '1px solid var(--color-border)',
          }}
          aria-label={`Start a ${d.label} timer for ${stepLabel}`}
          title={`Start timer: ${d.label}`}
          data-testid="step-timer-chip"
        >
          ⏱️ {d.label}
        </button>
        )
      })}
    </span>
  )
}

/**
 * Issue #648 — the structured-step counterpart to `StepTimerChips` above.
 *
 * Renders one chip for a hands-off step's real `duration_minutes`, named
 * with the step's own `label` rather than a regex guess. Same visual
 * treatment as the regex chip so a step doesn't visibly change style once
 * its recipe's steps go from derived-on-the-fly to structured.
 */
export interface StructuredStepTimerChipProps {
  label: string
  durationMinutes: number
  className?: string
  /** Issue #757 — called with the new timer's id, so the caller can tie it to its step. */
  onStart?: (timerId: string) => void
  /** Issue #825 — draw the chip as a secondary keycap (see `StepTimerChipsProps`). */
  keycap?: boolean
}

export function StructuredStepTimerChip({
  label,
  durationMinutes,
  className,
  onStart,
  keycap = false,
}: StructuredStepTimerChipProps) {
  const { start } = useCookingTimers()
  const seconds = Math.max(1, Math.round(durationMinutes * 60))
  // `durationMinutes` label matches the regex chip's own label style ("15
  // min"), not `formatDuration`'s mm:ss — that's reserved for the countdown
  // shown once a timer is actually running (the dock, `TimerList` etc.).
  const durationText = `${durationMinutes} min`

  if (keycap) {
    return (
      <span className={`inline-flex max-w-full ${className ?? ''}`}>
        <SpringButton
          variant="secondary"
          className={KEYCAP_LAYOUT}
          onClick={() => onStart?.(start(`${label} · ${durationText}`, seconds))}
          aria-label={`Start a ${durationText} timer for ${label}`}
          title={`Start timer: ${label}`}
          data-testid="structured-step-timer-chip"
        >
          ⏱️ {label} · {durationText}
        </SpringButton>
      </span>
    )
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => onStart?.(start(`${label} · ${durationText}`, seconds))}
        className="font-sans inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold active:scale-95 transition-transform"
        style={{
          background: 'var(--color-bg)',
          color: 'var(--color-primary-dark)',
          border: '1px solid var(--color-border)',
        }}
        aria-label={`Start a ${durationText} timer for ${label}`}
        title={`Start timer: ${label}`}
        data-testid="structured-step-timer-chip"
      >
        ⏱️ {label} · {durationText}
      </button>
    </span>
  )
}
