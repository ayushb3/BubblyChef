'use client'

/**
 * Issue #652 — the start-now / serve-at toggle for the meal screen, built on
 * `lib/meal-anchor.ts` (`resolveMealAnchor`, `formatClockTime`). Extracted
 * from the #649 demo page's fixture-only version of this same control
 * (`app/meal-timeline-demo/Client.tsx`), which now renders this component
 * instead of its own toggle/time-input/too-late markup.
 *
 * Issue #745 (signature): a segmented keycap toggle, drawn to the Signature
 * "Timeline" board: a 2 px ink pill holding two 44 px radios, the chosen one
 * filled with the theme primary, the fill sliding between them on a spring
 * (no movement under reduced motion). The "Serve at" option also shows the
 * serving time, and in serve-at mode the time is edited in an ink-edged field
 * beneath it.
 *
 * `anchor` is resolved by the caller (it needs the timeline's
 * `total_minutes` and the current clock, neither of which this component
 * has) — this component only renders the result: the toggle, the time input
 * in serve-at mode, and, when `anchor.status === 'too_late'`, the too-late
 * copy plus a "Use <earliest>" key that reports the earliest ready time
 * back as `"HH:MM"` (24-hour, matching `serveAt` / `<input type="time">`).
 *
 * `totalMinutes` (`MealTimeline.total_minutes`) is optional: when the caller
 * has it, the too-late copy matches the #649 demo wording exactly ("this
 * meal needs {N} minutes"); when absent, it falls back to copy that doesn't
 * mention a duration.
 */

import { useId } from 'react'
import { motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import { springs, useMotionConfig } from '@/lib/motion'
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

/** `"HH:MM"` → "7:00 PM", or '' when it isn't a time yet (an emptied input). */
function clockFromHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  const d = new Date(2000, 0, 1, h, m)
  return formatClockTime(d)
}

const SEGMENT =
  'relative min-h-[44px] flex-1 px-3.5 text-[13px] font-extrabold whitespace-nowrap text-[color:var(--color-text)] flex items-center justify-center gap-1.5'

export default function ServeAtControl({
  mode,
  serveAt,
  anchor,
  onModeChange,
  onServeAtChange,
  totalMinutes,
}: ServeAtControlProps) {
  const { reduced } = useMotionConfig()
  const fillId = useId()
  const fill = (
    <motion.span
      layoutId={fillId}
      aria-hidden="true"
      className="absolute inset-0 bg-[var(--color-primary)]"
      transition={reduced ? { duration: 0 } : springs.snappy}
      data-testid="serve-at-fill"
    />
  )
  const time = clockFromHHMM(serveAt)

  return (
    <div className="flex flex-col gap-2" data-testid="serve-at-control">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          aria-label="When to start cooking"
          className="flex w-full max-w-[320px] overflow-hidden rounded-full border-2 border-[color:var(--color-text)] bg-[var(--color-surface)]"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'start-now'}
            onClick={() => onModeChange('start-now')}
            className={SEGMENT}
          >
            {mode === 'start-now' && fill}
            <span className="relative">Start now</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'serve-at'}
            onClick={() => onModeChange('serve-at')}
            className={`${SEGMENT} border-l-2 border-[color:var(--color-text)]`}
          >
            {mode === 'serve-at' && fill}
            <span className="relative">Serve at</span>
            {time && (
              <span aria-hidden="true" className="relative tabular-nums">
                {time}
              </span>
            )}
          </button>
        </div>

        {mode === 'serve-at' && (
          <input
            type="time"
            value={serveAt}
            onChange={(e) => onServeAtChange(e.target.value)}
            aria-label="Serve at time"
            className="min-h-[44px] rounded-full border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] px-4 text-sm font-bold text-[color:var(--color-text)] tabular-nums"
          />
        )}
      </div>

      {anchor.status === 'too_late' && (
        <div
          className="flex flex-col gap-2 rounded-2xl border-2 border-[color:var(--color-text)] bg-[var(--color-surface)] p-3"
          role="status"
          data-testid="serve-at-too-late"
        >
          <p className="text-sm font-bold text-[color:var(--color-text)]">
            {totalMinutes != null
              ? `That's too soon — this meal needs ${totalMinutes} minutes. The earliest it could be ready is ${formatClockTime(anchor.earliest_ready_at)}.`
              : `That's too soon — the earliest this meal could be ready is ${formatClockTime(anchor.earliest_ready_at)}.`}
          </p>
          <SpringButton
            variant="primary"
            onClick={() => onServeAtChange(toHHMM(anchor.earliest_ready_at))}
            className="inline-flex items-center justify-center self-start px-4 py-2.5 text-sm"
          >
            Use {formatClockTime(anchor.earliest_ready_at)}
          </SpringButton>
        </div>
      )}
    </div>
  )
}
