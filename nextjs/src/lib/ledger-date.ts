/**
 * The one exact local date every bubbles ledger key hangs off — issue #550.
 *
 * `daily_visit`, `cook_confirm` and `rescue` (and the weekly-streak
 * `referenceDate`) all key on a calendar date. That date used to come from
 * the client (`?date=`, ±1 day tolerated), which meant tomorrow's visit could
 * be claimed today, and from the server's UTC clock for cooks, which meant one
 * cook straddling UTC midnight paid twice in a single local day.
 *
 * The accepted date is now computed HERE, on the server, from two things the
 * caller can't restate per request:
 *
 *   1. the server's own clock, and
 *   2. the account's stored IANA time zone, kept in auth `app_metadata`
 *      (`ledger_tz`, `ledger_tz_set_at`). `app_metadata` is writable only with
 *      the service role — unlike `user_metadata`, a signed-in user cannot edit
 *      it from the browser with their anon key. No migration is involved.
 *
 * A client `tz` is only ever a PROPOSAL: it is adopted the first time an
 * account is seen, and can move the stored zone at most once per
 * `TZ_CHANGE_COOLDOWN_MS` (a real move or a wrong first guess can be
 * corrected; repeated flipping to harvest an extra day cannot). Between
 * changes the date of any request is pure (server clock, stored zone), so a
 * spoofed or absurd `tz`, `date` or UTC offset cannot move a key.
 *
 * An IANA zone (not a raw offset) is stored on purpose: it follows DST, and a
 * raw offset is exactly the free-form number a spoofer would choose.
 *
 * Never throws. `null` means "no trustworthy local date for this request":
 * callers must skip the date-keyed award (never the user's own write).
 */

import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * How long a stored zone is sticky. One week: long enough that flipping it to
 * gain a day is worth at most one bubble a week, short enough that a mover or
 * a wrong first guess fixes itself without a support path.
 */
export const TZ_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

export interface LedgerDate {
  /** The one accepted local calendar date, YYYY-MM-DD. */
  date: string
  /** Canonical IANA zone the date was computed in. */
  timeZone: string
  /** Minutes to ADD to UTC to reach local time at `now` (UTC+2 -> 120). */
  offsetMinutes: number
}

// IANA names are `Area/Location[/Sub]` or a bare token like `UTC`. The shape
// check keeps raw offsets ("+14:00") and junk out before Intl sees them;
// Intl then confirms the name really exists.
const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/

/** The canonical name Intl resolves `tz` to, or `null` when it isn't a real IANA zone. */
function canonicalZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64 || !ZONE_SHAPE.test(tz)) {
    return null
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

export function isValidTimeZone(tz: unknown): tz is string {
  return canonicalZone(tz) !== null
}

function zoneParts(instant: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const out: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return out
}

/** The calendar date (YYYY-MM-DD) `timeZone` is on at `instant`. */
export function localDateInZone(instant: Date, timeZone: string): string {
  const p = zoneParts(instant, timeZone)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Minutes to add to UTC to reach `timeZone`'s local time at `instant`. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zoneParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // Drop sub-second noise from `instant` so the difference is whole minutes.
  const truncated = Math.floor(instant.getTime() / 1000) * 1000
  return Math.round((asUtc - truncated) / 60_000)
}

/** Persist the zone with the service role. `false` on any failure — never throws. */
async function storeZone(userId: string, timeZone: string, now: Date): Promise<boolean> {
  try {
    const sb = createServiceClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await sb.auth.admin.updateUserById(userId, {
      app_metadata: { ledger_tz: timeZone, ledger_tz_set_at: now.toISOString() },
    })
    if (error) {
      console.error('[ledger-date] storing zone failed: %s', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[ledger-date] storing zone threw: %s', err)
    return false
  }
}

function result(now: Date, timeZone: string): LedgerDate {
  return {
    date: localDateInZone(now, timeZone),
    timeZone,
    offsetMinutes: zoneOffsetMinutes(now, timeZone),
  }
}

/**
 * Resolve the one accepted local date for this request.
 *
 * `claimedTz` is whatever the client sent (untrusted). `user` must come from
 * `supabase.auth.getUser()` (as `requireAuth` does), which reads
 * `app_metadata` from the auth server, not from a possibly-stale JWT.
 */
export async function resolveLedgerDate(
  user: Pick<User, 'id' | 'app_metadata'>,
  claimedTz: unknown,
  now: Date = new Date(),
): Promise<LedgerDate | null> {
  try {
    const meta = (user.app_metadata ?? {}) as { ledger_tz?: unknown; ledger_tz_set_at?: unknown }
    const stored = canonicalZone(meta.ledger_tz)
    const claimed = canonicalZone(claimedTz)

    if (!stored) {
      // First time this account is seen. Trust the claim only if it was
      // actually stored: an unstored zone honoured for one request and then
      // replaced could key the same action twice.
      if (!claimed) return null
      return (await storeZone(user.id, claimed, now)) ? result(now, claimed) : null
    }

    if (claimed && claimed !== stored) {
      const setAt = typeof meta.ledger_tz_set_at === 'string' ? Date.parse(meta.ledger_tz_set_at) : NaN
      const cooledDown = Number.isNaN(setAt) || now.getTime() - setAt >= TZ_CHANGE_COOLDOWN_MS
      if (cooledDown && (await storeZone(user.id, claimed, now))) {
        return result(now, claimed)
      }
    }

    return result(now, stored)
  } catch (err) {
    console.error('[ledger-date] resolve threw: %s', err)
    return null
  }
}
