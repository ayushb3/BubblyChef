'use client'

/**
 * Issue #652 — the start-now / serve-at toggle for the meal screen, built on
 * `lib/meal-anchor.ts` (`resolveMealAnchor`, `formatClockTime`). Extracted
 * from the #649 demo page's fixture-only version of this same control
 * (`app/meal-timeline-demo/Client.tsx`), which now renders this component
 * instead of its own toggle/time-input/too-late markup.
 *
 * `anchor` is resolved by the caller (it needs the timeline's
 * `total_minutes` and the current clock, neither of which this component
 * has) — this component only renders the result: the toggle, the time input
 * in serve-at mode, and, when `anchor.status === 'too_late'`, the too-late
 * copy plus a "Use <earliest>" button that reports the earliest ready time
 * back as `"HH:MM"` (24-hour, matching `serveAt` / `<input type="time">`).
 *
 * `totalMinutes` (`MealTimeline.total_minutes`) is optional: when the caller
 * has it, the too-late copy matches the #649 demo wording exactly ("this
 * meal needs {N} minutes"); when absent, it falls back to copy that doesn't
 * mention a duration.
 */

import type { MealAnchorResult } from '@/lib/meal-anchor'
import { formatClockTime } from '@/lib/meal-anchor'

export type ServeAtMode = 'start-now' | 'serve-at'

export interface ServeAtControlProps {
  mode: ServeAtMode
  /** `"HH:MM"`, 24-hour — the `<input type="time">` value. */
  serveAt: string
  anchor: MealAnchorResult
  onModeChange: (mode: ServeAtMode) => void
  onServeAtChange: (hhmm: string) => void
  /** `MealTimeline.total_minutes` — sharpens the too-late copy when supplied. */
  totalMinutes?: number
}

/** `Date` → `"HH:MM"`, 24-hour, for the `<input type="time">` value shape. */
function toHHMM(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export default function ServeAtControl({
  mode,
  serveAt,
  anchor,
  onModeChange,
  onServeAtChange,
  totalMinutes,
}: ServeAtControlProps) {
  return (
    <div className="flex flex-col gap-2" data-testid="serve-at-control" style={{ fontFamily: 'Nunito, sans-serif' }}>
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          aria-label="When to start cooking"
          className="inline-flex rounded-full p-1"
          style={{ background: 'var(--color-bg)', border: '1.5px solid var(--color-border)' }}
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'start-now'}
            onClick={() => onModeChange('start-now')}
            className="min-h-[44px] px-4 rounded-full text-sm font-bold"
            style={{
              background: mode === 'start-now' ? 'var(--color-primary)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            Start now
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'serve-at'}
            onClick={() => onModeChange('serve-at')}
            className="min-h-[44px] px-4 rounded-full text-sm font-bold"
            style={{
              background: mode === 'serve-at' ? 'var(--color-primary)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            Serve at
          </button>
        </div>

        {mode === 'serve-at' && (
          <input
            type="time"
            value={serveAt}
            onChange={(e) => onServeAtChange(e.target.value)}
            aria-label="Serve at time"
            className="min-h-[44px] rounded-xl border px-3 text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}
          />
        )}
      </div>

      {anchor.status === 'too_late' && (
        <div
          className="rounded-2xl p-3 flex flex-col gap-2"
          style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)' }}
          role="status"
          data-testid="serve-at-too-late"
        >
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            {totalMinutes != null
              ? `That's too soon — this meal needs ${totalMinutes} minutes. The earliest it could be ready is ${formatClockTime(anchor.earliest_ready_at)}.`
              : `That's too soon — the earliest this meal could be ready is ${formatClockTime(anchor.earliest_ready_at)}.`}
          </p>
          <button
            type="button"
            onClick={() => onServeAtChange(toHHMM(anchor.earliest_ready_at))}
            className="self-start min-h-[44px] px-4 rounded-full text-sm font-bold"
            style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
          >
            Use {formatClockTime(anchor.earliest_ready_at)}
          </button>
        </div>
      )}
    </div>
  )
}
