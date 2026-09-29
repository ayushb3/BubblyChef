/**
 * Meal types (issue #650 / spec #647 "Meal schema", "API contracts").
 *
 * Field names match `docs/plans/2026-09-29-issue-650-meal-contract.md`
 * exactly — the wire contract shared with the ai-service half being built in
 * parallel. Wire fields are snake_case throughout.
 */

import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'

export type MealDishRole = 'main' | 'side'

/**
 * Kitchen limits, the mapped exclusive tags, and the RecipeConstraints echo
 * used to regenerate sides later. Stored verbatim on `meals.constraints` —
 * this route layer never interprets it, only passes it through.
 */
export interface MealConstraints {
  kitchen_limits: string[]
  exclusive_tags: string[]
  recipe_constraints: Record<string, unknown>
}

/** One dish summary as `GET /api/meals` returns it — no full recipe. */
export interface MealDishSummary {
  role: MealDishRole
  position: number
  recipe_id: string
  title: string
  total_time_minutes: number | null
}

/** One item of `GET /api/meals`'s list. */
export interface MealSummary {
  id: string
  title: string
  servings: number
  is_draft: boolean
  dishes: MealDishSummary[]
}

/** One dish as `GET /api/meals/[id]` returns it — the full recipe row. */
export interface MealDishFull {
  role: MealDishRole
  position: number
  recipe: Recipe
}

/** The full meal row plus its expanded dishes. */
export interface Meal {
  id: string
  user_id: string
  title: string
  description: string | null
  servings: number
  constraints: MealConstraints
  is_draft: boolean
  source_type: string
  last_cooked_at: string | null
  times_cooked: number
  created_at: string
  updated_at: string
  dishes: MealDishFull[]
}

/**
 * A new dish's recipe payload on `POST /api/meals` — the same shape
 * `persistRecipe` in `app/chat/page.tsx` sends to `POST /api/recipes`, minus
 * `is_draft` (the meal's `is_draft` governs every new dish recipe).
 */
export interface NewDishRecipePayload {
  title: string
  description?: string | null
  ingredients?: unknown[]
  instructions?: string[]
  steps?: Step[] | null
  cuisine?: string | null
  meal_type?: string | null
  dietary_tags?: string[]
  difficulty?: string | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  servings?: number | null
}

/**
 * One dish on `POST /api/meals` — either a new recipe payload (including
 * structured steps) or a reference to an existing recipe id. Exactly one of
 * `recipe` / `recipe_id` must be present.
 */
export interface CreateMealDish {
  role: MealDishRole
  position: number
  recipe?: NewDishRecipePayload
  recipe_id?: string
}

export interface CreateMealRequest {
  title: string
  description?: string | null
  /** Omitted: the backend's default-servings rule already picked one. */
  servings?: number
  constraints?: Partial<MealConstraints>
  is_draft?: boolean
  source_type?: string
  /**
   * Idempotency key: the chat sends the `meal` proposal's `meal_ref`. A
   * repeat `POST` with the same one returns the existing meal (promoting a
   * draft when `is_draft` is false) instead of creating a second.
   */
  source_ref?: string
  dishes: CreateMealDish[]
}

/**
 * `PUT /api/meals/[id]` dish operations (issue #652 / spec #647 "PUT
 * /api/meals/[id]: dish operations"). Sides only — the main (position 0)
 * can never be replaced or removed.
 */
export interface ReplaceDishOp {
  /** The side being replaced — 1 or 2. Position 0 (the main) is rejected. */
  position: number
  recipe: NewDishRecipePayload
}

export interface AddSideOp {
  recipe: NewDishRecipePayload
}

export interface RemoveSideOp {
  /** The side being removed — 1 or 2. */
  position: number
}

/** `PUT /api/meals/[id]` body. */
export interface UpdateMealRequest {
  title?: string
  servings?: number
  constraints?: Partial<MealConstraints>
  /** Sets `is_draft = false` on the meal AND cascades to its draft dishes. */
  promote?: boolean
  /**
   * At most one of `replace_dish` / `add_side` / `remove_side` per request —
   * two dish ops in one body is a 400.
   */
  replace_dish?: ReplaceDishOp
  add_side?: AddSideOp
  remove_side?: RemoveSideOp
}
