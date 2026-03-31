# Phase 1C: Recipe Generation Module

## Goal
Generate recipes grounded in user's pantry, showing what they have and what's missing.

**Exit Criteria:** Can ask "what can I make with chicken?" and get a recipe that knows your pantry.

---

## Dependencies
- Phase 0 complete
- Phase 1A complete (pantry API for ingredient lookup)

---

## Tasks

### 1C.1 Recipe Generation API

- [ ] `POST /api/recipes/generate` - generate recipe from prompt
- [ ] Include pantry context in AI prompt
- [ ] Return recipe + ingredient availability

### 1C.2 Pantry-Grounded Prompting

- [ ] Fetch user's pantry items
- [ ] Format as context for AI:
  ```
  User has these ingredients:
  - chicken breast (2 lb, fridge)
  - broccoli (1 bunch, fridge, expires in 2 days)
  - soy sauce (pantry)
  - garlic (5 cloves, counter)
  ...
  ```
- [ ] Include expiring-soon items with emphasis
- [ ] AI prompt template for recipe generation

### 1C.3 Recipe Response Structure

- [ ] Parse AI output into structured format:
  ```python
  class GeneratedRecipe(BaseModel):
      title: str
      description: str
      prep_time_minutes: int | None
      cook_time_minutes: int | None
      servings: int | None
      ingredients: list[RecipeIngredient]
      instructions: list[str]
      tips: list[str] | None
  ```
- [ ] Match ingredients to pantry items
- [ ] Classify as: `have`, `partial` (have but not enough), `missing`

### 1C.4 Recipe UI - Input

- [ ] Recipe page with text input
- [ ] Placeholder prompts:
  - "What can I make with chicken?"
  - "Quick dinner under 30 minutes"
  - "Use up my broccoli before it expires"
- [ ] Optional: cuisine/dietary filters
- [ ] Submit button, loading state

### 1C.5 Recipe UI - Display

- [ ] Recipe card layout:
  - Title
  - Time estimates
  - Servings
  - Ingredients list (color-coded by availability)
  - Step-by-step instructions
- [ ] Ingredient availability:
  - Green check: have it
  - Yellow: have partial amount
  - Red X: missing
- [ ] "Missing ingredients" summary at top
- [ ] Regenerate button for different recipe

### 1C.6 Conversation Flow (Simple)

- [ ] Keep last recipe in session state
- [ ] Allow follow-up: "make it spicier" or "substitute for soy sauce"
- [ ] (Full conversation history is Phase 2)

---

## API Contracts

### GenerateRecipeRequest
```typescript
interface GenerateRecipeRequest {
  prompt: string;                    // "chicken stir fry"
  constraints?: {
    max_time_minutes?: number;       // "under 30 minutes"
    cuisine?: string;                // "asian", "italian"
    dietary?: string[];              // ["vegetarian", "gluten-free"]
    use_expiring?: boolean;          // Prioritize expiring items
  };
}
```

### GenerateRecipeResponse
```typescript
interface GenerateRecipeResponse {
  recipe: Recipe;
  ingredients_status: IngredientStatus[];
  missing_count: number;
  pantry_match_score: number;        // 0-1, how well pantry matches
}

interface Recipe {
  title: string;
  description: string;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number | null;
  ingredients: RecipeIngredient[];
  instructions: string[];
  tips: string[];
}

interface RecipeIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;              // "diced", "optional"
}

interface IngredientStatus {
  ingredient: string;
  status: "have" | "partial" | "missing";
  pantry_item?: PantryItem;          // If matched
  have_quantity?: number;
  need_quantity?: number;
}
```

---

## AI Prompt Template

```
You are a helpful cooking assistant. Generate a recipe based on the user's request.

## User's Pantry
{pantry_items_formatted}

## Items Expiring Soon (use if possible)
{expiring_items}

## User Request
{user_prompt}

## Constraints
{constraints}

Generate a recipe that:
1. Uses ingredients from the user's pantry when possible
2. Prioritizes items that are expiring soon
3. Clearly lists all ingredients with quantities
4. Provides clear, numbered instructions
5. Estimates prep and cook time

Respond in the following JSON format:
{schema}
```

---

## Verification

Phase 1C complete when:

1. Can enter recipe prompt
2. AI generates relevant recipe
3. Recipe shows which ingredients user has/missing
4. Instructions are clear and actionable
5. Can request variations ("make it vegetarian")
6. Works with empty pantry (just generates recipe)

---

## Time Estimate

~2-3 sessions

---

## Notes

- Recipe quality depends on AI prompt engineering
- Start simple, iterate on prompt based on results
- Don't over-engineer - no recipe saving yet (Phase 2+)
- Consider caching pantry summary to avoid re-fetching
