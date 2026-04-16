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
  ingredients: RecipeIngredient[]
  instructions: string[]
  cuisine?: string | null
  meal_type?: string | null
  dietary_tags?: string[]
  difficulty?: string | null
  tips?: string[]
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
