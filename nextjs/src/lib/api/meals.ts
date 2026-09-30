/**
 * Meals client — the per-domain wrapper over the Next.js CRUD routes
 * (issue #650 / spec #647 "API contracts"). No ad hoc `fetch` in components;
 * every meal read/write goes through here.
 */

import type {
  Meal,
  MealSummary,
  CreateMealRequest,
  UpdateMealRequest,
  NewDishRecipePayload,
  MealCookRequest,
  MealCookProposal,
  MealCookConfirmRequest,
  MealCookConfirmResponse,
  MealCookErrorKind,
} from '@/types/meals'
import type { ChatRecipeData } from '@/types/chat'
import { clientTimeZone } from '@/lib/date'

/**
 * One side-alternatives outline — the shape both `POST /v1/meals/
 * side-alternatives` returns and `POST /v1/meals/expand-dish` accepts back
 * (issue #652 / spec #647). `blurb` only ever comes from the server; the
 * client never fabricates one when sending an outline back to expand-dish.
 */
export interface MealDishOutline {
  role: 'side'
  name: string
  key_ingredients: string[]
  est_total_minutes: number | null
  est_hands_on_minutes: number | null
}

export interface SideAlternativeOutline extends MealDishOutline {
  /** One sentence, `''` when the model gave none. */
  blurb: string
}

/**
 * `GET /api/meals` — saved meals by default, or drafts with `drafts: true`.
 */
export async function fetchMeals(options?: { drafts?: boolean }): Promise<MealSummary[]> {
  const qs = options?.drafts ? '?drafts=1' : ''
  const res = await fetch(`/api/meals${qs}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to load meals' }))
    throw new Error(err.error ?? `Failed to load meals: ${res.status}`)
  }
  const data = await res.json()
  return data.meals ?? []
}

/**
 * `GET /api/meals/[id]` — the meal plus every dish's full recipe row.
 */
export async function fetchMeal(mealId: string): Promise<Meal> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Meal fetch failed' }))
    throw new Error(err.error ?? `Meal fetch failed: ${res.status}`)
  }
  return res.json()
}

/**
 * `POST /api/meals` — creates a meal with its dishes (each a new recipe
 * payload or an existing recipe id). Returns the meal as `fetchMeal` would.
 */
export async function createMeal(payload: CreateMealRequest): Promise<Meal> {
  const res = await fetch('/api/meals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create meal' }))
    throw new Error(err.error ?? `Failed to create meal: ${res.status}`)
  }
  return res.json()
}

/**
 * `PUT /api/meals/[id]` — updates title/servings/constraints, or promotes a
 * draft (`{ promote: true }`), which cascades to its draft dish recipes.
 */
export async function updateMeal(mealId: string, payload: UpdateMealRequest): Promise<Meal> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to update meal' }))
    throw new Error(err.error ?? `Failed to update meal: ${res.status}`)
  }
  return res.json()
}

/**
 * `DELETE /api/meals/[id]` — deletes the meal and its draft dish recipes,
 * keeping saved ones.
 */
export async function deleteMeal(mealId: string): Promise<void> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to delete meal' }))
    throw new Error(err.error ?? `Failed to delete meal: ${res.status}`)
  }
}

const MEAL_COOK_ERROR_KINDS: readonly MealCookErrorKind[] = [
  'dish_mismatch',
  'confirm_in_progress',
  'confirm_incomplete',
]

/**
 * Reads a message (and, for the meal cook routes, an `error_kind`) off a
 * proxied AI-service error body. The body is parsed exactly once — a
 * `Response` whose body has already been consumed (e.g. by a caller that
 * peeked at it) can't be re-read, so every caller here and below goes
 * through this one parse.
 *
 * Usually `detail.message` (the 502 structured-error shape), but FastAPI's
 * own 404s send `detail` as a plain string (`{"detail": "Not Found"}`)
 * rather than an object — that string is the message directly when it isn't
 * the object shape. `kind` is `detail.error_kind` when it's one of the three
 * `MealCookErrorKind` values, else `undefined` — a network error, a thrown
 * fetch, an unparseable body, or an unrecognized `error_kind` all fall back
 * to no kind, so the meal cook sheet shows Retry rather than treating them
 * as one of the three known failure modes.
 */
async function aiErrorDetail(
  res: Response,
  fallback: string,
): Promise<{ message: string; kind?: MealCookErrorKind }> {
  const err = (await res.json().catch(() => null)) as
    | { detail?: { error_kind?: string; message?: string } | string; error?: string }
    | null

  if (typeof err?.detail === 'string') return { message: err.detail }

  const message = err?.detail?.message ?? err?.error ?? `${fallback}: ${res.status}`
  const rawKind = err?.detail?.error_kind
  const kind = MEAL_COOK_ERROR_KINDS.includes(rawKind as MealCookErrorKind)
    ? (rawKind as MealCookErrorKind)
    : undefined
  return { message, kind }
}

/** `aiErrorDetail`'s message alone — every pre-#654 caller's shape, unchanged. */
async function aiErrorMessage(res: Response, fallback: string): Promise<string> {
  return (await aiErrorDetail(res, fallback)).message
}

/**
 * Thrown by `requestMealCookProposal` / `confirmMealCook` on a non-OK
 * response (issue #654 §4 S1). `kind` is set only for the three
 * `MealCookErrorKind`s the AI service actually sends — a network error, a
 * thrown `fetch`, or an unrecognized/absent `error_kind` all throw with no
 * `kind`, so the meal cook sheet's error state shows Retry rather than
 * treating an unknown failure as one it knows how to route.
 */
export class MealCookError extends Error {
  readonly kind?: MealCookErrorKind

  constructor(message: string, kind?: MealCookErrorKind) {
    super(message)
    this.name = 'MealCookError'
    this.kind = kind
  }
}

/**
 * `POST /api/ai/meals/side-alternatives` — three alternatives for the side
 * at `position` (swap), or for a new side when `position` is omitted (add).
 */
export async function fetchSideAlternatives(request: {
  meal_id: string
  position?: number
}): Promise<SideAlternativeOutline[]> {
  const res = await fetch('/api/ai/meals/side-alternatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(await aiErrorMessage(res, 'Failed to fetch side alternatives'))
  const data = (await res.json()) as { alternatives?: SideAlternativeOutline[] }
  return data.alternatives ?? []
}

export interface ExpandMealDishResponse {
  proposal_type: 'meal_dish'
  role: 'side'
  position: number
  /** The RecipeCard shape the meal pick returns — ingredients, instructions, validated structured steps. */
  recipe: ChatRecipeData
}

/**
 * `POST /api/ai/meals/expand-dish` — builds one alternative into a full
 * recipe. Writes nothing; the caller persists the returned `recipe` through
 * `PUT /api/meals/[id]` (`replace_dish` / `add_side`).
 */
export async function expandMealDish(request: {
  meal_id: string
  position: number
  outline: MealDishOutline
}): Promise<ExpandMealDishResponse> {
  const res = await fetch('/api/ai/meals/expand-dish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(await aiErrorMessage(res, 'Failed to build that dish'))
  return res.json()
}

/**
 * `expand-dish`'s `recipe` (`ChatRecipeData`, every field optional — it's
 * the wire shape the chat pick stage also uses) into the stricter
 * `NewDishRecipePayload` `PUT /api/meals/[id]`'s `replace_dish` / `add_side`
 * need (`title` required). Falls back to the outline's own name on the
 * (should-never-happen) chance the model response is missing a title, so a
 * malformed response degrades to a named dish rather than a 400 from the
 * meals route.
 */
export function toNewDishRecipePayload(
  recipe: ChatRecipeData,
  fallbackTitle: string,
): NewDishRecipePayload {
  return {
    title: recipe.title ?? fallbackTitle,
    description: recipe.description ?? null,
    ingredients: recipe.ingredients ?? [],
    instructions: recipe.instructions ?? [],
    steps: recipe.steps ?? null,
    cuisine: recipe.cuisine ?? null,
    meal_type: recipe.meal_type ?? null,
    dietary_tags: recipe.dietary_tags ?? [],
    difficulty: recipe.difficulty ?? null,
    prep_time_minutes: recipe.prep_time_minutes ?? null,
    cook_time_minutes: recipe.cook_time_minutes ?? null,
    total_time_minutes: recipe.total_time_minutes ?? null,
    servings: recipe.servings ?? null,
  }
}

/**
 * `POST /api/ai/meals/cook` (issue #654 / spec #647) — the combined
 * deduction proposal for however many of the meal's dishes were cooked.
 * Writes nothing.
 */
export async function requestMealCookProposal(req: MealCookRequest): Promise<MealCookProposal> {
  const res = await fetch('/api/ai/meals/cook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const detail = await aiErrorDetail(res, 'Failed to build the meal cook proposal')
    throw new MealCookError(detail.message, detail.kind)
  }
  return res.json()
}

/**
 * `POST /api/ai/meals/cook/confirm` — applies the reviewed deductions and
 * marks the cooked dishes and the meal. Idempotent on `cook_ref`
 * (`MealCookSession.cook_id`): a retry with the same ref never double-deducts
 * (§2c).
 */
export async function confirmMealCook(req: MealCookConfirmRequest): Promise<MealCookConfirmResponse> {
  const res = await fetch('/api/ai/meals/cook/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The client's IANA zone (#550), not a date: the proxy keys every award on
    // its own clock in the account's stored zone.
    body: JSON.stringify({ ...req, tz: clientTimeZone() }),
  })
  if (!res.ok) {
    const detail = await aiErrorDetail(res, 'Failed to confirm the meal cook')
    throw new MealCookError(detail.message, detail.kind)
  }
  return res.json()
}
