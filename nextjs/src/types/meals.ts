/**
 * Meal types (issue #650 / spec #647 "Meal schema", "API contracts").
 *
 * Field names match `docs/plans/2026-09-29-issue-650-meal-contract.md`
 * exactly — the wire contract shared with the ai-service half being built in
 * parallel. Wire fields are snake_case throughout.
 */

import type { Recipe } from '@/components/recipes/RecipePage'
import type {
  CompoundSuggestion,
  DeductionItem,
  ExpiredMatchedItem,
  IngredientMatch,
  IngredientMatchStatus,
  IngredientMatchType,
  Step,
} from '@/types/recipes'

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
  /**
   * Optimistic-concurrency guard (issue #652 review): the recipe id the
   * client last saw at `position`. When present, the server only replaces
   * the dish if that recipe is *still* the one at `position` at write time —
   * otherwise 409, writing nothing. Without this, a concurrent `remove_side`
   * that renumbers a different side into this position could have this op
   * silently overwrite it instead of the dish the caller actually meant.
   */
  expected_recipe_id?: string
}

export interface AddSideOp {
  recipe: NewDishRecipePayload
}

export interface RemoveSideOp {
  /** The side being removed — 1 or 2. */
  position: number
  /** Same optimistic-concurrency guard as `ReplaceDishOp.expected_recipe_id`. */
  expected_recipe_id?: string
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

/**
 * One ingredient object on a meal cook request (issue #654). RecipeIngredient's
 * fields except `preparation` (the AI service ignores it), plus `notes`, which an
 * amendment's objects carry. A blank `name` is dropped server-side.
 */
export interface MealCookIngredient {
  name: string
  quantity?: number | null
  unit?: string | null
  optional?: boolean
  notes?: string | null
}

export interface MealCookDishRequest {
  recipe_id: string
  /** Objects at meal scale (used verbatim); strings at recipe scale (scaled by the server with `string_scale`). */
  ingredients: (string | MealCookIngredient)[] | null
  /** meal servings / the recipe's effective servings. Applied to string elements only. */
  string_scale: number
}

export interface MealCookRequest {
  meal_id: string
  servings: number
  dishes: MealCookDishRequest[]
}

/** One dish's contribution to a merged line. */
export interface MealCookSource {
  recipe_id: string
  dish_title: string
  ingredient_name: string
  ingredient_qty: number | null
  ingredient_unit: string | null
  required_base_qty: number | null
  status: IngredientMatchStatus
  match_type: IngredientMatchType
  substitution_note: string | null
}

export interface MealIngredientMatch extends IngredientMatch {
  sources: MealCookSource[]
}

export interface MealCookProposalDish {
  recipe_id: string
  title: string
  role: MealDishRole
  position: number
  ingredients_source: 'supplied' | 'recipe'
}

export interface MealCookProposal {
  proposal_type: 'meal_cook'
  meal_id: string
  meal_title: string
  servings: number
  dishes: MealCookProposalDish[]
  matches: MealIngredientMatch[]
  missing: string[]
  /** Key: the exact string in `missing`. */
  missing_sources: Record<string, string[]>
  missing_notes: Record<string, string>
  unit_conflicts: Array<{ ingredient: string; recipe_unit: string; pantry_unit: string; recipe_id: string }>
  compound_suggestions: CompoundSuggestion[]
  expired_items: ExpiredMatchedItem[]
}

export interface MealCookConfirmRequest {
  meal_id: string
  /** MealCookSession.cook_id. */
  cook_ref: string
  /** The dishes actually cooked (cookedDishIds). */
  recipe_ids: string[]
  deductions: DeductionItem[]
  /** The client's local date (localDateString()), for the proxy's rescue judgement. The AI service ignores it. */
  date: string
}

export interface MealCookConfirmResponse {
  success: true
  already_confirmed: boolean
  deductions_applied: number
  deductions_requested: number
  deductions_skipped: string[]
  recipes_marked_cooked: string[]
  meal_times_cooked: number
  /** YYYY-MM-DD: the UTC date of the claim's last_cooked_at. The award key date. */
  cooked_on: string
}

export type MealCookErrorKind = 'dish_mismatch' | 'confirm_in_progress' | 'confirm_incomplete'

/** What lib/api/meals.ts throws for a meal cook call (the class itself is in lib/api/meals.ts, §4). */
export interface MealCookError {
  message: string
  kind?: MealCookErrorKind
}
