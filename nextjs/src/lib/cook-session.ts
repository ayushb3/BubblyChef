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
 * happened. This is deliberately not full reload-survival plumbing for the
 * *in-progress* guided-cook flow itself (that's issue #441) — it only needs
 * to survive long enough to keep a completed session from resurrecting.
 */

const STORAGE_KEY = 'bubblychef:cook:endedRecipeId'

function readEndedRecipeId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, disabled, etc.) — behave as if no
    // session has ever been recorded as ended.
    return null
  }
}

/**
 * Marks a fresh cook session as active for `recipeId`, clearing any stale
 * "ended" record left by a previous cook of the same recipe. Call this at
 * the point a new cook attempt genuinely begins (e.g. "Start cooking" from
 * the preview modal, or opening the guided step-by-step flow) — not on every
 * render.
 */
export function startCookSession(recipeId: string): void {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === recipeId) {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Best effort — if storage isn't readable, there's nothing stale to clear.
  }
}

/**
 * Marks the cook session for `recipeId` as over. Call this once — right
 * after a deduction is actually confirmed (`confirmCook` resolves), never on
 * Cancel/Close. Idempotent and safe to call even if no session was tracked.
 */
export function endCookSession(recipeId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, recipeId)
  } catch {
    // Best effort — worst case the banner reappears, which is the pre-fix
    // behaviour, not a new failure mode.
  }
}

/**
 * True when `recipeId`'s most recent cook session already had its deduction
 * confirmed — i.e. there is no route back into a second deduction for it
 * until a fresh session is explicitly started again.
 */
export function isCookSessionEnded(recipeId: string): boolean {
  return readEndedRecipeId() === recipeId
}
