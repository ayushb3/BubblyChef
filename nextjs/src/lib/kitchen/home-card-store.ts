/**
 * The Bubbles card's records (issue #755), device-local like the pending scan and
 * tonight's plan (the signature PRD's decision 5): no schema, no API.
 *
 *  - `seen`: fingerprint -> the local day it was first shown. The once-a-day cap
 *    reads it; only today's entries can cap anything, so earlier days are dropped
 *    on every write.
 *  - `dismissed`: fingerprints the user sent away with the cross (Not now). A
 *    dismissal lasts until the fingerprint changes (a different item, step, scan
 *    or meal), so it is kept across days, bounded to the newest `MAX_DISMISSED`.
 *
 * Reads are defensive: unavailable storage, junk or another version read as empty
 * records, and a malformed entry is dropped rather than failing the rest. Storage
 * and the clock are injected so the module is tested without a DOM.
 */

export const HOME_CARD_KEY = 'bubblychef:homecard:v1'

const VERSION = 1

/** Dismissals kept; the oldest go first. Fingerprints are short, so this is tiny. */
const MAX_DISMISSED = 50

export interface HomeCardRecords {
  seen: Record<string, string>
  dismissed: string[]
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The local calendar day as `YYYY-MM-DD`, the unit of the once-a-day cap. */
export function localDay(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

export function readHomeCardRecords(storage: Storage | null = defaultStorage()): HomeCardRecords {
  const empty: HomeCardRecords = { seen: {}, dismissed: [] }
  let raw: string | null
  try {
    raw = storage?.getItem(HOME_CARD_KEY) ?? null
  } catch {
    return empty
  }
  if (!raw) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty
  const p = parsed as Record<string, unknown>
  if (p.v !== VERSION) return empty

  const seen: Record<string, string> = {}
  if (typeof p.seen === 'object' && p.seen !== null && !Array.isArray(p.seen)) {
    for (const [fingerprint, day] of Object.entries(p.seen)) {
      if (typeof day === 'string') seen[fingerprint] = day
    }
  }
  const dismissed = Array.isArray(p.dismissed)
    ? p.dismissed.filter((d): d is string => typeof d === 'string')
    : []
  return { seen, dismissed }
}

function write(records: HomeCardRecords, storage: Storage | null): void {
  try {
    storage?.setItem(HOME_CARD_KEY, JSON.stringify({ v: VERSION, ...records }))
  } catch {
    // Worst case a nudge shows once more than it should: not a failure worth a crash.
  }
}

/** Record that `fingerprint` was shown today. The first day wins; earlier days are forgotten. */
export function markNudgeSeen(
  fingerprint: string,
  now: Date,
  storage: Storage | null = defaultStorage(),
): void {
  const today = localDay(now)
  const { seen, dismissed } = readHomeCardRecords(storage)
  const kept: Record<string, string> = {}
  for (const [fp, day] of Object.entries(seen)) {
    if (day === today) kept[fp] = day
  }
  if (!(fingerprint in kept)) kept[fingerprint] = today
  write({ seen: kept, dismissed }, storage)
}

/** Record a Not now: the nudge stays away until its fingerprint changes. */
export function dismissNudge(
  fingerprint: string,
  storage: Storage | null = defaultStorage(),
): void {
  const { seen, dismissed } = readHomeCardRecords(storage)
  if (dismissed.includes(fingerprint)) return
  write({ seen, dismissed: [...dismissed, fingerprint].slice(-MAX_DISMISSED) }, storage)
}
