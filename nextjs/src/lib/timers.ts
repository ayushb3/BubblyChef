/**
 * Issue #495 — Spec B.3 cooking timers.
 *
 * Pure, framework-free helpers shared by the timer store (`useCookingTimers`)
 * and the UI that surfaces timers (step chips, the header quick-set, the
 * dock). Kept dependency-free and side-effect-free so they're trivial to
 * unit test and safe to call during render.
 */

/** A duration phrase found in a piece of step text. */
export interface ParsedDuration {
  /**
   * Short human label for the duration itself, e.g. "15 min", "1 hr",
   * "45 sec". For a range ("15–20 minutes") this names the lower bound that
   * `seconds` actually uses and says so, e.g. "15 min (low end of 15–20 min)".
   */
  label: string
  /** Duration in whole seconds. For a range, the lower bound. */
  seconds: number
  /**
   * Set only for a range match ("15–20 minutes"): a short note naming the
   * full range, e.g. "of 15–20 min". Threaded into the *started timer's*
   * own name (not just the chip that started it) so "used the lower bound"
   * stays visible in the dock too, per the spec's "say so in the label".
   */
  rangeNote?: string
}

type Unit = 'second' | 'minute' | 'hour'

const UNIT_SECONDS: Record<Unit, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
}

const UNIT_ABBREV: Record<Unit, string> = {
  second: 'sec',
  minute: 'min',
  hour: 'hr',
}

/** Canonicalises any accepted unit spelling to one of `second | minute | hour`. */
function canonicalUnit(raw: string): Unit | null {
  const u = raw.toLowerCase()
  if (/^(seconds?|secs?)$/.test(u)) return 'second'
  if (/^(minutes?|mins?)$/.test(u)) return 'minute'
  if (/^(hours?|hrs?)$/.test(u)) return 'hour'
  return null
}

/**
 * Matches a duration phrase: a lead amount (a number, or "a"/"an" for one),
 * an optional range upper bound ("15-20", "15 to 20", "15–20"), and a unit
 * word. Global + case-insensitive so `parseDurations` can find every match
 * in a step of text.
 */
const DURATION_RE =
  /\b(a|an|\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * Finds every parseable duration in `stepText` and returns each as
 * `{ label, seconds }`. Handles "15 min", "15 minutes", "1 hour",
 * "1–2 hours" (and "1-2 hours" / "1 to 2 hours"), "45 seconds", "an hour".
 * Zero-length matches (e.g. "0 minutes") are dropped — there is nothing
 * useful to start a timer for.
 */
export function parseDurations(stepText: string): ParsedDuration[] {
  const results: ParsedDuration[] = []
  if (!stepText) return results

  for (const match of stepText.matchAll(DURATION_RE)) {
    const [, loRaw, hiRaw, unitRaw] = match
    const unit = canonicalUnit(unitRaw)
    if (!unit) continue

    const lo = loRaw === 'a' || loRaw === 'an' ? 1 : parseFloat(loRaw)
    if (!Number.isFinite(lo) || lo <= 0) continue

    const seconds = Math.round(lo * UNIT_SECONDS[unit])
    if (seconds <= 0) continue

    const abbrev = UNIT_ABBREV[unit]
    const loText = formatAmount(lo)
    const rangeNote = hiRaw ? `of ${loText}–${formatAmount(parseFloat(hiRaw))} ${abbrev}` : undefined
    const label = rangeNote
      ? `${loText} ${abbrev} (low end ${rangeNote})`
      : `${loText} ${abbrev}`

    results.push(rangeNote ? { label, seconds, rangeNote } : { label, seconds })
  }

  return results
}

/** Formats seconds as `m:ss`, or `h:mm:ss` once the duration reaches an hour. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Derives a short, human name for a step so a timer started from it reads
 * as "Simmer sauce" rather than the whole instruction sentence. Takes the
 * text up to the first comma/semicolon/period, capped at 6 words.
 */
export function deriveStepLabel(stepText: string): string {
  const clause = stepText.split(/[.,;]/)[0]?.trim() ?? stepText.trim()
  const words = clause.split(/\s+/).filter(Boolean).slice(0, 6)
  return words.join(' ') || 'Step'
}
