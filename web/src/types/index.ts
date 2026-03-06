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
