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
  const res = await fetch('/api/ai/grocery/meal-to-buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meal_id: mealId }),
  })
  if (!res.ok) throw await failure(res, "Couldn't work out what the meal needs")
  const data = (await res.json()) as { to_buy?: unknown }
  return Array.isArray(data.to_buy)
    ? data.to_buy.filter((n): n is string => typeof n === 'string')
    : []
}
