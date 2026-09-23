/**
 * Shared date helpers (issue #524).
 *
 * `localDateString` used to be a private copy inside `lib/api/bubbles.ts`;
 * it's pulled out here so `lib/api/pantry.ts` and `lib/api/recipes.ts` can
 * send the same client-local date without re-deriving it.
 */

/**
 * The caller's local calendar date as YYYY-MM-DD.
 *
 * Deliberately `toLocaleDateString`-based (en-CA formats as YYYY-MM-DD), not
 * `toISOString`, which is UTC and would credit a same-day award to the wrong
 * day for anyone not on UTC.
 */
export function localDateString(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** Add (or subtract, with a negative `days`) whole days to a YYYY-MM-DD date string. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) throw new Error(`addDaysToDateString: invalid date "${dateStr}"`)
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/**
 * The calendar date (YYYY-MM-DD) a UTC timestamp falls on for a client at
 * `offsetMinutes` from UTC — the same "minutes to ADD to UTC to reach local
 * time" convention as `tzOffsetMinutes()` in `lib/api/dashboard.ts` (UTC+2 ->
 * 120, UTC-7 -> -420).
 *
 * Used to bucket server-stored UTC timestamps (`created_at` columns) into
 * the *client's* local day rather than the server's UTC day — bucketing by
 * raw UTC date silently moves a Sunday-evening-local event into Monday for
 * anyone west of UTC (issue #524 review).
 */
export function utcTimestampToLocalDate(timestamp: string, offsetMinutes: number): string {
  const utcMs = new Date(timestamp).getTime()
  return new Date(utcMs + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/**
 * Clamp a client-supplied UTC-offset-in-minutes to real-world timezone
 * bounds (UTC-12 .. UTC+14) and fall back to UTC (0) for anything missing or
 * unparseable, so a bad/absent `tz_offset_minutes` param degrades to the old
 * UTC-bucketing behavior instead of throwing or producing `NaN` dates.
 *
 * Accepts either a raw query-string value (`GET /api/bubbles`) or a JSON
 * body value (`POST` routes send a number, not a string) — issue #550.
 */
export function parseTzOffsetMinutes(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(-720, Math.min(840, Math.trunc(n)))
}

/**
 * Validate a client-supplied local date (YYYY-MM-DD) against the server's
 * own clock shifted by the client's `offsetMinutes` (see
 * `parseTzOffsetMinutes`) — the ONE local date the server will accept, with
 * no window of tolerance either side (issue #550).
 *
 * Earlier versions of this check (issue #520/#524) tolerated up to a day of
 * clock skew either side of the server's UTC date, so a `daily_visit` for
 * tomorrow could be claimed today, and so a client could mint a second
 * `cook_confirm` for one cook by sending yesterday's date on one request and
 * today's on the next. Issue #550 replaces that tolerance with an exact
 * match: the server computes `serverNow` shifted by `offsetMinutes` and
 * formats it as YYYY-MM-DD, and the supplied date must equal that exactly.
 * A `date` one day ahead (or behind) the offset-derived local date is
 * refused, not silently accepted as "close enough".
 *
 * Extracted from `GET /api/bubbles` (issue #520) so the other award routes
 * (`POST /api/pantry/[id]/resolve`, `POST /api/ai/recipes/cook/confirm`) can
 * reuse the same check instead of copy-pasting it.
 *
 * Returns an error message string when invalid, or `null` when the date is
 * fine to use as an award ref_key component.
 */
export function validateClientDate(
  date: unknown,
  offsetMinutes: number,
  fieldLabel = 'date',
): string | null {
  if (!date || typeof date !== 'string') {
    return `${fieldLabel} is required (YYYY-MM-DD, client local date)`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `${fieldLabel} must be YYYY-MM-DD`
  }

  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsedDate.getTime())) {
    return `${fieldLabel} must be a valid date`
  }

  const expectedLocalDate = new Date(Date.now() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10)
  if (date !== expectedLocalDate) {
    return `${fieldLabel} must be the caller's current local date (${expectedLocalDate})`
  }

  return null
}
