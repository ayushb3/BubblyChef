# Issue #650: meal from chat, the wire contract

The shared contract between the ai-service half and the Next.js half of issue #650, *generate and save a meal from chat*. The spec is issue #647, sections "Meal schema", "API contracts", "Meal generation" and "Chat and meal UI". This doc pins the names both halves must agree on. Where it's silent, the spec rules. All wire fields are snake_case.

## Enums

- Python `Intent.MEAL_PLAN = "meal_plan"` and `NextAction.PICK_MEAL = "pick_meal"` (`ai-service/bubbly_chef/models/base.py`).
- TypeScript `ChatIntent` gains `'meal_plan'`, and `ChatNextAction` gains `'pick_meal'` (`nextjs/src/types/chat.ts`).

## Option stage: `intent: "meal_plan"`, `next_action: "pick_meal"`

`proposal`:

```jsonc
{
  "proposal_type": "meal_options",
  "options": [ /* exactly 3, fewer only if generation fails for some */
    {
      "option_id": "opt_1",            // stable within the conversation
      "title": "Lemon chicken dinner",
      "blurb": "Bright, quick, uses the romaine tonight.",
      "dishes": [                       // exactly 1 main first, then 1–2 sides
        { "role": "main", "name": "Lemon butter chicken",
          "key_ingredients": ["chicken thighs", "lemon", "butter"],
          "est_total_minutes": 30, "est_hands_on_minutes": 15 },
        { "role": "side", "name": "Buttered orzo", "key_ingredients": ["orzo", "butter"],
          "est_total_minutes": 15, "est_hands_on_minutes": 5 }
      ],
      "est_total_minutes": 35,
      "est_hands_on_minutes": 20,
      "coverage": { "pantry_items_used": 8, "to_buy": ["parsley", "shallot"] },
      "rescues": ["romaine"]            // expiring-soon items used; [] when none
    }
  ],
  "servings": 2,
  "constraints": {
    "kitchen_limits": ["one pan"],      // phrases as extracted
    "exclusive_tags": ["pan"],          // mapped tags; the scheduler's constraints.exclusive_tags
    "recipe_constraints": { }           // the RecipeConstraints echo, used later to regenerate sides
  }
}
```

- Coverage, `to_buy` and `rescues` are computed **in code** (deterministic pantry matching; staples count as assumed), never by the model.
- **Pantry opt-out** ("don't use my pantry"): `coverage` is `null`, `rescues` is `[]`, and the to-buy cap isn't applied. The client hides the coverage chip and rescue flag (PR #659 review).
- `est_total_minutes` / `est_hands_on_minutes`, on the option and on each dish, are `null` when the model gave no estimate. The client hides the time chip rather than print "null min".
- The three options are retained in the session, next to `brainstorm_ideas`, keyed by `option_id`.
- Pills: 2–4 short predicted replies ride the **existing** `metadata.follow_up_suggestions` channel. Issue #651 refines them.

## Pick: the request

The client sends a normal chat request with the same `conversation_id`. The visible `message` is the option's title, plus `context: { "meal_option_id": "opt_2" }`. The backend resolves the option from the session by id. It never fuzzy-matches the text. An unknown id gets a clear message and `next_action: "none"`.

## Pick: the response, `intent: "meal_plan"`, `next_action: "review_proposal"`

`proposal`:

```jsonc
{
  "proposal_type": "meal",
  "meal_ref": "9f3c…",                // uuid4 hex, stamped per pick; persists in the conversation history
  "title": "Lemon chicken dinner",
  "servings": 2,
  "constraints": { "kitchen_limits": [], "exclusive_tags": [], "recipe_constraints": { } },
  "dishes": [
    { "role": "main", "position": 0, "recipe": { /* the existing RecipeCard shape, including `steps` (#648), servings = meal servings */ } },
    { "role": "side", "position": 1, "recipe": { } }
  ],
  "missing_ingredients": ["parsley"]
}
```

- Dishes are expanded concurrently, one grounded, meal-aware generation per dish through `AIManager`. Each prompt knows the other dishes and the kitchen limits.
- Every dish's `recipe.steps` is validated (the #648 `build_structured_steps`). Steps that use limited equipment carry the tag in `exclusive`.
- Model unavailable, at either stage: follow the existing recipe error-kind handling (`error_kind` + message), so the client shows a clear message and a retry.

## Next.js persistence

**Migration `supabase/migrations/00013_meals.sql`** (additive): `meals` and `meal_dishes`, exactly as spec #647 "Meal schema", with RLS limiting each user to their own rows (the same shape as `recipes`) and the updated-at trigger. The orchestrator applies it via §3.1 of the implement-issue skill. Agents don't push it.

**`POST /api/meals`**:

```jsonc
{ "title": "...", "servings": 2, "constraints": { }, "is_draft": true, "source_type": "chat",
  "source_ref": "9f3c…",              // the proposal's meal_ref; optional
  "dishes": [
    { "role": "main", "position": 0, "recipe": { /* new recipe payload incl. steps; saved with is_draft = the meal's is_draft */ } },
    { "role": "side", "position": 1, "recipe_id": "uuid-of-existing-recipe" }
  ] }
```

It returns the meal as `GET /api/meals/[id]` would.

**Idempotent on `source_ref`** (migration `00014_meals_source_ref.sql`: a nullable column plus a partial unique index on `(user_id, source_ref)`). A repeat `POST` with the same `source_ref` returns the existing meal with 200 instead of creating a second. When the repeat asks for `is_draft: false` and the existing meal is a draft, it's promoted first. A repeat asking for a draft never demotes a saved meal. Two concurrent first taps: the loser's insert hits 23505 and returns the winner's meal. This is what makes Open → Back → Save one meal, since the chat page's in-memory guard doesn't survive the remount.

- **`GET /api/meals`**: saved meals, or drafts with `?drafts=1`. Each item is `{ id, title, servings, is_draft, dishes: [{ role, position, recipe_id, title, total_time_minutes }] }`.
- **`GET /api/meals/[id]`**: the meal plus `dishes[].recipe`, each the full recipe row including `steps`.
- **`PUT /api/meals/[id]`**: `{ title?, servings?, constraints?, promote?: true }`. `servings` must be a whole number from 1 to 100, otherwise 400 and nothing is written. `promote` sets `is_draft = false` on the meal and on its draft dish recipes. Dish replace / add / remove is part of the spec but not needed by this ticket's UI. If implemented, it must reject a change that leaves zero sides or more than two.
- **`DELETE /api/meals/[id]`**: deletes the meal and its *draft* dish recipes, and keeps the saved ones.
- **Default servings** is the backend's job (it generates at that size): an explicit number in the ask, else the mode of `servings` over the user's last three meals with `last_cooked_at` set, else 2. The repository gets a read method for this.

## UI (functional, existing shells; the final look is Goal 3)

- Option cards in the chat thread. A tap sends the pick request above.
- A compact meal card with **Open meal**, which does `POST` with `is_draft: true` and routes to `/meals/[id]`, and **Save meal**, which is `POST` with `is_draft: false`, or `PUT { promote: true }` if the meal was already opened. A second tap never creates a second meal.
- A minimal meal page at `/meals/[id]`: title, a servings stepper (it `PUT`s servings and scales each dish's displayed quantities by `meal.servings / recipe.servings`), and the dishes with their roles, each linking to `/recipes/[id]`.
- A library **Meals** filter, which uses `GET /api/meals`.
