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
} from '@/types/meals'
import type { ChatRecipeData } from '@/types/chat'

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

/** Reads `detail.message` off a proxied AI-service error body, same shape `ensureSteps` reads. */
async function aiErrorMessage(res: Response, fallback: string): Promise<string> {
  const err = (await res.json().catch(() => null)) as
    | { detail?: { error_kind?: string; message?: string }; error?: string }
    | null
  return err?.detail?.message ?? err?.error ?? `${fallback}: ${res.status}`
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
