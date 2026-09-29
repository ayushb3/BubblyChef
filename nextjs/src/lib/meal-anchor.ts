/**
 * Issue #649 / #647 — anchor helper.
 *
 * Maps a `MealTimeline`'s minute offsets onto clock time. Kept separate
 * from `meal-scheduler.ts` (the scheduler never reads a clock) and pure:
 * `now` is always passed in by the caller, never read via `Date.now()`.
 *
 * - **start-now** (default): offsets render as relative labels ("+0",
 *   "+12 min") until cooking actually begins, at which point `started_at`
 *   is supplied and offsets become clock times.
 * - **serve-at**: start = serve_at − total_minutes. A start already in the
 *   past returns `too_late` plus the earliest the meal could actually be
 *   ready, for the UI to offer instead.
 */

export type MealAnchorMode = 'start-now' | 'serve-at'

export interface MealAnchorInput {
  mode: MealAnchorMode
  /** `MealTimeline.total_minutes`. */
  total_minutes: number
  now: Date
  /** Required (and only used) when `mode` is `'serve-at'`. */
  serve_at?: Date
  /**
   * Once cook-along has actually begun, the real clock start — takes
   * priority over `mode`, since a meal that started as serve-at 7:00 still
   * anchors to the moment cooking began, not the original target.
   */
  started_at?: Date
}

export interface MealAnchorRelative {
  status: 'relative'
}

export interface MealAnchorClock {
  status: 'clock'
  start_at: Date
}

export interface MealAnchorTooLate {
  status: 'too_late'
  earliest_ready_at: Date
}

export type MealAnchorResult = MealAnchorRelative | MealAnchorClock | MealAnchorTooLate

/**
 * Rounds a `Date` up to the next whole minute — but only when it actually
 * has a non-zero second/millisecond component, so an already-round instant
 * isn't pushed a minute later for no reason.
 *
 * `earliest_ready_at` needs this: it's built from `now`, which carries real
 * seconds, but the UI only ever offers it back as an `"HH:MM"` value (the
 * `<input type="time">` shape). Truncating instead of rounding up would
 * suggest a time that's *not actually* far enough out — e.g. `now` at
 * `18:00:30` plus a 40-minute meal is `18:40:30`; truncated to `"18:40"` and
 * rebuilt at `:00` seconds, that start lands 30s before `now` again, and
 * "Use 6:40 PM" would immediately relitigate as too late.
 */
function ceilToMinute(date: Date): Date {
  if (date.getSeconds() === 0 && date.getMilliseconds() === 0) return date
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)
  rounded.setMinutes(rounded.getMinutes() + 1)
  return rounded
}

export function resolveMealAnchor(input: MealAnchorInput): MealAnchorResult {
  if (input.started_at) {
    return { status: 'clock', start_at: input.started_at }
  }

  if (input.mode === 'start-now') {
    return { status: 'relative' }
  }

  if (!input.serve_at) {
    // Defensive: serve-at mode with no target yet (e.g. still choosing a
    // time in the UI) — render relative rather than throwing.
    return { status: 'relative' }
  }

  const startAt = new Date(input.serve_at.getTime() - input.total_minutes * 60_000)

  // Minute granularity, not raw milliseconds: `serve_at` only ever comes
  // from an `"HH:MM"` input, so `startAt` always lands on a whole minute
  // (:00 seconds) — but `now` carries real seconds. Comparing raw ms would
  // make a `startAt` in the *same* minute as `now` register as too_late
  // whenever `now`'s seconds are non-zero, even though a minute-precision
  // clock can't tell them apart. A serve time whose start is in an earlier
  // minute is still too late.
  const startMinute = Math.floor(startAt.getTime() / 60_000)
  const nowMinute = Math.floor(input.now.getTime() / 60_000)
  if (startMinute < nowMinute) {
    const earliestReadyAt = ceilToMinute(new Date(input.now.getTime() + input.total_minutes * 60_000))
    return { status: 'too_late', earliest_ready_at: earliestReadyAt }
  }
  return { status: 'clock', start_at: startAt }
}

/** "+0" / "+12 min". */
export function formatRelativeOffset(minutes: number): string {
  return minutes === 0 ? '+0' : `+${minutes} min`
}

/** "7:12 PM" — locale pinned to `en-US` so output is stable across CI/machines. */
export function formatClockTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * The label a table cell should show for a given row offset, given the
 * resolved anchor: a clock time once a start is known (started, or a
 * feasible serve-at), otherwise the relative offset.
 */
export function anchoredTimeLabel(anchor: MealAnchorResult, offsetMinutes: number): string {
  if (anchor.status === 'clock') {
    return formatClockTime(new Date(anchor.start_at.getTime() + offsetMinutes * 60_000))
  }
  return formatRelativeOffset(offsetMinutes)
}
