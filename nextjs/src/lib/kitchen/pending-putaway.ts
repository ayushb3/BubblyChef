/**
 * The pending put-away (issue #753, Goal 2 of the signature PRD).
 *
 * After a receipt scan parses, both entry points (the `/scan` page and the
 * pantry add sheet's scan tab) hand the result to the kitchen home, where a
 * put-away sheet opens over the scene. The parsed scan is kept here, in local
 * storage on the device, until it is put away or discarded:
 *
 *  - a reload (or leaving and coming back) reopens put-away from this record;
 *  - the sheet's edits (Fix, Yes, a moved place) are written back, so they
 *    survive a reload too;
 *  - the Bubbles card (issue #755) reads it to say "not put away yet".
 *
 * Nothing in here writes to the pantry. The record is a draft of a scan the user
 * has not confirmed; the only write is `bulkAddPantryItems`, on "Put away".
 *
 * No schema change and no API: it is device-local state (the PRD's decision 5).
 *
 * Reads are defensive, like `lib/cook-session.ts`: unavailable storage, junk, a
 * record from another version or one with nothing in it all read as "no pending
 * scan", never a crash. Storage is injected (defaulting to `localStorage`) so
 * the module is tested without a DOM.
 */
import type { ScanResult } from '@/types/scan'
import { assignScanIds, guessStoreName, scanItemPlace, type ScannedItemWithId } from '@/lib/scan-helpers'
import { PLACE_KEYS, type PlaceKey } from '@/lib/kitchen/places'

export const PENDING_PUTAWAY_KEY = 'bubblychef:putaway:pending'

/**
 * Fired on `window` after every write or clear in this tab. The `storage` event
 * only reaches *other* tabs, so a hook in this one listens for both.
 */
export const PENDING_PUTAWAY_EVENT = 'bubblychef:putaway-changed'

const VERSION = 1

export interface PendingPutAway {
  v: 1
  /** ISO time the scan was parsed. */
  savedAt: string
  /** The store, read off the receipt text; `null` when it could not be told. */
  store: string | null
  /** Confident items: "Going in". */
  ready: ScannedItemWithId[]
  /** Unsure items: "Did I read these right?". */
  review: ScannedItemWithId[]
  /** Lines that are probably not food (bag fee, tax): "Skipped". */
  skipped: ScannedItemWithId[]
  warnings: string[]
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** A fresh record for a parsed scan: items stamped with stable ids, store guessed. */
export function pendingFromScan(result: ScanResult, now: Date = new Date()): PendingPutAway {
  const tiers = assignScanIds(result)
  return {
    v: VERSION,
    savedAt: now.toISOString(),
    store: guessStoreName(result.ocr_text),
    ready: tiers.ready_to_add,
    review: tiers.needs_review,
    skipped: tiers.skipped,
    warnings: Array.isArray(result.warnings) ? result.warnings.filter((w) => typeof w === 'string') : [],
  }
}

/**
 * How many items "Put away" will write: Going in only (the ready tier, plus any
 * needs-review line that was answered Yes or fixed, which moves into it). A line
 * still being asked about is not going in, and skipped lines never are.
 */
export function pendingItemCount(record: Pick<PendingPutAway, 'ready'>): number {
  return record.ready.length
}

/** Every item line the scan holds, going in or still to check (skipped lines aside). */
export function pendingLineCount(record: Pick<PendingPutAway, 'ready' | 'review'>): number {
  return record.ready.length + record.review.length
}

/** What is going in to each place (the +N on the wall). Unanswered lines are not counted. */
export function incomingByPlace(record: Pick<PendingPutAway, 'ready'>): Record<PlaceKey, number> {
  const counts = Object.fromEntries(PLACE_KEYS.map((k) => [k, 0])) as Record<PlaceKey, number>
  for (const item of record.ready) counts[scanItemPlace(item)] += 1
  return counts
}

// ---- reading --------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** One stored item, repaired where it can be, or `null` when it is not an item. */
function readItem(raw: unknown): ScannedItemWithId | null {
  if (!isObject(raw)) return null
  const name = str(raw.name, '').trim()
  if (!name) return null
  return {
    _id: typeof raw._id === 'string' && raw._id ? raw._id : crypto.randomUUID(),
    name,
    original_name: str(raw.original_name, ''),
    source_line: str(raw.source_line, ''),
    price: typeof raw.price === 'number' && Number.isFinite(raw.price) ? raw.price : null,
    quantity: num(raw.quantity, 1),
    unit: str(raw.unit, 'item'),
    category: str(raw.category, 'other'),
    location: str(raw.location, 'pantry'),
    confidence: num(raw.confidence, 0.5),
  }
}

function readTier(raw: unknown): ScannedItemWithId[] {
  if (!Array.isArray(raw)) return []
  return raw.map(readItem).filter((i): i is ScannedItemWithId => i !== null)
}

/** Parse a stored string into a record, or `null` if it is not a usable one. */
export function parsePendingPutAway(raw: string | null): PendingPutAway | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(parsed) || parsed.v !== VERSION) return null
  const ready = readTier(parsed.ready)
  const review = readTier(parsed.review)
  const skipped = readTier(parsed.skipped)
  // Skipped lines alone are nothing to put away or ask about.
  if (ready.length + review.length === 0) return null
  return {
    v: VERSION,
    savedAt: str(parsed.savedAt, new Date(0).toISOString()),
    store: typeof parsed.store === 'string' && parsed.store.trim() ? parsed.store : null,
    ready,
    review,
    skipped,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  }
}

/** The stored string as it is, for change detection (`usePendingPutAway`). */
export function readPendingRaw(storage: Storage | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(PENDING_PUTAWAY_KEY) ?? null
  } catch {
    return null
  }
}

export function readPendingPutAway(storage: Storage | null = defaultStorage()): PendingPutAway | null {
  return parsePendingPutAway(readPendingRaw(storage))
}

// ---- writing --------------------------------------------------------------

function announce(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PENDING_PUTAWAY_EVENT))
}

/** Keep (or update) the pending scan. Best effort: a full or blocked storage is not an error. */
export function savePendingPutAway(
  record: PendingPutAway,
  storage: Storage | null = defaultStorage(),
): void {
  // A scan with no item to put away or ask about (only skipped lines left) is not
  // kept: the home row would say "0 items".
  if (pendingLineCount(record) === 0) {
    clearPendingPutAway(storage)
    return
  }
  try {
    storage?.setItem(PENDING_PUTAWAY_KEY, JSON.stringify(record))
  } catch {
    // Worst case a reload loses the scan, which is where it was before this existed.
  }
  announce()
}

/** The scan was put away or discarded. */
export function clearPendingPutAway(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(PENDING_PUTAWAY_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
  announce()
}
