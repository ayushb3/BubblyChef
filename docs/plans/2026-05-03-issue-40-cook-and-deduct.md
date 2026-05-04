# Issue #40 — Cook a Recipe: Auto-Deduct Ingredients from Pantry

## Decisions

| Question | Answer |
|---|---|
| Matching approach | Fuzzy match via `normalize_to_base_unit()` + catalog lookup (no Gemini call) |
| AI trigger | Lazy — only on "Cook it" tap |
| UX pattern | Single modal with deduction preview table |
| CTA placement | Prominent pink pill button above ingredients section |
| Missing items | Flag as "missing" (informational only, no grocery list action) |
| Unit mismatch | Use existing `normalize_to_base_unit()` for both sides; flag cross-dimension as manual-adjust |
| Endpoint | `POST /recipes/cook` on AI service (returns proposal) |
| Payload | `{ recipe_id }` only — backend fetches recipe + pantry |
| Confirm | `POST /recipes/cook/confirm` applies deductions |
| Zero quantity | Keep item at quantity=0 (restock signal for future #42) |
| Cook history | Add `last_cooked_at` (timestamptz NULL) + `times_cooked` (int DEFAULT 0) to recipes table |

## Architecture

```
Frontend                          AI Service
────────                          ──────────
[Cook it] button
    │
    ├─ POST /recipes/cook { recipe_id }
    │                              │
    │                    fetch recipe ingredients from DB
    │                    fetch user's pantry items from DB
    │                    normalize both to base units
    │                    fuzzy match names (catalog lookup threshold=80)
    │                    compare base quantities
    │                              │
    │  ◄── CookProposal ──────────┘
    │       { matches: [...], missing: [...], unit_conflicts: [...] }
    │
    ▼
  Deduction Preview Modal
  (user reviews, adjusts unit conflicts)
    │
    ├─ POST /recipes/cook/confirm { recipe_id, deductions: [...] }
    │                              │
    │                    decrement pantry quantities
    │                    update last_cooked_at, increment times_cooked
    │                              │
    │  ◄── { success: true } ──────┘
    ▼
  Modal closes, pantry refreshes
```

## Data Models

### CookProposal (response from POST /recipes/cook)

```python
class IngredientMatch(BaseModel):
    ingredient_name: str
    ingredient_qty: float
    ingredient_unit: str
    pantry_item_id: UUID
    pantry_item_name: str
    pantry_qty_available: float  # in base units
    deduct_qty: float            # in base units
    base_unit: str               # "g", "ml", or "count"
    status: Literal["ready", "shortfall", "unit_conflict"]
    shortfall: float | None = None  # how much is missing

class CookProposal(BaseModel):
    recipe_id: UUID
    recipe_title: str
    matches: list[IngredientMatch]
    missing: list[str]           # ingredient names with no pantry match
    unit_conflicts: list[dict]   # items where normalize_to_base_unit returned None
```

### Confirm payload (POST /recipes/cook/confirm)

```python
class DeductionItem(BaseModel):
    pantry_item_id: UUID
    deduct_qty: float
    base_unit: str

class CookConfirmRequest(BaseModel):
    recipe_id: UUID
    deductions: list[DeductionItem]
```

## Migration

```sql
ALTER TABLE recipes
  ADD COLUMN last_cooked_at timestamptz NULL,
  ADD COLUMN times_cooked integer NOT NULL DEFAULT 0;
```

## Implementation Steps

### Backend (ai-service/)

1. **Migration** — add `last_cooked_at` + `times_cooked` to recipes table
2. **Models** — add `CookProposal`, `IngredientMatch`, `DeductionItem`, `CookConfirmRequest` to `models/recipes.py`
3. **Matching logic** — new `services/cook_matcher.py`:
   - `match_ingredients(recipe_ingredients, pantry_items)` → uses `normalize_to_base_unit()` + `catalog.lookup()` for name matching
   - Returns matches, missing, unit_conflicts
4. **Route: POST /recipes/cook** — in `main.py` or new `routes/cook.py`:
   - Auth required (get_current_user_id)
   - Fetch recipe by ID from DB
   - Fetch user's pantry items
   - Call `match_ingredients()`
   - Return `CookProposal`
5. **Route: POST /recipes/cook/confirm** —
   - Auth required
   - Validate deductions against current pantry state (prevent over-deduction)
   - Decrement quantities (set to 0 if would go negative)
   - Update recipe's `last_cooked_at = now()`, `times_cooked += 1`
   - Return success
6. **Repository methods** — add `update_recipe_cooked()` to `supabase_repo.py`
7. **Tests** — unit tests for matcher, integration tests for endpoints

### Frontend (nextjs/)

1. **Cook button** — add prominent CTA on recipe detail page (`/recipes/[id]`)
2. **CookModal component** — `components/recipes/CookModal.tsx`
   - Loading state while proposal fetches
   - Deduction table: ingredient, pantry match, amount to deduct
   - Missing items section with warning icon
   - Unit conflict items with editable quantity field
   - Cancel / Confirm buttons
3. **API client** — add `cookRecipe(recipeId)` and `confirmCook(recipeId, deductions)` to API client
4. **Pantry refresh** — after confirm, invalidate pantry React Query cache

## Acceptance Criteria

- [ ] "Cook it" button visible on recipe detail page
- [ ] Tapping triggers proposal fetch (loading state shown)
- [ ] Modal displays matched/missing/conflict items correctly
- [ ] User can adjust quantities for unit conflicts
- [ ] Confirming decrements pantry quantities
- [ ] Items at 0 remain in pantry (not deleted)
- [ ] `last_cooked_at` and `times_cooked` updated on confirm
- [ ] TypeScript compiles: `cd nextjs && npx tsc --noEmit`
- [ ] Python tests pass: `cd ai-service && pytest`
- [ ] Ruff + mypy pass: `ruff check bubbly_chef/ && mypy bubbly_chef/ --strict`
