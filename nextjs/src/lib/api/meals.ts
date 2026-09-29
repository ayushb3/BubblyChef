/**
 * Meals client — the per-domain wrapper over the Next.js CRUD routes
 * (issue #650 / spec #647 "API contracts"). No ad hoc `fetch` in components;
 * every meal read/write goes through here.
 */

import type { Meal, MealSummary, CreateMealRequest, UpdateMealRequest } from '@/types/meals'

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
