/**
 * Tonight's planned meal (issue #755): the record behind the Bubbles card's
 * "Dinner for two at 7:00" nudge.
 *
 * Setting a saved meal to Serve at a time (the meal screen's toggle) writes it;
 * "Move it to tomorrow" shifts it by a day; Start now, a serve time that is too
 * soon, finishing the cook, or another meal's plan replaces or clears it. It is
 * device-local state in local storage: no schema and no API (the signature PRD's
 * decision 5). A later cross-device need can promote it to a column.
 *
 * One record, like the cook session: one dinner is planned at a time, and the
 * newest plan wins.
 *
 * Reads are defensive, like `lib/cook-session.ts`: unavailable storage, junk, or a
 * record from another version all read as "nothing planned", never a crash.
 * Storage is injected (defaulting to `localStorage`) so the module is tested
 * without a DOM.
 */

export const PLANNED_TONIGHT_KEY = 'bubblychef:planned:tonight'

/**
 * Fired on `window` after every write or clear in this tab (the `storage` event
 * only reaches other tabs).
 */
export const PLANNED_TONIGHT_EVENT = 'bubblychef:planned-changed'

const VERSION = 1

export interface PlannedTonight {
  v: 1
  mealId: string
  /** The meal's title, for the card's link text and the fingerprint's readers. */
  title: string
  servings: number
  /** When it is to be served: epoch ms. */
  serveAtMs: number
  /** When the first step starts (serve time minus the timeline): epoch ms. */
  startAtMs: number
  /** The dish that starts first ("rice"), or `null` when the meal has none to name. */
  startDish: string | null
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function announce(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PLANNED_TONIGHT_EVENT))
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Parse a stored string into a record, or `null` when it is not a usable one. */
export function parsePlannedTonight(raw: string | null): PlannedTonight | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const r = parsed as Record<string, unknown>
  if (r.v !== VERSION) return null
  if (typeof r.mealId !== 'string' || r.mealId.trim() === '') return null
  if (!finite(r.serveAtMs) || !finite(r.startAtMs)) return null
  return {
    v: VERSION,
    mealId: r.mealId,
    title: typeof r.title === 'string' ? r.title : '',
    servings:
      typeof r.servings === 'number' && Number.isInteger(r.servings) && r.servings >= 1
        ? r.servings
        : 2,
    serveAtMs: r.serveAtMs,
    startAtMs: r.startAtMs,
    startDish: typeof r.startDish === 'string' && r.startDish.trim() ? r.startDish : null,
  }
}

/** The stored string as it is, for change detection (`usePlannedTonight`). */
export function readPlannedRaw(storage: Storage | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(PLANNED_TONIGHT_KEY) ?? null
  } catch {
    return null
  }
}

export function readPlannedTonight(storage: Storage | null = defaultStorage()): PlannedTonight | null {
  return parsePlannedTonight(readPlannedRaw(storage))
}

/** Keep (or replace) the plan. Best effort: a full or blocked storage is not an error. */
export function savePlannedTonight(
  record: PlannedTonight,
  storage: Storage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PLANNED_TONIGHT_KEY, JSON.stringify(record))
  } catch {
    // Worst case the card does not mention tonight's meal: where it was before.
  }
  announce()
}

/**
 * Drop the plan. With `mealId`, only when the record is that meal's: leaving
 * meal A's screen on Start now must not erase the dinner planned for meal B.
 */
export function clearPlannedTonight(
  mealId?: string,
  storage: Storage | null = defaultStorage(),
): void {
  try {
    if (mealId !== undefined) {
      const current = parsePlannedTonight(readPlannedRaw(storage))
      if (current && current.mealId !== mealId) return
    }
    storage?.removeItem(PLANNED_TONIGHT_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
  announce()
}

/** The same wall-clock time, one calendar day later (DST-safe: not +24 h). */
function nextDay(ms: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

/**
 * "Move it to tomorrow": shift the plan by a day and keep it. Returns the moved
 * record, or `null` when nothing was planned.
 */
export function movePlannedToTomorrow(
  storage: Storage | null = defaultStorage(),
): PlannedTonight | null {
  const current = readPlannedTonight(storage)
  if (!current) return null
  const moved: PlannedTonight = {
    ...current,
    serveAtMs: nextDay(current.serveAtMs),
    startAtMs: nextDay(current.startAtMs),
  }
  savePlannedTonight(moved, storage)
  return moved
}

/** True when the serve time falls on `now`'s local calendar day. */
export function isPlannedForToday(record: Pick<PlannedTonight, 'serveAtMs'>, now: Date): boolean {
  const serve = new Date(record.serveAtMs)
  return (
    serve.getFullYear() === now.getFullYear() &&
    serve.getMonth() === now.getMonth() &&
    serve.getDate() === now.getDate()
  )
}

/**
 * An `"HH:MM"` serve time as a `Date`: today at that time, or tomorrow when it is
 * already earlier than `now` ("00:30" typed at 23:00 means tonight's after
 * midnight, not a time that has passed). Minute granularity, so a time in the same
 * minute as `now` stays today. `undefined` for an emptied or malformed input.
 *
 * The meal screen's serve-at maths, moved here so the card and the screen agree.
 */
export function resolveServeAtDate(hhmm: string, now: Date): Date | undefined {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  if (Math.floor(d.getTime() / 60_000) < Math.floor(now.getTime() / 60_000)) {
    d.setDate(d.getDate() + 1)
  }
  return d
}
