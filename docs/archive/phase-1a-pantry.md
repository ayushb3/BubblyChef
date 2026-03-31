# Phase 1A: Pantry Module

## Goal
Complete pantry management UI and API - view, add, edit, delete items with expiry tracking.

**Exit Criteria:** Can manage pantry entirely through the web UI with expiry warnings.

---

## Dependencies
- Phase 0 complete (project structure, AI provider, basic API)

---

## Tasks

### 1A.1 Pantry API (Backend)

- [ ] `GET /api/pantry` - list all items (with optional filters)
- [ ] `GET /api/pantry/:id` - get single item
- [ ] `POST /api/pantry` - add new item
- [ ] `PUT /api/pantry/:id` - update item
- [ ] `DELETE /api/pantry/:id` - delete item
- [ ] `GET /api/pantry/expiring?days=3` - get items expiring within N days
- [ ] `GET /api/pantry/search?q=chicken` - search by name

### 1A.2 Pantry Domain Logic

- [ ] Normalize item names on save (use existing normalizer)
- [ ] Auto-assign category based on name (existing logic)
- [ ] Estimate expiry date if not provided (use expiry.py + defaults)
- [ ] LLM tool for unknown items: `lookup_expiry(item: str) -> int`

### 1A.3 Pantry UI - List View

- [ ] Page layout with header
- [ ] List all pantry items
- [ ] Show: name, quantity, unit, category, expiry
- [ ] Visual indicator for expiring soon (yellow) / expired (red)
- [ ] Empty state when no items
- [ ] Filter by category
- [ ] Sort by: name, expiry date, recently added

### 1A.4 Pantry UI - Add/Edit

- [ ] "Add Item" button → modal or slide-over
- [ ] Form fields: name, quantity, unit, category, location, expiry date
- [ ] Category dropdown with defaults
- [ ] Location dropdown (fridge, freezer, pantry, counter)
- [ ] Optional expiry date picker (auto-suggest based on category)
- [ ] Edit existing item (same form, pre-populated)
- [ ] Delete confirmation

### 1A.5 Pantry UI - Quick Actions

- [ ] Swipe to delete (or delete button)
- [ ] "Use" action - decrease quantity or remove
- [ ] Inline quantity edit

---

## API Contracts

### PantryItem (Response)
```typescript
interface PantryItem {
  id: string;
  name: string;
  name_normalized: string;
  category: Category;
  location: Location;
  quantity: number;
  unit: string;
  expiry_date: string | null;  // ISO date
  days_until_expiry: number | null;
  is_expiring_soon: boolean;
  is_expired: boolean;
  added_at: string;
  updated_at: string;
}
```

### CreatePantryItem (Request)
```typescript
interface CreatePantryItem {
  name: string;
  quantity: number;
  unit: string;
  category?: Category;        // auto-detect if not provided
  location?: Location;        // default: based on category
  expiry_date?: string;       // auto-estimate if not provided
}
```

---

## Verification

Phase 1A complete when:

1. Can view all pantry items in a list
2. Can add new item with auto-categorization
3. Can edit/delete existing items
4. Expiry warnings display correctly
5. Search and filter work
6. Empty state shows when pantry is empty

---

## Time Estimate

~2-3 sessions

---

## Notes

- Keep UI simple - function over form
- Use React Query for data fetching/caching
- Optimistic updates for better UX
