export type Category =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'seafood'
  | 'frozen'
  | 'pantry'
  | 'beverages'
  | 'condiments'
  | 'bakery'
  | 'snacks'
  | 'other';

export type Location = 'fridge' | 'freezer' | 'pantry' | 'counter';

export interface PantryItem {
  id: string;
  name: string;
  name_normalized: string;
  category: Category;
  location: Location;
  quantity: number;
  unit: string;
  expiry_date: string | null;
  added_at: string;
  updated_at: string;
  // Computed fields
  days_until_expiry: number | null;
  is_expired: boolean;
  is_expiring_soon: boolean;
}

export interface CreatePantryItem {
  name: string;
  quantity?: number;
  unit?: string;
  category?: Category;
  location?: Location;
  expiry_date?: string;
}

export interface UpdatePantryItem {
  name?: string;
  quantity?: number;
  unit?: string;
  category?: Category;
  location?: Location;
  expiry_date?: string;
}

export interface PantryListResponse {
  items: PantryItem[];
  total_count: number;
  expiring_soon_count: number;
  expired_count: number;
}

export interface DeleteResponse {
  success: boolean;
  deleted_id: string;
}

// Receipt Scanning Types
export interface ScanReceiptResponse {
  request_id: string;
  ready_to_add: ParsedItemResponse[];
  needs_review: ParsedItemResponse[];
  skipped: ParsedItemResponse[];
  warnings: string[];
}

export interface ParsedItemResponse {
  temp_id: string;
  raw_text: string;
  name: string;
  name_normalized: string;
  quantity: number | null;
  unit: string | null;
  category: Category;
  location: Location;
  expiry_days: number | null;
  confidence: number; // 0.0 to 1.0
}

export interface ConfirmItem {
  temp_id: string;
  name: string;
  quantity: number;
  unit: string;
  category?: Category;
  location?: Location;
  expiry_date?: string;
}

export interface ConfirmItemsResponse {
  success: boolean;
  added: PantryItem[];
  failed: Array<{ temp_id: string; error: string }>;
}

export interface UndoResponse {
  success: boolean;
  removed_count: number;
  removed_ids: string[];
}

export interface OcrStatusResponse {
  available: boolean;
  service: string | null;
  message: string;
}

// Recipe Types
export interface RecipeIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  preparation: string | null;
  optional: boolean;
  substitutes: string[];
}

export interface Recipe {
  id: string;
  title: string;
  description: string | null;
  source_url: string | null;
  image_url: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  servings: number | null;
  ingredients: RecipeIngredient[];
  instructions: string[];
  cuisine: string | null;
  meal_type: string | null;
  dietary_tags: string[];
  difficulty: string | null;
  tips: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngredientStatus {
  ingredient_name: string;
  status: 'have' | 'partial' | 'missing';
  pantry_item_id: string | null;
  pantry_item_name: string | null;
  have_quantity: number | null;
  have_unit: string | null;
  need_quantity: number | null;
  need_unit: string | null;
}

export interface GenerateRecipeRequest {
  prompt: string;
  constraints?: {
    max_time_minutes?: number;
    cuisine?: string;
    dietary?: string[];
    use_expiring?: boolean;
    servings?: number;
  };
  previous_recipe_context?: string;
}

export interface GenerateRecipeResponse {
  recipe: Recipe;
  ingredients_status: IngredientStatus[];
  missing_count: number;
  have_count: number;
  partial_count: number;
  pantry_match_score: number;
}
