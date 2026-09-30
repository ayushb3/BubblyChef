/**
 * Shared date helpers (issue #524).
 *
 * `localDateString` used to be a private copy inside `lib/api/bubbles.ts`;
 * it's pulled out here so other client code can derive the same local date
 * without re-deriving it.
 */

/**
 * The caller's local calendar date as YYYY-MM-DD.
 *
 * Deliberately `toLocaleDateString`-based (en-CA formats as YYYY-MM-DD), not
 * `toISOString`, which is UTC and would credit a same-day award to the wrong
 * day for anyone not on UTC.
 *
 * Display/convenience only: since issue #550 no bubbles award trusts a date
 * the client sends (see `lib/ledger-date.ts`).
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
 *
 * Since issue #550 the offset fed to this comes from the account's stored
 * zone (`resolveLedgerDate`), never from a request parameter.
 */
export function utcTimestampToLocalDate(timestamp: string, offsetMinutes: number): string {
  const utcMs = new Date(timestamp).getTime()
  return new Date(utcMs + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/**
 * The caller's IANA time zone (e.g. `America/Los_Angeles`).
 *
 * Sent to the server so it can store the account's zone ONCE and derive the
 * one accepted local date for every bubbles award from that plus its own
 * clock (issue #550, see `lib/ledger-date.ts`). Deliberately a zone name, not
 * a date or a UTC offset: the server never takes a per-request date from the
 * client, so there is nothing here for a caller to shift. Empty string when
 * the runtime can't say (the server treats that as "no zone").
 */
export function clientTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return ''
  }
}
