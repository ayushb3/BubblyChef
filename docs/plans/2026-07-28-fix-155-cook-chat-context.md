# Fix #155 — cook→chat handoff can land with no recipe context

## Context

When a user cooks a recipe, the Cook flow hands off to `/chat?cooking=<id>` and the
chat is supposed to be pinned to that recipe so Bubbles answers "what temp?" /
"substitute for X?" specifically about the dish being cooked.

The end-to-end plumbing is correct, but there's a **race**: the recipe context the
frontend attaches to the first chat message depends on an async
`fetchRecipe(cookingRecipeId)` resolving first (`chat/page.tsx:114-150`). The
quick-prompt chips and Send are tappable *before* that fetch resolves. If the user
sends message #1 first, it goes out with **no `cooking_recipe`**, the backend never
pins the session, and because the context is one-shot (`contextSentRef`), **every
later turn is also context-free**. The "COOKING NOW" card renders regardless, so it
*looks* pinned but isn't. A silent fetch failure is a second, rarer path to the same
state.

**Intended outcome:** the pin happens deterministically on message #1, independent of
any client-side fetch — because the recipe id (`?cooking=<id>`) is known
synchronously and the backend can resolve the full recipe itself from the DB.

## Approach — resolve the recipe server-side from the id

Move the source of truth from a client-held recipe snapshot (that must win a race) to
the id in the URL + the DB. The frontend sends only the id synchronously; the backend
resolves title + ingredients via the repository before pinning. The `fetchRecipe`
call stays purely to render the cosmetic card.

### Backend

**`ai-service/bubbly_chef/workflows/router.py` (pin block, `update_session_node`, ~L556-571)**
- `repo` and `user_id` are already in scope here (`repo` at L543, `state.get("user_id")`).
- Read the cook context and branch on shape:
  - **New id-only form:** `context["cooking_recipe_id"]` (a string) → resolve via
    `await repo.get_recipe(user_id, recipe_id)` (`supabase_repo.py:294`, returns the
    raw `recipes` row dict or `None`). Build the normalized
    `{id, title, ingredients}` dict from the row, then pin exactly as today.
  - **Legacy form (non-breaking):** `context["cooking_recipe"]` is a `dict` with
    `title`/`ingredients` already present → keep the current path unchanged.
  - Also accept `context["cooking_recipe"]` being a dict with only an `id` (defensive)
    by routing it through the same server-side resolve.
- If `get_recipe` returns `None` (deleted recipe / wrong user), log a warning and skip
  pinning — do **not** crash the turn (chat still works, just un-pinned). This makes
  failure-mode 2 explicit on the server instead of silent on the client.

**Ingredient shape gotcha (critical):** the DB `recipes.ingredients` column is `JSONB`
storing **objects** `{name, quantity, unit, preparation, optional, substitutes}`
(migration `00001_initial_schema.sql:56`; `RecipeCard.ingredients: list[Ingredient]`
in `models/recipe.py:10-43`). `normalize_cooking_recipe` (`chat/nodes.py:124`) does
`str(item).strip()` — that would stringify a dict badly. The frontend already flattens
these to `"2 cups flour"` strings via `ingredientLines()` (`chat/page.tsx:46-52`:
`[quantity, unit, name].filter(Boolean).join(' ')`).
- **Mirror that flatten server-side.** Add a small helper in `chat/nodes.py` (next to
  `normalize_cooking_recipe`), e.g. `_flatten_ingredient(raw)` that accepts a str
  (pass through) or a dict (`{quantity} {unit} {name}` joined, non-empty parts) and
  returns a display string. Extend `normalize_cooking_recipe` to run each ingredient
  through it, so the same normalizer safely handles both string lists (legacy client
  payload + existing tests) and object lists (server-resolved DB rows). This keeps a
  single normalization point and doesn't break the existing string-based tests.

**`ai-service/bubbly_chef/models/requests.py` (L95-102)** — update the `context`
field description to document the new recognised key `cooking_recipe_id` alongside the
legacy `cooking_recipe`.

### Frontend

**`nextjs/src/app/chat/page.tsx`**
- `takeCookingContext()` (L153-157): return the id-only payload synchronously from
  `cookingRecipeId` (known at L82 on mount) instead of depending on `cookingContext`
  (which requires `loadedRecipe`). New payload: `{ cooking_recipe_id: cookingRecipeId }`.
  Keep the `contextSentRef` / `isStreaming` one-shot guard.
- `cookingContext` / `ingredientLines()` (L142-150, L46-52) are now only needed for the
  legacy payload; the id-only path no longer needs them for context. Keep
  `cookingRecipe` (L135-140) — it still drives the cosmetic `CookingContextCard`
  (L308-314). `fetchRecipe` stays as-is; its failure now affects only the card.
- The seed auto-send effect (L165-171) sets `contextSentRef.current = true` before
  `sendMessage(seed.message)` — a seeded chat has no cook context, so leave as-is.

**`nextjs/src/types/chat.ts` (L114-119)** — add the id-only context shape (e.g. a
`cooking_recipe_id: string` field on the chat request context, or a new
`CookingRecipeIdContext`), keeping `CookingRecipeContext` for back-compat.

### Tests

**`ai-service/tests/test_chat_router.py`** (mirror the existing cook-handoff tests at
L205-289; fixtures `_session_repo`, `_cooking_context`, `_patch_repo`, `_state`):
- Add `repo.get_recipe = AsyncMock(return_value=<fake row dict>)` to `_session_repo`
  (or a variant) so the new path can resolve.
- **New test:** context carries only `{cooking_recipe_id: "recipe-42"}` → `get_recipe`
  is awaited with `(user_id, "recipe-42")` → session pinned, `pinned_recipe_id`
  set, `metadata["cooking_recipe"]` has the resolved title + flattened ingredient
  strings (fake row uses object ingredients like
  `[{"name":"spaghetti","quantity":200,"unit":"g"}]` → assert `["200 g spaghetti", ...]`).
- **New test:** `get_recipe` returns `None` → no pin, no crash, mode unchanged.
- **Keep** the existing legacy-dict tests passing unchanged (proves non-breaking).
- Add a unit test for the ingredient-flatten helper (str passthrough + dict flatten).

**Frontend** — scaffold a test (even if no harness for this component exists yet)
asserting the core race fix: `takeCookingContext()` returns `{cooking_recipe_id: <id>}`
synchronously on mount from `?cooking=<id>`, **without** waiting on `fetchRecipe` /
`loadedRecipe`. Since `takeCookingContext` is currently an inner closure of
`ChatSurface`, the cleanest testable unit is the pure derivation — extract the
"id → context payload" logic into a tiny exported pure helper (e.g.
`cookingContextForId(id): {cooking_recipe_id} | undefined`) and unit-test that, then
have the component call it. This avoids standing up a full React render harness while
still locking in the synchronous-on-mount guarantee. Place under
`nextjs/src/__tests__/` (existing Jest location per CLAUDE.md). Mirror the legacy path
too if kept.

## Verification

```bash
# Backend
cd ai-service && BUBBLY_RUN_LIVE_TESTS=0 pytest tests/test_chat_router.py -q
cd ai-service && ruff check bubbly_chef/

# Frontend
cd nextjs && npx tsc --noEmit   # expect the 5 pre-existing e2e/* + playwright.config.ts
                                 # errors ONLY (from the #59 harness) — not regressions
```

**Manual (the acceptance repro, #155):** with both servers up (frontend `-p 3100`, AI
`:8888`), cook a recipe → Confirm → land on `/chat?cooking=<id>`. On a throttled
connection, immediately tap a quick-prompt chip (before the card fills in). Confirm the
AI-service log shows `Session pinned to cooking recipe (recipe_id=...)` on that first
turn, and Bubbles' answer to "what temp / substitute" is recipe-specific. Then delete
the recipe and repeat → chat still works un-pinned, no crash.

## Acceptance criteria (from #155)
- First message (typed or chip) always pins the session, even sent immediately on a
  throttled connection — verified by the "Session pinned" log on that turn.
- Pin does not depend on the client finishing the fetch (server resolves from id).
- A failed/missing recipe affects only the cosmetic card, not context, and is not a
  silent crash.
- Backend still accepts the legacy full `cooking_recipe` dict (non-breaking).
- `pytest` + `npx tsc --noEmit` clean (modulo the 5 known e2e tsc errors).

## Out of scope
- #144 (constraints dropped on brainstorm follow-up) — distinct bug.
- Re-recording demo `02` / updating PR #154 — a follow-up once this lands.
- The `RecipeCard.dietary_tags` vs DB `tags` inconsistency the exploration flagged —
  unrelated to context resolution; note as a separate issue if worth tracking.

## Branch
`fix/issue-155-cook-chat-context-server-resolve` off `main`.
