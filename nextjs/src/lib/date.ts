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
 * Validate a client-supplied local date (YYYY-MM-DD) against the server's
 * own clock, tolerating up to a day of skew either side — a signed-in
 * timezone can be up to 14 hours off UTC, which spans a full calendar day
 * either side of the server's date.
 *
 * Extracted from `GET /api/bubbles` (issue #520) so the two new award routes
 * in issue #524 (`POST /api/pantry/[id]/resolve`, `POST
 * /api/ai/recipes/cook/confirm`) can reuse the same check instead of
 * copy-pasting it.
 *
 * Returns an error message string when invalid, or `null` when the date is
 * fine to use as an award ref_key component.
 */
export function validateClientDate(date: unknown, fieldLabel = 'date'): string | null {
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

  // Anything further off than a day either side is not a real client clock
  // skew case — reject it so a signed-in user can't loop ?date=1, ?date=2,
  // ... and mint unlimited date-keyed awards.
  const msPerDay = 24 * 60 * 60 * 1000
  const serverToday = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const dayDiff = Math.abs(parsedDate.getTime() - serverToday.getTime()) / msPerDay
  if (dayDiff > 1) {
    return `${fieldLabel} is too far from the server date`
  }

  return null
}
