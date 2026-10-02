/**
 * Grocery client (issue #497 / Spec B.5).
 *
 * The grocery list itself is generated and stored in the browser
 * (`lib/grocery.ts`, `lib/grocery-store.ts`), so there is almost nothing to
 * fetch. The one network call is a saved meal's to-buy list: a saved meal
 * doesn't store its missing ingredients, so the meal screen's "Add missing to
 * grocery list" action asks the AI service to compute them against the current
 * pantry (cook matcher, deterministic, no writes), then calls
 * `addToGroceryList(userId, names)` after the user confirms.
 */

import { cleanIngredientAmount } from '@/lib/ingredient-amount'

/** A readable message from a non-2xx body: the proxy passes the AI service's
 *  `{ detail }` through. */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null)
  const detail = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const message =
    (typeof detail.error === 'string' && detail.error) ||
    (typeof detail.detail === 'string' && detail.detail) ||
    `${fallback} (${res.status})`
  return new Error(message)
}

/**
 * `POST /api/ai/grocery/meal-to-buy` — what a saved meal needs that the pantry
 * lacks, once each (staples assumed on hand, water never listed). Writes
 * nothing. Rejects with the server's message on failure (e.g. "Meal not found").
 */
export async function fetchMealToBuy(mealId: string): Promise<string[]> {
  return (await fetchMealToBuyDetail(mealId)).names
}

/** One to-buy food and the dishes that need it (issue #805). */
export interface MealToBuyItem {
  /** The deduped name (how the first dish that needs it wrote it). */
  name: string
  /** The `position` of every dish with a line for this food. */
  dishPositions: number[]
  /** That dish's own wording, parallel to `dishPositions`. */
  dishNames: string[]
  /**
   * How much the meal lacks (issue #850): nothing usable is on hand for a listed
   * food, so the recipe amount, summed across dishes that count it the same way.
   * `null` when the recipe gives none, or from an older service.
   */
  quantity?: number | null
  /** The unit of `quantity`, as the recipe wrote it. */
  unit?: string | null
  /** The food's category when the service knows it. */
  category?: string | null
}

export interface MealToBuyDetail {
  names: string[]
  /** Per-dish attribution from the service; `null` from an older service (or a malformed one). */
  items: MealToBuyItem[] | null
}

function parseItems(raw: unknown): MealToBuyItem[] | null {
  if (!Array.isArray(raw)) return null
  const items: MealToBuyItem[] = []
  for (const entry of raw) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const positions = e.dish_positions
    const names = e.dish_names
    if (
      typeof e.name !== 'string' ||
      !Array.isArray(positions) ||
      !positions.every((p) => typeof p === 'number') ||
      !Array.isArray(names) ||
      !names.every((n) => typeof n === 'string') ||
      names.length !== positions.length
    ) {
      return null
    }
    // The amount fields are additive (issue #850): an older service omits them, which is
    // "no amount", not a malformed item.
    const quantity = typeof e.quantity === 'number' && Number.isFinite(e.quantity) ? e.quantity : null
    const unit = quantity !== null && typeof e.unit === 'string' && e.unit.trim() ? e.unit.trim() : null
    // The amount is a recipe line's: a count of a spice or liquid is no amount (#892).
    const toTaste = cleanIngredientAmount(e.name, quantity, unit).toTaste
    items.push({
      name: e.name,
      dishPositions: positions as number[],
      dishNames: names as string[],
      quantity: toTaste ? null : quantity,
      unit: toTaste ? null : unit,
      category: typeof e.category === 'string' && e.category.trim() ? e.category.trim() : null,
    })
  }
  return items
}

/**
 * `fetchMealToBuy` plus the service's per-dish attribution (issue #805). The
 * service decides which dishes need each food with the same key it dedupes the
 * list on, so a card's "N to buy" line can follow it instead of re-matching names.
 */
export async function fetchMealToBuyDetail(mealId: string): Promise<MealToBuyDetail> {
  const res = await fetch('/api/ai/grocery/meal-to-buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meal_id: mealId }),
  })
  if (!res.ok) throw await failure(res, "Couldn't work out what the meal needs")
  const data = (await res.json()) as { to_buy?: unknown; items?: unknown }
  const names = Array.isArray(data.to_buy)
    ? data.to_buy.filter((n): n is string => typeof n === 'string')
    : []
  return { names, items: parseItems(data.items) }
}
