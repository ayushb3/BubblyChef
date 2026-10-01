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
 * `ingredient_amendments` (issue #654) holds one amendment slot per dish,
 * keyed by dish id (= recipe id). `withDishAmendment` (PR B) is the only
 * writer — the mid-cook Ask Bubbles overlay applies a proposal through it —
 * and `readDishAmendment` (PR A) is the only reader, validating the shape.
 * A session with no amendments yet still has `{}`, so a pre-PR-B (#653)
 * session restores unchanged.
 *
 * **Stale session:** the meal's current dish recipe ids might no longer
 * equal `session.dish_ids` (a side was swapped after cooking started), or a
 * dish's steps might have changed shape under the same recipe id (an
 * `ensureSteps` upgrade landing mid-cook, or an edited recipe) — `dish_ids`
 * alone can't see that. `isStaleMealCookSession` is the one place both
 * checks live — callers (the meal screen, the cook route) both need it and
 * must agree on what "stale" means, so it isn't duplicated at each call
 * site.
 *
 * **`cook_id`** (issue #654) is the idempotency key the confirm route claims
 * (`cook_ref`, §2c of the issue #654 contract). `startMealCookSession` always
 * sets one; `ensureCookId` derives a deterministic one for a session written
 * before #654, so two tabs restoring the same pre-#654 session agree on the
 * same ref and the server's claim still dedupes them (N5).
 */

import type { MealCookIngredient } from '@/types/meals'

export interface MealCookStepRecord {
  status: 'done' | 'skipped' | 'running'
  started_at_minutes: number
  extra_minutes: number
  /** The dock timer started for a hands-off step, while it runs. */
  timer_id?: string
  /**
   * Issue #653 review round 1 (S1) — the actual minute a done/skipped step
   * was recorded, fixing its end forever after rather than letting the
   * scheduler recompute it against a later `now_minutes`. Set by
   * `recordDone` / `recordSkip`; absent on a `running` record.
   */
  ended_at_minutes?: number
}

/**
 * One dish's mid-cook amendment (issue #654 PR B writes this; PR A only
 * reads it through `readDishAmendment`).
 */
export interface DishAmendment {
  /** The FULL replacement list (`RecipeAmendmentProposal.amended_ingredients`), at `servings` scale. */
  ingredients: MealCookIngredient[]
  /**
   * The servings the list is expressed at: the recipe's effective servings
   * (`recipe.servings > 0 ? recipe.servings : meal.servings`) when it was
   * written. `cookedIngredientsForDish` rescales by `mealServings / servings`.
   */
  servings: number
  change_summary: string | null
  applied_at_ms: number
}

export interface MealCookSession {
  meal_id: string
  /** Epoch ms when cooking actually started. Offsets are minutes from here. */
  started_at_ms: number
  /** The dish recipe ids at start, by position. A later mismatch makes the session stale. */
  dish_ids: string[]
  /**
   * Issue #653 review round 1 (S4) — one signature per dish, by position
   * (same order as `dish_ids`): `${step count}:${label1}|${label2}|...`
   * (see `lib/meal-dishes.ts`'s `dishStepSignature`). A dish whose steps
   * changed shape since the session started — an `ensureSteps` upgrade
   * landing mid-cook, or an edited recipe — makes the session stale the same
   * way a changed dish id does, since a resumed step's progress would
   * otherwise apply to a step that no longer means what it did.
   */
  dish_step_signatures: string[]
  steps: Record<string /* step key */, MealCookStepRecord>
  /**
   * Idempotency key for the confirm (issue #654 §2c). Always set by
   * `startMealCookSession`; optional only for a session written before
   * #654 — `ensureCookId` derives one deterministically for those.
   */
  cook_id?: string
  /**
   * Per-dish amendment slot, keyed by dish id (= recipe id). Written only by
   * PR B's `withDishAmendment`; read ONLY through `readDishAmendment`, which
   * validates the shape. `{}` stays valid, so a #653 session restores.
   */
  ingredient_amendments: Record<string /* dish_id */, unknown>
}

/** The safe charset a `cook_id` (sent as `cook_ref`) must match — it goes into a PostgREST filter. */
const COOK_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

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
      typeof (v as MealCookStepRecord).timer_id === 'string') &&
    (typeof (v as MealCookStepRecord).ended_at_minutes === 'undefined' ||
      typeof (v as MealCookStepRecord).ended_at_minutes === 'number')
  )
}

function isMealCookSession(v: unknown): v is MealCookSession {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  if (typeof s.meal_id !== 'string') return false
  if (typeof s.started_at_ms !== 'number') return false
  if (!Array.isArray(s.dish_ids) || !s.dish_ids.every((id) => typeof id === 'string')) return false
  if (
    !Array.isArray(s.dish_step_signatures) ||
    !s.dish_step_signatures.every((sig) => typeof sig === 'string')
  ) {
    return false
  }
  if (!s.steps || typeof s.steps !== 'object') return false
  if (!Object.values(s.steps as Record<string, unknown>).every(isStepRecord)) return false
  if (typeof s.cook_id !== 'undefined' && typeof s.cook_id !== 'string') return false
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
export function startMealCookSession(
  mealId: string,
  dishIds: string[],
  nowMs: number,
  dishStepSignatures: string[],
): MealCookSession {
  const ended = readEndedMealIds()
  if (ended.includes(mealId)) {
    writeEndedMealIds(ended.filter((id) => id !== mealId))
  }
  const session: MealCookSession = {
    meal_id: mealId,
    started_at_ms: nowMs,
    dish_ids: dishIds,
    dish_step_signatures: dishStepSignatures,
    steps: {},
    cook_id: crypto.randomUUID(),
    ingredient_amendments: {},
  }
  writeActiveSession(session)
  return session
}

/**
 * A `cook_id` to send as `cook_ref` (issue #654 §2c) — `session` unchanged
 * when it already has one matching the confirm route's charset. Otherwise
 * returns a copy with a deterministic `legacy-${started_at_ms}` id, for a
 * session written before #654 (N5): deterministic so two tabs restoring the
 * same pre-#654 session derive the same ref, and the server's claim still
 * dedupes them rather than double-deducting. Callers save the result so the
 * derived id persists across the rest of the cook.
 */
export function ensureCookId(session: MealCookSession): MealCookSession {
  if (typeof session.cook_id === 'string' && COOK_ID_PATTERN.test(session.cook_id)) {
    return session
  }
  return { ...session, cook_id: `legacy-${Math.trunc(session.started_at_ms)}` }
}

export function isMealCookIngredient(v: unknown): v is MealCookIngredient {
  if (!v || typeof v !== 'object') return false
  const ing = v as Record<string, unknown>
  if (typeof ing.name !== 'string' || ing.name.trim() === '') return false
  if (
    typeof ing.quantity !== 'undefined' &&
    ing.quantity !== null &&
    !(typeof ing.quantity === 'number' && Number.isFinite(ing.quantity))
  ) {
    return false
  }
  if (typeof ing.unit !== 'undefined' && ing.unit !== null && typeof ing.unit !== 'string') return false
  return true
}

/**
 * Reads `dishId`'s amendment out of the session's `ingredient_amendments`
 * slot, validating its shape rather than trusting whatever's in storage
 * (issue #654 §3) — PR B's `withDishAmendment` is the only writer, but this
 * reader has to stay defensive on its own, the same discipline
 * `isMealCookSession` already applies to the rest of the record. Anything
 * that doesn't validate gives `null`, so the caller falls back to the dish's
 * recipe list rather than treating a corrupt slot as a crash.
 */
export function readDishAmendment(session: MealCookSession, dishId: string): DishAmendment | null {
  const raw = session.ingredient_amendments[dishId]
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>

  if (!Array.isArray(a.ingredients) || a.ingredients.length === 0) return null
  if (!a.ingredients.every(isMealCookIngredient)) return null

  if (typeof a.servings !== 'number' || !Number.isFinite(a.servings) || a.servings <= 0) return null
  if (typeof a.change_summary !== 'string' && a.change_summary !== null) return null
  if (typeof a.applied_at_ms !== 'number') return null

  return {
    ingredients: a.ingredients,
    servings: a.servings,
    change_summary: a.change_summary,
    applied_at_ms: a.applied_at_ms,
  }
}

/**
 * Returns a copy of `session` with `dishId`'s amendment slot set to
 * `amendment`, every other dish's slot kept as-is (issue #654 §3). Pure —
 * the caller persists the result through `saveMealCookProgress`, which is a
 * no-op once the meal has ended.
 *
 * **One slot per dish; amendments stack.** Each amendment the overlay
 * produces is the model's full replacement list, derived from whatever list
 * the previous amendment (or the recipe) produced, so the latest simply
 * replaces the slot rather than appending to a log.
 *
 * `cook_id` and `steps` are untouched.
 */
export function withDishAmendment(
  session: MealCookSession,
  dishId: string,
  amendment: DishAmendment,
): MealCookSession {
  return {
    ...session,
    ingredient_amendments: { ...session.ingredient_amendments, [dishId]: amendment },
  }
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
 *
 * Issue #653 review round 1 (S4) — also stale when a dish's step signature
 * (see `MealCookSession.dish_step_signatures`) has changed under the same
 * id: an `ensureSteps` upgrade or an edited recipe landing mid-cook means a
 * resumed step's progress no longer lines up with what that step is now.
 */
export function isStaleMealCookSession(
  session: MealCookSession,
  currentDishIds: string[],
  currentDishStepSignatures: string[],
): boolean {
  if (session.dish_ids.length !== currentDishIds.length) return true
  if (!session.dish_ids.every((id, i) => id === currentDishIds[i])) return true
  if (session.dish_step_signatures.length !== currentDishStepSignatures.length) return true
  return !session.dish_step_signatures.every((sig, i) => sig === currentDishStepSignatures[i])
}
