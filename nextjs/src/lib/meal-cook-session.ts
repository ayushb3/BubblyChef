/**
 * Issue #653 — the meal cook-along's session lifecycle, a sibling of
 * `lib/cook-session.ts` (issues #440/#441) in the same module family: same
 * storage discipline (`localStorage`, every read defensive against corrupt
 * or absent storage, SSR-safe), same "ended is a one-way door" rule. Kept as
 * its own module with its own keys rather than folded into `cook-session.ts`
 * because a meal cook and a single-recipe cook are different sessions with
 * different shapes (per-step progress + per-dish amendments vs a single
 * step index) — sharing keys would mean one flavour of "active session"
 * silently clobbering the other's storage record.
 *
 * `MealCookStepRecord.timer_id` links a hands-off step's dock timer
 * (`lib/useCookingTimers.tsx`) back to the step it belongs to, so a timer
 * completion (or a reload finding one already completed/dismissed) can mark
 * that exact step done — see `lib/meal-cook-stream.ts`.
 *
 * `ingredient_amendments` is reserved for issue #654 (the combined
 * deduction / amendments ticket) and is always `{}` here; this slice never
 * reads or writes into it beyond initializing it empty.
 *
 * **Stale session:** the meal's current dish recipe ids might no longer
 * equal `session.dish_ids` (a side was swapped after cooking started).
 * `isStaleMealCookSession` is the one place that check lives — callers (the
 * meal screen, the cook route) both need it and must agree on what "stale"
 * means, so it isn't duplicated at each call site.
 */

export interface MealCookStepRecord {
  status: 'done' | 'skipped' | 'running'
  started_at_minutes: number
  extra_minutes: number
  /** The dock timer started for a hands-off step, while it runs. */
  timer_id?: string
}

export interface MealCookSession {
  meal_id: string
  /** Epoch ms when cooking actually started. Offsets are minutes from here. */
  started_at_ms: number
  /** The dish recipe ids at start, by position. A later mismatch makes the session stale. */
  dish_ids: string[]
  steps: Record<string /* step key */, MealCookStepRecord>
  /** Reserved for issue #654 / the amendments work: per-dish ingredient amendments. Always {} here. */
  ingredient_amendments: Record<string /* dish_id */, unknown[]>
}

const ACTIVE_KEY = 'bubblychef:mealcook:activeSession'
const ENDED_KEY = 'bubblychef:mealcook:endedMealIds'

/** Same cap and eviction rule as `cook-session.ts`'s `MAX_ENDED_RECORDS` — see that module's comment. */
const MAX_ENDED_RECORDS = 20

function isStepRecord(v: unknown): v is MealCookStepRecord {
  return (
    !!v &&
    typeof v === 'object' &&
    (['done', 'skipped', 'running'] as const).includes((v as MealCookStepRecord).status) &&
    typeof (v as MealCookStepRecord).started_at_minutes === 'number' &&
    typeof (v as MealCookStepRecord).extra_minutes === 'number' &&
    (typeof (v as MealCookStepRecord).timer_id === 'undefined' ||
      typeof (v as MealCookStepRecord).timer_id === 'string')
  )
}

function isMealCookSession(v: unknown): v is MealCookSession {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  if (typeof s.meal_id !== 'string') return false
  if (typeof s.started_at_ms !== 'number') return false
  if (!Array.isArray(s.dish_ids) || !s.dish_ids.every((id) => typeof id === 'string')) return false
  if (!s.steps || typeof s.steps !== 'object') return false
  if (!Object.values(s.steps as Record<string, unknown>).every(isStepRecord)) return false
  if (!s.ingredient_amendments || typeof s.ingredient_amendments !== 'object') return false
  return true
}

function readActiveSession(): MealCookSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isMealCookSession(parsed) ? parsed : null
  } catch {
    // Storage unavailable or corrupt — behave as if no session was persisted.
    return null
  }
}

function writeActiveSession(session: MealCookSession | null): void {
  if (typeof window === 'undefined') return
  try {
    if (session === null) {
      window.localStorage.removeItem(ACTIVE_KEY)
    } else {
      window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(session))
    }
  } catch {
    // Best effort — worst case a reload loses the in-progress cook, same
    // degraded-not-broken posture as `cook-session.ts`.
  }
}

function readEndedMealIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ENDED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed
    return []
  } catch {
    return []
  }
}

function writeEndedMealIds(ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ENDED_KEY, JSON.stringify(ids))
  } catch {
    // Best effort — worst case the "Resume cooking?" banner reappears for an
    // already-finished meal, which is a downgrade, not a new failure mode.
  }
}

/**
 * True when `mealId`'s most recent cook session already had its deduction
 * confirmed — there is no route back into cooking it again until a fresh
 * session is explicitly started. Mirrors `isCookSessionEnded`.
 */
export function isMealCookSessionEnded(mealId: string): boolean {
  return readEndedMealIds().includes(mealId)
}

/**
 * Starts a fresh cook-along session for `mealId`: clears a stale "ended"
 * record for this meal (a later cook of the same meal on another day must
 * not be blocked) and writes the active session. There is one active meal
 * session at a time — starting one replaces any other, for this meal or a
 * different one, since the cook-along is a single full-screen flow.
 */
export function startMealCookSession(mealId: string, dishIds: string[], nowMs: number): MealCookSession {
  const ended = readEndedMealIds()
  if (ended.includes(mealId)) {
    writeEndedMealIds(ended.filter((id) => id !== mealId))
  }
  const session: MealCookSession = {
    meal_id: mealId,
    started_at_ms: nowMs,
    dish_ids: dishIds,
    steps: {},
    ingredient_amendments: {},
  }
  writeActiveSession(session)
  return session
}

/**
 * Persists `session` as the active record. A no-op when the meal is already
 * recorded as ended, mirroring `saveCookProgress`'s guard — there is nothing
 * left to resume into for a confirmed cook, and writing over it would risk
 * racing a fresh `startMealCookSession` for a different meal.
 */
export function saveMealCookProgress(session: MealCookSession): void {
  if (isMealCookSessionEnded(session.meal_id)) return
  writeActiveSession(session)
}

/**
 * Returns the active session, or `null` when there is none, storage is
 * corrupt, it belongs to another meal (when `mealId` is given), or the meal
 * is recorded as ended. Ended is a one-way door (issue #440's pattern):
 * `getActiveMealCookSession` defers to `isMealCookSessionEnded` rather than
 * trusting whatever session happens to still be in storage.
 */
export function getActiveMealCookSession(mealId?: string): MealCookSession | null {
  const active = readActiveSession()
  if (!active) return null
  if (mealId !== undefined && active.meal_id !== mealId) return null
  if (isMealCookSessionEnded(active.meal_id)) return null
  return active
}

/**
 * Clears the active session record without marking it ended — the cook left
 * without finishing ("Start over", "Stop cooking"). A later cook of the same
 * meal is not blocked by this.
 */
export function clearActiveMealCookSession(mealId: string): void {
  const active = readActiveSession()
  if (active && active.meal_id === mealId) {
    writeActiveSession(null)
  }
}

/**
 * Marks `mealId`'s cook session as over — called from the finished screen's
 * "Back to meal" in this ticket (issue #654 moves it to after the combined
 * deduction is confirmed). Bounded the same way `endCookSession` bounds its
 * own list: capped at `MAX_ENDED_RECORDS`, oldest evicted first. Also clears
 * the active record for this meal, same reasoning as `endCookSession`: a
 * reload right after ending has no stale record to race a fresh
 * `startMealCookSession` for a different meal.
 */
export function endMealCookSession(mealId: string): void {
  const ids = readEndedMealIds().filter((id) => id !== mealId)
  ids.push(mealId)
  writeEndedMealIds(ids.slice(-MAX_ENDED_RECORDS))

  const active = readActiveSession()
  if (active && active.meal_id === mealId) {
    writeActiveSession(null)
  }
}

/**
 * True when the meal's current dish recipe ids (by position — the same
 * `dish_ids` shape `startMealCookSession` was given) no longer equal
 * `session.dish_ids` — a side was swapped after cooking started, or a
 * remove renumbered a side into a different position. A stale session can't
 * be resumed: the meal screen offers only "Start over", and the cook route
 * redirects to the meal screen rather than restoring it. Positional
 * equality, per the contract's "the meal's current dish recipe ids don't
 * equal `session.dish_ids`" — a position swap changes which dish a resumed
 * step's progress would apply to, so it counts as stale even if the same set
 * of recipe ids is still in the meal.
 */
export function isStaleMealCookSession(session: MealCookSession, currentDishIds: string[]): boolean {
  if (session.dish_ids.length !== currentDishIds.length) return true
  return !session.dish_ids.every((id, i) => id === currentDishIds[i])
}
