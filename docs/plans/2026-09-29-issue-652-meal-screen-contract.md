# Issue #652: the full meal screen, the wire contract

The contract shared by the three slices of issue #652, *full meal screen*: the ai-service routes, the Next.js CRUD/proxy/page, and the components. The parent spec is issue #647 ("API contracts", "Chat and meal UI", "Anchoring"). The previous slice's contract is `2026-09-29-issue-650-meal-contract.md`. Where this doc is silent, the spec rules. All wire fields are snake_case.

## AI service: two new routes, under `/v1/meals`

Both routes are thin (logic in `workflows/meal/`), take the JWT like every other route, and load the meal **through the repository** (a new `SupabaseRepository.get_meal_with_dishes(user_id, meal_id)`: the meal row plus each dish's role, position and full recipe row, scoped to the user). Both go through `AIManager` with a Pydantic response schema.

- Unknown meal (or not this user's): **404**.
- Model unavailable or bad structured output: **502** with `detail: { error_kind, message }`, the same shape as `POST /v1/recipes/{id}/steps/ensure`.
- **Pantry opt-out** carries through. If `meal.constraints.recipe_constraints.use_pantry` is `false`, neither route reads the pantry or puts pantry items in a prompt (the same `is_pantry_grounded` gate as the pick stage). Otherwise both use the same gentle grounding the pick stage uses.

### `POST /v1/meals/side-alternatives`

```jsonc
// request
{ "meal_id": "uuid", "position": 1 }   // position: the side being replaced (1 or 2); omit when adding a side
// response 200
{
  "alternatives": [                     // exactly 3
    { "role": "side", "name": "Charred broccolini", "blurb": "Smoky, 10 minutes, uses the lemon.",
      "key_ingredients": ["broccolini", "lemon", "garlic"],
      "est_total_minutes": 12, "est_hands_on_minutes": 6 }
  ]
}
```

- The prompt knows the main and the **other** side (not the one at `position`), the kitchen limits and the meal's recipe constraints. Alternatives must differ from every dish currently in the meal, including the one being replaced, and from each other.
- Validation: exactly 3 outlines with `role: "side"`. If the model returns fewer, return what's valid (at least 1); if none are valid, 502.
- `blurb` is new on the outline model: optional, one sentence, `""` when absent.

### `POST /v1/meals/expand-dish`

```jsonc
// request
{ "meal_id": "uuid", "position": 1,
  "outline": { "role": "side", "name": "Charred broccolini", "key_ingredients": ["broccolini", "lemon"],
               "est_total_minutes": 12, "est_hands_on_minutes": 6 } }
// response 200
{ "proposal_type": "meal_dish", "role": "side", "position": 1,
  "recipe": { /* the RecipeCard shape the meal pick returns: ingredients, instructions,
                 validated structured `steps`, servings = the meal's servings */ } }
```

- `position` is where the dish will go: the position being replaced for a swap, or the next free side position (1 or 2) for an add. The prompt knows every other dish in the meal (all dishes except the one at `position`) and the kitchen limits, and tags steps with the meal's `exclusive_tags` exactly as the pick does. It reuses the pick stage's `_expand_dish`.
- It writes nothing. The client persists it through `PUT /api/meals/[id]`.

## Next.js

### Proxies

`POST /api/ai/meals/side-alternatives` and `POST /api/ai/meals/expand-dish` forward to the two routes above with the user's auth, following the `app/api/ai/recipes/[id]/steps/ensure` proxy pattern. Client functions go in `lib/api/meals.ts`: `fetchSideAlternatives({ meal_id, position? })` and `expandMealDish({ meal_id, position, outline })`. On a non-ok response, they throw the `detail.message` (falling back to a generic message).

### `PUT /api/meals/[id]`: dish operations

The body gains **at most one** of these alongside the existing `title` / `servings` / `constraints` / `promote`. Two dish ops in one request → 400.

```jsonc
{ "replace_dish": { "position": 1, "recipe": { /* NewDishRecipePayload */ }, "expected_recipe_id": "uuid" } }
{ "add_side":     { "recipe": { /* NewDishRecipePayload */ } } }
{ "remove_side":  { "position": 2, "expected_recipe_id": "uuid" } }
```

- **`replace_dish`**: sides only. Position 0 (the main) → 400. It inserts the new recipe, with `is_draft` equal to the meal's and steps through `sanitizeSteps`, then points that position's `meal_dishes` row at it. The **old** recipe is deleted if it was a draft, and kept in the library if it was saved (the same rule as `DELETE /api/meals/[id]`).
- **`add_side`**: 400 when the meal already has two sides. The new side goes at the next free position (always 1 or 2, with positions kept compact).
- **`remove_side`**: 400 when the meal has only one side, or when the position isn't a side. The removed recipe follows the same draft-delete / saved-keep rule. If position 1 is removed while position 2 exists, 2 is renumbered to 1, so the columns stay main / side 1 / side 2.
- **`expected_recipe_id`** (optional, `replace_dish` and `remove_side` — issue #652 review): optimistic-concurrency guard. The client sends the recipe id it last saw at `position`. When present, the server only writes if that recipe id is *still* the one at `position` **at write time** — checked in the `UPDATE`/`DELETE`'s own `WHERE` clause (`.eq('recipe_id', expected_recipe_id)`), not just an initial read, so a concurrent op landing in the gap can't slip past it. A mismatch (either an early check before any insert, or zero rows affected by the guarded write) is a **409** (`{ "error": "That side changed since you loaded this meal.", ... }`) and writes nothing: for `replace_dish`, the just-inserted new recipe is deleted before returning; for `remove_side`, nothing was deleted. Without this, a concurrent `remove_side` that renumbers a different side into `position` could let a stale `replace_dish` silently overwrite the wrong dish.
- Failure midway: remove whatever this request inserted (a new recipe row), best effort, the same as `POST /api/meals`. There's no transaction.
- It returns the full meal, as `GET` does.

### The meal screen, `/meals/[id]`

This replaces the minimal page from issue #650. It uses the existing shells, with no new visual language (the final look is Goal 3):

- **The title and a servings stepper.** The stepper `PUT`s servings (1–100) and scales every dish's displayed quantities by `meal.servings / recipe.servings`. Durations never scale.
- **A start-now / serve-at control.** It uses `resolveMealAnchor` from `lib/meal-anchor.ts`. Start-now shows `+N min` offsets. Serve-at takes a time input and shows clock times. When the time is too soon, it shows the helper's too-late copy plus a "Use <earliest>" button that sets the time to the earliest ready time.
- **The timeline**: `MealTimelineTable` fed by `scheduleMeal({ dishes, constraints: { exclusive_tags: meal.constraints.exclusive_tags } })`. It's recomputed with `useMemo` from the meal data, and never stored. Columns: main → `main`, position 1 → `side_1`, position 2 → `side_2`.
- **A recipe card per dish**, with the role label, title, scaled ingredients, and steps in order. Each side card has **Swap**. It also has **Remove** when there are two sides, which asks for confirmation first. When there's one side, an **Add a side** control sits below the dishes.
- **Swap / Add**: a horizontal row of three mini cards (from side-alternatives) appears under that side, or under Add a side. Tapping one expands it (expand-dish), then `PUT`s `replace_dish` / `add_side`. The meal query is then refetched, so the cards and the timeline update. Each step shows loading and error-with-retry states, and there's a way to cancel the row.
- **Fallback for missing steps:** when the screen opens, any dish recipe with no structured steps is upgraded through `ensureSteps(recipe.id)` (issue #648). The meal is refetched after any `derived: true`. A dish that still has no steps (the ensure call failed) goes into the scheduler as sequential steps built from its `instructions`, with 3-min estimates (the scheduler's `estimated_duration` path). The dish card shows a small note: "Times for this dish are estimates."
- **Hidden until their tickets land:** *Add missing to grocery list* (issue #497 is open, so a comment goes on issue #497 instead) and *Start cooking* (issue #653).
- It works for draft and saved meals, and survives a reload (all state comes from `GET /api/meals/[id]`, apart from the serve-at time, which is component state).

### Components (`components/meal/`, owned by ui-ux)

These are presentational only: props in, callbacks out, and no fetching.

- **`MealDishCard`**: `{ role, title, ingredients (already scaled), instructions, steps?, stepsEstimated?: boolean, actions?: ReactNode }`. It builds on the existing recipe detail shells.
- **`SideAlternativesRow`**: `{ state: 'loading' | 'error' | 'ready', alternatives, pendingIndex?: number | null, errorMessage?, onPick(index), onRetry(), onCancel() }`. It's a horizontal scroll of three mini cards (name, blurb, est. time). While expanding, the tapped card shows as pending and the others are disabled.
- **`ServeAtControl`**: `{ mode, serveAt: string /* "HH:MM" */, anchor: MealAnchorResult, onModeChange, onServeAtChange }`. It covers the toggle, the time input and the too-late message with the "Use <earliest>" button.
