/**
 * Chat deep-link seeds — issues #143 and #138.
 *
 * Two URL params prime `/chat` with a first message that is auto-sent on load:
 *
 *   /chat?tip=<tip text>                  — "explain today's tip" (#143)
 *   /chat?use=<name>[&expires=<ISO date>] — "cook this before it goes bad" (#138)
 *
 * Both mirror the existing `?cooking=` handoff: read the param, show a
 * dismissible context card above the thread, and prime the conversation.
 *
 * A third param, `/chat?plan=dinner` (issue #651), seeds a "plan dinner"
 * request instead: home screen's Plan card → `planDinnerHref()`. A fourth,
 * `/chat?meal=<recipe id>&title=<title>` (issue #651 PR B), seeds "make this
 * saved recipe into a meal": recipe page → `makeMealHref()`. Precedence
 * across every seed source is cooking > meal > plan > tip > use — the
 * cooking handoff is excluded before `deriveChatSeed` is ever called
 * (`page.tsx`), `meal` is checked first inside it, and `plan` ahead of
 * `tip`/`use`. A `meal` value that isn't a UUID is ignored.
 *
 * IMPORTANT — the seed lives in the *message text*, not in a context payload,
 * for `tip` and `use` (`meal` sets `ChatSeed.context` instead). The AI
 * service recognises a short list of client-supplied `context` keys:
 * `cooking_recipe_id`/`cooking_recipe` (the cook handoff, see
 * `cookingContextForId` below), `meal_option_id` (a pick on a meal-options
 * card), `meal_followup` (a meal-stage pill tap, issue #651) and
 * `meal_fixed_main` (a make-it-a-meal tap, issue #651 PR B) —
 * anything else is ignored, and for `tip`/`use` the must-use
 * ingredient is recovered by an LLM structured-output call over the message
 * itself. So the ingredient name and the tip text have to appear verbatim in
 * `message`, and the `"with my <name>"` phrasing below is the one the backend
 * prompt was tuned against. Don't reword it without re-tuning `recipe/nodes.py`.
 */

import { parseLocalDate } from '@/lib/pantry-helpers'
import type { CookingRecipeContext, CookingRecipeIdContext } from '@/types/chat'
import type { MealCookIngredient } from '@/types/meals'

/**
 * Cook-handoff context for the first chat message, built from the `?cooking=<id>`
 * param alone. Returns the id-only payload the AI service resolves server-side,
 * so pinning never waits on a client-side recipe fetch (#155). Returns
 * `undefined` for a bare/blank id so callers can spread it conditionally.
 */
export function cookingContextForId(
  recipeId: string | null | undefined,
): CookingRecipeIdContext | undefined {
  const id = recipeId?.trim()
  return id ? { cooking_recipe_id: id } : undefined
}

/**
 * The full cook pin (`context.cooking_recipe`) for the first chat message, for
 * when the client already holds the list being cooked. Used instead of the
 * id-only payload (above) in two cases (#489):
 *
 *  - the recipe has loaded, so the very first turn is pinned as COOKING and can
 *    already carry an amendment ("no cream, use a roux");
 *  - a mid-cook amendment is on record, so a reload's fresh conversation pins the
 *    AMENDED list, not the stored row the id would resolve to.
 *
 * The id-only payload stays the fallback when the recipe has not loaded yet, so
 * a message sent before the fetch resolves still pins (#155).
 */
export function cookingPinContext(
  recipeId: string,
  title: string,
  ingredients: (string | MealCookIngredient)[],
): { cooking_recipe: CookingRecipeContext } {
  return { cooking_recipe: { id: recipeId, title, ingredients } }
}

/** Minimal read surface shared by `URLSearchParams` and Next's readonly variant. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

/** `meal` is the make-it-a-meal seed (issue #651 PR B). */
export type ChatSeedKind = 'tip' | 'use' | 'plan' | 'meal' | 'ask'

export interface ChatSeedCard {
  emoji: string
  label: string
  title: string
  subtitle?: string
  dismissLabel: string
}

export interface ChatSeed {
  /** Stable identity — gates the one-shot auto-send and the dismissal. */
  key: string
  kind: ChatSeedKind
  /** Auto-sent as the conversation's first message. */
  message: string
  card: ChatSeedCard
  /**
   * Forwarded as the auto-send's context (issue #651). Unset for `plan` —
   * the default servings apply server-side; the `meal` seed sends
   * `{ meal_fixed_main: { recipe_id } }`.
   */
  context?: Record<string, unknown>
}

/** The longest `?ask=` text: a pill is a short phrase. */
const ASK_MAX = 160

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One-line, control-free, at most `max` (default 120) characters; null when nothing is left. */
function cleanSeedTitle(raw: string | null, max = 120): string | null {
  if (raw === null) return null
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, max).trim() || null
}

/** Trimmed param value, or null when absent/blank. */
function param(params: ReadableSearchParams, name: string): string | null {
  const raw = params.get(name)
  if (raw === null) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ─── Link builders ────────────────────────────────────────────────────────────

/** Dashboard tip card → chat primed to explain that tip. */
export function tipChatHref(tip: string): string {
  return `/chat?${new URLSearchParams({ tip }).toString()}`
}

/** Expiring item (hero CTA or pantry card) → chat primed to cook it. */
export function cookThisHref(name: string, expiryDate?: string | null): string {
  const params = new URLSearchParams({ use: name })
  if (expiryDate) params.set('expires', expiryDate)
  return `/chat?${params.toString()}`
}

/** The most foods a plan-dinner link carries (the storage sheet's Use first row). */
const PLAN_WITH_LIMIT = 6

/**
 * Home screen "Plan" card → chat primed to plan dinner (issue #651). With
 * `foods` (issue #749: the storage sheet's "Plan dinner around these") the
 * request names them, in one `with` param joined by `|`.
 */
export function planDinnerHref(foods?: readonly string[]): string {
  const names = (foods ?? []).map((f) => cleanSeedTitle(f)).filter((f): f is string => f !== null)
  if (names.length === 0) return '/chat?plan=dinner'
  const params = new URLSearchParams({
    plan: 'dinner',
    with: names.slice(0, PLAN_WITH_LIMIT).join('|'),
  })
  return `/chat?${params.toString()}`
}

/**
 * A starter pill as a link (issue #755): the Bubbles card's pills that have no
 * dedicated seed above send the text a tap on the pill inside the chat would.
 */
export function askHref(message: string): string {
  return `/chat?${new URLSearchParams({ ask: message }).toString()}`
}

/**
 * Recipe page → chat primed to make that saved recipe into a meal (issue #651
 * PR B). The title rides in the URL so the auto-send never waits on a fetch.
 */
export function makeMealHref(recipeId: string, title?: string | null): string {
  const trimmed = title?.trim()
  const params = new URLSearchParams({ meal: recipeId, ...(trimmed ? { title: trimmed } : {}) })
  return `/chat?${params.toString()}`
}

// ─── Message builders ─────────────────────────────────────────────────────────

/**
 * Message for a make-it-a-meal turn (issue #651 PR B). A blank or absent
 * title falls back to a generic phrasing.
 */
export function makeMealMessage(title?: string | null): string {
  const trimmed = title?.trim()
  return trimmed ? `Make ${trimmed} into a meal` : 'Make a meal around your recipe'
}

/** Auto-sent message for the `?plan=dinner` seed (issue #651). */
export const PLAN_DINNER_MESSAGE = 'Plan dinner for tonight'

/** "A", "A and B", "A, B and C". */
function joinFoods(foods: readonly string[]): string {
  if (foods.length <= 1) return foods.join('')
  return `${foods.slice(0, -1).join(', ')} and ${foods[foods.length - 1]}`
}

/** `PLAN_DINNER_MESSAGE`, built around the named foods when there are any (issue #749). */
export function planDinnerMessage(foods: readonly string[] = []): string {
  return foods.length === 0
    ? PLAN_DINNER_MESSAGE
    : `${PLAN_DINNER_MESSAGE}, built around my ${joinFoods(foods)}`
}

export function tipSeedMessage(tip: string): string {
  return `Tell me more about this kitchen tip: "${tip}" — why does it work, and when should I use it?`
}

/**
 * The ingredient name is interpolated verbatim (no re-pluralising, no
 * title-casing): the backend matches it against the pantry by substring in both
 * directions, so "eggs" correctly hits an item named "large free-range eggs".
 */
export function ingredientSeedMessage(name: string): string {
  return `What can I make with my ${name} before they go bad?`
}

// ─── Expiry phrasing ──────────────────────────────────────────────────────────

/**
 * Human phrasing for an ISO expiry date, matching `pantry-helpers`' day maths
 * (midnight-today → expiry, `Math.round`) exactly. Returns null for a
 * missing/unparseable date so callers can fall back.
 *
 * Uses `parseLocalDate` (not the bare `Date` constructor) for the same reason
 * `pantry-helpers` does (#244): a date-only string like "2026-08-25" parses as
 * *UTC* midnight, while `today` below is *local* midnight. East of UTC that
 * constant offset pushed the old `Math.ceil`-based day count up by exactly
 * one, at every hour of every day — an item due tomorrow always read as two
 * days out. (The #438 flake itself was in the *test's* "tomorrow" fixture,
 * not this function — see `chat-deep-links.test.tsx`'s history — but this
 * function had the same latent UTC/local mismatch bug in its own right,
 * just one that only bites users east of UTC.)
 *
 * `Math.round`, not `Math.ceil`: with both sides now local midnights, the
 * gap is a whole number of days except on a DST transition day, where it's
 * 23 or 25 hours. `Math.ceil` would turn the fall-back day's 25h gap into 2
 * days (disagreeing with the pantry badge's 1) and the spring-forward day's
 * −23h gap into `-0`, which reads as "expires today" for an item that
 * already expired. `Math.round` matches `pantry-helpers.daysUntilExpiry` on
 * both.
 */
export function expiryPhrase(
  expiryDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!expiryDate) return null
  const expiry = parseLocalDate(expiryDate)
  if (Number.isNaN(expiry.getTime())) return null

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (days < 0) return 'already expired'
  if (days === 0) return 'expires today'
  if (days === 1) return 'expires tomorrow'
  return `expires in ${days} days`
}

// ─── Seed derivation ──────────────────────────────────────────────────────────

/**
 * Read the seed out of the URL. Returns null when neither param is present —
 * which is what keeps a bare `/chat` (bottom nav) a clean, empty conversation.
 */
export function deriveChatSeed(
  params: ReadableSearchParams,
  now: Date = new Date(),
): ChatSeed | null {
  // Make it a meal (issue #651 PR B) — checked first. The recipe id must be
  // a UUID; anything else falls through to plan/tip/use as if `meal` were
  // absent. No fetch: the title rides in the URL so the auto-send never waits.
  const mealId = param(params, 'meal')
  if (mealId && UUID_RE.test(mealId)) {
    // The title becomes the user's message and the card subtitle, and a crafted
    // link controls it: turn control characters and newlines into spaces and
    // collapse whitespace so it can't smuggle in extra lines.
    const title = cleanSeedTitle(param(params, 'title'))
    return {
      key: `meal:${mealId.toLowerCase()}`,
      kind: 'meal',
      message: makeMealMessage(title),
      context: { meal_fixed_main: { recipe_id: mealId } },
      card: {
        emoji: '🍽️',
        label: 'Make it a meal',
        title: 'Making it a meal',
        subtitle: title ?? 'Your saved recipe',
        dismissLabel: 'Dismiss make-it-a-meal context',
      },
    }
  }

  // Checked ahead of tip/use (issue #651, §8) — only the exact value
  // "dinner" (case-insensitive after trim) qualifies; anything else falls
  // through to the seeds below rather than erroring.
  const plan = param(params, 'plan')
  if (plan && plan.toLowerCase() === 'dinner') {
    // `with` (issue #749) names the foods to build it around: cleaned like any
    // crafted-link text, blanks dropped, at most six.
    const foods = (param(params, 'with') ?? '')
      .split('|')
      .map((f) => cleanSeedTitle(f))
      .filter((f): f is string => f !== null)
      .slice(0, PLAN_WITH_LIMIT)
    return {
      key: foods.length > 0 ? `plan:dinner:${foods.join('|')}` : 'plan:dinner',
      kind: 'plan',
      message: planDinnerMessage(foods),
      card: {
        emoji: '🍽️',
        label: 'Plan dinner',
        title: 'Planning dinner',
        subtitle:
          foods.length > 0 ? `Using your ${joinFoods(foods)}` : 'Bubbles will suggest a few meals',
        dismissLabel: 'Dismiss dinner planning context',
      },
    }
  }

  // A starter pill's text (issue #755), after plan and before tip/use.
  const ask = cleanSeedTitle(param(params, 'ask'), ASK_MAX)
  if (ask) {
    return {
      key: `ask:${ask}`,
      kind: 'ask',
      message: ask,
      card: {
        emoji: '💬',
        label: 'Ask Bubbles',
        title: ask,
        dismissLabel: 'Dismiss question context',
      },
    }
  }

  const tip = param(params, 'tip')
  if (tip) {
    return {
      key: `tip:${tip}`,
      kind: 'tip',
      message: tipSeedMessage(tip),
      card: {
        emoji: '💡',
        label: "Today's tip",
        title: tip,
        dismissLabel: 'Dismiss tip context',
      },
    }
  }

  const name = param(params, 'use')
  if (name) {
    const expires = param(params, 'expires')
    return {
      key: `use:${name}:${expires ?? ''}`,
      kind: 'use',
      message: ingredientSeedMessage(name),
      card: {
        emoji: '⏳',
        label: 'Cook this now',
        title: `Using your ${name}`,
        subtitle: expiryPhrase(expires, now) ?? 'before it goes bad',
        dismissLabel: 'Dismiss expiring item context',
      },
    }
  }

  return null
}
