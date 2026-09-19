/**
 * Issue #440 — cook-session lifecycle, tracked independently of any single
 * page's component state.
 *
 * The COOKING banner on /chat is driven by the `?cooking=<recipeId>` URL
 * param, but that param alone can't tell "still cooking" apart from "just
 * confirmed the deduction and got redirected back to chat" — both look
 * identical to a fresh page load. Before this fix the distinction lived only
 * in `ChatSurface`'s local `dismissedRecipeId` state, which does not survive
 * the full-page navigation `CookModal` performs after a *confirmed* deduction
 * from a route other than /chat itself (e.g. the recipe library's guided cook
 * flow). That gap let a confirmed cook redirect straight back into a live
 * "Finished cooking" banner for the same recipe — a second tap re-opened the
 * mark-as-cooked sheet and deducted the same ingredients again.
 *
 * `endCookSession` is the one place a *confirmed* deduction should be
 * recorded as over — call it right after `confirmCook` succeeds, not on
 * Cancel/Close. `startCookSession` clears that record so a legitimate later
 * cook of the same recipe (a different day, a different session) is not
 * silently suppressed by a stale "already cooked" flag.
 *
 * Persisted in `localStorage` (not component state) so the record survives
 * the navigation between /recipes and /chat — a different mount of the chat
 * page has no other way to know a deduction it didn't witness already
 * happened.
 *
 * Issue #441 extends this same module to also carry the *in-progress*
 * guided-cook step position (recipe id + step index), rather than inventing
 * a second, competing source of truth for cook state. A full page load
 * mid-cook — refresh, a restored tab, a backgrounded mobile tab getting
 * reclaimed — used to silently discard the step position with no way to
 * resume. `saveCookProgress`/`getActiveCookSession`/`clearActiveCookSession`
 * below are the #441 additions; `startCookSession`/`endCookSession`/
 * `isCookSessionEnded` are the pre-existing #440 API and keep their exact
 * behaviour.
 *
 * The two concerns share storage but stay logically distinct: "ended" is a
 * one-way door (a confirmed deduction is over, forever, until a fresh
 * `startCookSession`), while the active-session record is just a resume
 * point. `getActiveCookSession` refuses to return a record for a recipe
 * that's recorded as ended — restoring the step UI for an already-confirmed
 * cook would reopen the exact double-deduction trap #440 fixed.
 *
 * --- PR #475 code-review fixes -------------------------------------------
 *
 * Bug 1: the "ended" record used to be a single string
 * (`localStorage.setItem(KEY, recipeId)`), so `endCookSession(B)` silently
 * overwrote `endCookSession(A)`'s record — `isCookSessionEnded(A)` reverted
 * to `false` and a stale `/chat?cooking=A` history entry (reachable with the
 * plain Back button) could deduct A's ingredients a second time. The ended
 * record is now a *list* of ended recipe ids (`readEndedRecipeIds` /
 * `writeEndedRecipeIds`), so ending one recipe never un-ends another.
 * `readEndedRecipeIds` also accepts the pre-fix bare-string format so a user
 * mid-session when this shipped doesn't lose their in-flight "ended" record.
 * The list is capped at `MAX_ENDED_RECORDS`, evicting the oldest entry first,
 * so this doesn't grow localStorage forever.
 *
 * Bug 2: `startCookSession` used to also arm the #441 resumable step record
 * at every call site, including the *chat* cook path (`app/chat/page.tsx`),
 * which never opens the guided step-by-step flow. That meant `RecipeBook`'s
 * reload-resume effect — which calls `getActiveCookSession()` with no
 * recipe id, i.e. "whatever is on record" — could force-open the guided flow
 * for a cook the user started from chat and never asked to be guided
 * through. `startCookSession` now only does its original #440 job (clearing
 * a stale ended record); arming the resumable step record is a separate,
 * explicit call (`startGuidedCookSession`) made only where the guided flow
 * itself begins (`RecipeBook.handleOpenGuidedCook`).
 */

const ENDED_KEY = 'bubblychef:cook:endedRecipeId'
const SESSION_KEY = 'bubblychef:cook:activeSession'

/**
 * Cap on how many "ended" recipe ids are retained. This is a `localStorage`
 * list that gains an entry every time a cook is confirmed, with no other
 * eviction — without a cap it grows for as long as the account is used. 20
 * is generous relative to how many *distinct* recipes are realistically
 * cooked-and-then-revisited via a stale back-button history entry (the only
 * thing this record exists to guard against, per #440) while keeping the
 * stored payload trivially small. Oldest entries are evicted first.
 */
const MAX_ENDED_RECORDS = 20

/**
 * An in-progress guided-cook session, persisted so a full page load can
 * rehydrate at the step the user was on. `step` mirrors `GuidedCookFlow`'s
 * own step-index convention — `-1` is the optional prep screen before step 0.
 * Only the id + a number are stored; the recipe itself is always re-looked-up
 * by id on rehydrate, never persisted.
 */
export interface ActiveCookSession {
  recipeId: string
  step: number
}

function readActiveSession(): ActiveCookSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).recipeId === 'string' &&
      typeof (parsed as Record<string, unknown>).step === 'number'
    ) {
      return parsed as ActiveCookSession
    }
    return null
  } catch {
    // Storage unavailable or corrupt — behave as if no session was persisted.
    return null
  }
}

function writeActiveSession(session: ActiveCookSession | null): void {
  if (typeof window === 'undefined') return
  try {
    if (session === null) {
      window.localStorage.removeItem(SESSION_KEY)
    } else {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    }
  } catch {
    // Best effort — worst case a reload loses the step position, which is
    // the pre-#441 behaviour, not a new failure mode.
  }
}

/**
 * Reads the list of recipe ids whose cook session has been confirmed-ended.
 * Handles three storage shapes: the current JSON array, the pre-Bug-1-fix
 * bare (non-JSON) recipe id string written directly by the old
 * `localStorage.setItem(KEY, recipeId)`, and anything corrupt/unrecognised —
 * the last of which degrades to "nothing ended" rather than throwing.
 */
function readEndedRecipeIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(ENDED_KEY)
    if (!raw) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Not valid JSON — this is the pre-fix single-string format (a bare
      // recipe id, e.g. "8f2c..."). Honour it as a one-entry legacy record
      // instead of discarding whatever session was already tracked.
      return [raw]
    }
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed
    }
    if (typeof parsed === 'string') {
      // A JSON-encoded bare string, e.g. '"r1"' — treat the same as above.
      return [parsed]
    }
    // Recognisable JSON but not a shape we understand — corrupt. Degrade to
    // "nothing ended" rather than throwing.
    return []
  } catch {
    // Storage unavailable (private mode, disabled, etc.) — behave as if no
    // session has ever been recorded as ended.
    return []
  }
}

function writeEndedRecipeIds(ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ENDED_KEY, JSON.stringify(ids))
  } catch {
    // Best effort — worst case the banner reappears, which is the pre-fix
    // behaviour, not a new failure mode.
  }
}

/**
 * Marks a fresh cook session as active for `recipeId`, clearing any stale
 * "ended" record left by a previous cook of the same recipe. Call this at
 * the point a new cook attempt genuinely begins from a path that does *not*
 * open the guided step-by-step flow (e.g. the chat card's "Start cooking").
 *
 * This deliberately does **not** touch the #441 resumable step record — see
 * `startGuidedCookSession` for the guided-flow entry point that does. Arming
 * the resumable record here used to cause `RecipeBook`'s reload-resume
 * effect to force-open the guided flow for cooks started from chat, which
 * never asked to be guided through (PR #475 code review).
 */
export function startCookSession(recipeId: string): void {
  const ids = readEndedRecipeIds()
  if (ids.includes(recipeId)) {
    writeEndedRecipeIds(ids.filter((id) => id !== recipeId))
  }
}

/**
 * Marks a fresh *guided* cook session as active for `recipeId`: does
 * everything `startCookSession` does (clears a stale ended record) and also
 * arms the #441 resumable step record at the prep screen (step -1). Call
 * this only at the point the guided step-by-step flow itself opens
 * (`RecipeBook.handleOpenGuidedCook`) — not from the chat cook path, which
 * has no guided flow to resume into.
 */
export function startGuidedCookSession(recipeId: string): void {
  startCookSession(recipeId)
  writeActiveSession({ recipeId, step: -1 })
}

/**
 * Marks the cook session for `recipeId` as over. Call this once — right
 * after a deduction is actually confirmed (`confirmCook` resolves), never on
 * Cancel/Close. Idempotent and safe to call even if no session was tracked.
 * Ending one recipe's session never affects any other recipe's ended record
 * (PR #475 code review — this used to be a single-slot record that one
 * recipe's `endCookSession` would silently clobber another's).
 */
export function endCookSession(recipeId: string): void {
  const ids = readEndedRecipeIds().filter((id) => id !== recipeId)
  ids.push(recipeId)
  // Bound growth: keep only the most recent MAX_ENDED_RECORDS ids, evicting
  // the oldest first.
  writeEndedRecipeIds(ids.slice(-MAX_ENDED_RECORDS))

  // #441 — a confirmed deduction is over; there is nothing left to resume.
  // Clearing here (rather than leaving it for `getActiveCookSession` to
  // filter) means a reload right after confirming has no stale record to
  // race against a fresh `startGuidedCookSession` for a different recipe.
  const active = readActiveSession()
  if (active && active.recipeId === recipeId) {
    writeActiveSession(null)
  }
}

/**
 * True when `recipeId`'s most recent cook session already had its deduction
 * confirmed — i.e. there is no route back into a second deduction for it
 * until a fresh session is explicitly started again.
 */
export function isCookSessionEnded(recipeId: string): boolean {
  return readEndedRecipeIds().includes(recipeId)
}

/**
 * Persists the current step position for an in-progress guided cook.
 * `GuidedCookFlow` calls this whenever the step index changes (prep, next,
 * back) so a reload rehydrates at the right place instead of restarting.
 * No-op for a recipe whose session has already ended — there is nothing to
 * resume into.
 */
export function saveCookProgress(recipeId: string, step: number): void {
  if (isCookSessionEnded(recipeId)) return
  writeActiveSession({ recipeId, step })
}

/**
 * Returns the resumable cook session, or `null` if there is none to resume —
 * no record was ever persisted, storage is unavailable, or (the case that
 * must never be got wrong) the session's deduction was already confirmed. A
 * confirmed session is a one-way door: `isCookSessionEnded` says so, and this
 * function defers to it rather than trusting whatever stale step index
 * happens to still be in storage.
 *
 * Pass `recipeId` to check a specific recipe (e.g. from within
 * `GuidedCookFlow`, which already knows which recipe it's rendering). Called
 * with no argument, it reports whichever session is on record — this is how
 * a page that hasn't picked a recipe yet (`RecipeBookLoader`'s initial
 * render) discovers *which* recipe to resume into. Only a session armed by
 * `startGuidedCookSession` is ever resumable this way (PR #475 code review)
 * — a chat-started cook never writes this record, so it can't be found here.
 */
export function getActiveCookSession(recipeId?: string): ActiveCookSession | null {
  const active = readActiveSession()
  if (!active) return null
  if (recipeId !== undefined && active.recipeId !== recipeId) return null
  if (isCookSessionEnded(active.recipeId)) return null
  return active
}

/**
 * Clears the resumable session record, e.g. when the user exits the guided
 * flow (back to the plain recipe view) or finishes and hands off to the
 * deduction modal. Distinct from `endCookSession`: exiting without cooking
 * is not "ended" (a later re-open should not be blocked), it just has
 * nothing left to resume.
 */
export function clearActiveCookSession(recipeId: string): void {
  const active = readActiveSession()
  if (active && active.recipeId === recipeId) {
    writeActiveSession(null)
  }
}
