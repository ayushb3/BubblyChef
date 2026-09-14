/**
 * Types for AI recipe generation and refinement.
 */

export interface RecipeConstraints {
  prompt: string
  cuisine?: string | null
  max_time_minutes?: number | null
  dietary?: string[]
  difficulty?: string | null
  servings?: number | null
  use_pantry?: boolean
}

export interface RecipeIngredient {
  name: string
  /** Matches the backend contract (`quantity: float | None`) — never a string. */
  quantity?: number | null
  unit?: string | null
  preparation?: string | null
  optional?: boolean
}

export interface IngredientStatus {
  name: string
  status: 'have' | 'missing' | 'partial'
  pantry_item_name?: string | null
}

export interface GeneratedRecipe {
  id?: string
  title: string
  description?: string | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  servings?: number | null
  /**
   * Ingredients are stored as `RecipeIngredient` objects when a recipe is
   * AI-generated or URL-imported, but `RecipeEditModal` flattens them to
   * plain strings on save — both shapes exist in the DB (#315). Use
   * `ingredientLabel()` from `@/lib/recipe-helpers` to render either.
   */
  ingredients: (string | RecipeIngredient)[]
  instructions: string[]
  cuisine?: string | null
  meal_type?: string | null
  dietary_tags?: string[]
  difficulty?: string | null
  tips?: string[]
  source_url?: string | null
  source_platform?: string | null
}

export interface GenerateRecipeResponse {
  recipe: GeneratedRecipe
  ingredients_status: IngredientStatus[]
  missing_count: number
  have_count: number
  partial_count: number
  pantry_match_score: number
}

export interface RefineRecipeRequest {
  recipe: Record<string, unknown>
  prompt: string
}

// ---------------------------------------------------------------------------
// Cook-a-recipe / pantry deduction types
// ---------------------------------------------------------------------------

export type IngredientMatchStatus =
  | 'ready'
  | 'substitute'
  | 'shortfall'
  /**
   * The pantry has the ingredient, but the recipe counts pieces of it
   * (4 slices) against a row counting packages (1 loaf). Satisfied for
   * cook-readiness; nothing is deducted. See #222.
   */
  | 'imprecise'
  | 'unit_conflict'
  | 'missing'
  /**
   * A culinary staple (salt, pepper, oil, …) presumed on hand even when not
   * in the pantry. Collapsed into one summary line in the cook UI (#305).
   * Never counted as missing — a recipe whose only absent ingredients are
   * staples is fully makeable.
   */
  | 'assumed'

/** How the pantry item was found, recorded separately from status. */
export type IngredientMatchType = 'exact' | 'substitute' | 'none'

export interface IngredientMatch {
  ingredient_name: string
  ingredient_qty: number | null
  ingredient_unit: string | null
  pantry_item_id: string | null
  pantry_item_name: string | null
  pantry_qty_available: number | null
  deduct_qty: number | null
  base_unit: string | null
  status: IngredientMatchStatus
  shortfall: number | null
  /**
   * A substitute with too little stock is status 'shortfall' but still
   * match_type 'substitute', so the swap note shows alongside the shortfall.
   */
  match_type: IngredientMatchType
  substitution_note: string | null
}

/**
 * Advisory multi-item substitution for a missing ingredient.
 * Nothing is deducted — the ingredient stays in CookProposal.missing.
 */
export interface CompoundSuggestion {
  ingredient_name: string
  /** Pantry item names to combine — all exist in the user's pantry. */
  components: string[]
  /** Short instruction for the cook, e.g. "Melt butter, whisk in flour, add milk" */
  note: string
}

export interface CookProposal {
  recipe_id: string
  recipe_title: string
  matches: IngredientMatch[]
  missing: string[]
  unit_conflicts: Array<{ ingredient: string; recipe_unit: string; pantry_unit: string }>
  /** Advisory compound substitutions — never deducted. Default: []. */
  compound_suggestions?: CompoundSuggestion[]
  /** Sparse map of ingredient name → short explanation for why no pantry substitute exists. */
  missing_notes?: Record<string, string>
}

export interface DeductionItem {
  pantry_item_id: string
  deduct_qty: number
  base_unit: string
}
