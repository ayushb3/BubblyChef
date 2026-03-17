export type Category =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'seafood'
  | 'frozen'
  | 'canned'
  | 'dry_goods'
  | 'condiments'
  | 'beverages'
  | 'snacks'
  | 'bakery'
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

// User Profile Types
export interface UserProfile {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  dietary_preferences: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateUserProfileRequest {
  username: string;
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
  dietary_preferences?: string[];
}

export interface UpdateUserProfileRequest {
  username?: string;
  email?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  dietary_preferences?: string[];
}

export interface ProfileResponse {
  profile: UserProfile;
}

// ─── Chat / Conversational AI Types ───────────────────────────────────────────

/**
 * Intent values returned by the backend ProposalEnvelope.
 * Maps to bubbly_chef/models/base.py Intent enum.
 */
export type ChatIntent =
  | 'pantry_update'
  | 'receipt_ingest_request'
  | 'product_ingest_request'
  | 'recipe_ingest_request'
  | 'recipe_card'
  | 'cooking_help'
  | 'general_chat';

/**
 * Next action hint from backend — tells the UI what to render next.
 */
export type ChatNextAction =
  | 'none'
  | 'request_receipt_image'
  | 'request_product_barcode'
  | 'request_product_photos'
  | 'request_recipe_text'
  | 'request_clarification'
  | 'review_proposal';

/** A single pantry action item inside a PantryProposal. */
export interface PantryProposalItem {
  name: string;
  category?: string;
  storage_location?: string;
  quantity?: number;
  unit?: string;
  brand?: string | null;
}

export interface PantryProposalAction {
  action_type: 'add' | 'update' | 'remove' | 'use';
  item: PantryProposalItem;
  confidence: number;
  reasoning?: string | null;
}

export interface PantryProposalData {
  actions: PantryProposalAction[];
  source_text?: string | null;
}

/** Compact recipe data returned when intent is recipe_card. */
export interface ChatRecipeData {
  title?: string;
  description?: string | null;
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
  total_time_minutes?: number | null;
  difficulty?: string | null;
  servings?: number | null;
  ingredients?: Array<{ name: string; quantity?: number | null; unit?: string | null }>;
  instructions?: string[];
  cuisine?: string | null;
  meal_type?: string | null;
  dietary_tags?: string[];
}

/** The full ChatResponse shape — mirrors ProposalEnvelope from the backend. */
export interface ChatResponse {
  request_id: string;
  workflow_id: string;
  conversation_id: string | null;
  schema_version: string;
  intent: ChatIntent;
  proposal: PantryProposalData | ChatRecipeData | Record<string, unknown> | null;
  assistant_message: string;
  confidence: { overall: number };
  requires_review: boolean;
  next_action: ChatNextAction;
  clarifying_questions: string[];
  warnings: string[];
  errors: string[];
  workflow_status: string;
  created_at: string;
}

/** Request body for POST /v1/chat. */
export interface ChatRequest {
  message: string;
  conversation_id?: string | null;
  mode?: string;
}

/** A single message in the UI conversation thread. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: ChatIntent;
  timestamp: Date;
  /** The full response envelope for assistant messages — used for intent-specific rendering. */
  response?: ChatResponse;
}
