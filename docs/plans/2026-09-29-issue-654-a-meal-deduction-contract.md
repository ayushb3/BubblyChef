# Issue #654, PR A: one combined deduction for a whole meal cook, the contract

PR A of two for issue #654, *Finish a meal: per-dish mid-cook amendments, one combined deduction sheet, one cook + meal bonus*. This PR builds the combined deduction and the finish flow. The PR body says **`Related to #654`**, not a closing keyword: the mid-cook amendments land in PR B (`2026-09-29-issue-654-b-meal-amendments-contract.md`), which closes the issue.

The slices:
- **backend:** ai-service;
- **frontend:** Next.js `app/` (pages and `app/api/**` routes), `lib/`, `types/`;
- **ui-ux:** `components/`.

The parent spec is issue #647, *Spec: Dinner, planned — the meal engine (Goal 1)*: its "API contracts" (meal cook and meal cook confirm) and "Chat and meal UI" (the combined deduction sheet, bubbles) sections. The previous slice's contract is `docs/plans/2026-09-29-issue-653-meal-cook-along-contract.md`. Where this doc is silent, the issue's rules apply, then the spec's. Wire fields are snake_case. Everything was checked against `main` at `abf7629`.

When the PR is built, copy this file to `docs/plans/2026-09-29-issue-654-a-meal-deduction-contract.md` in the PR.

**What PR A leaves ready for PR B:** the session's per-dish amendment slot has a type (`DishAmendment`) and a validating reader (`readDishAmendment`), and the deduction already reads it. Nothing in PR A writes it. PR B only writes into that slot.

## 0. What already exists (don't rebuild)

- **The single-recipe cook** (`ai-service/bubbly_chef/api/routes/recipes_ai.py`):
  - `POST /v1/recipes/cook` (`cook_recipe`, :191) takes `{ recipe_id }` only and always re-reads the ingredients from the DB (:207–213) before calling `match_ingredients_with_llm` (:219). The route correlates expired rows itself (:228–248).
  - `POST /v1/recipes/cook/confirm` (`cook_confirm`, :320) collapses deductions per pantry item (:346–349), applies them with `repo.deduct_pantry_item` and counts refusals (:355–365), then calls `repo.update_recipe_cooked` (:368). It has **no server-side idempotency**: two identical posts deduct twice.
- **The matcher** (`services/cook_matcher.py`):
  - `match_ingredients` (:598) parses a string ingredient with `_parse_ingredient_string` (:405, called at :660–661), then keeps a per-row `consumed` ledger (:655, :718, :909, :927). Two lines of *one* recipe that hit the same row already become a shortfall. A shortfall's `shortfall` is rounded to 4 dp (:939), and `deduct_qty` is what's left.
  - `_parse_ingredient_string("2 cloves garlic")` returns `{name: "garlic", quantity: 2.0, unit: "cloves"}`. `"salt to taste"` returns no quantity.
  - Duplicate pantry rows: the index keeps only the highest-quantity row per normalized name (:630–640). Issue #127, *Cook flow: duplicate pantry rows under-report available stock*, is **closed**, but this code still has the limitation, and meals inherit it.
  - `match_ingredients_with_llm` (:1247) makes one alias call for whatever the synonym table can't place (`_unmatched_ingredient_names`, :954; `resolve_aliases_with_llm`, :987), then filters notes and compound suggestions to what's still missing (:1286–1307).
  - `_alias_cache` is module-global (:84). `tests/conftest.py`'s autouse `reset_alias_cache` fixture (:28–40) already clears it around every test.
  - A `unit_conflict` line's `base_unit` is `pantry_base_unit or ing_unit` (:861). So when the pantry row has no base unit, `base_unit` is that dish's recipe unit.
- **Models** (`models/cook.py`): `IngredientMatch` (:9), `CookProposal` (:152), `DeductionItem` (:195), `CookConfirmRequest` (:203). Nothing carries a source dish. `CookProposal` is in the proposal unions (`models/proposals.py`: `ProposalUnion` :330, `AnyProposal` :345).
- **Repository** (`repository/supabase_repo.py`):
  - `update_recipe_cooked` (:710) does a read then a write.
  - `deduct_pantry_item` (:736) floors at 0, and returns `False` on a row with no recorded or derivable base unit.
  - `get_recent_meal_servings` (:986) already reads `meals.last_cooked_at`, so the default-servings rule starts working once this PR writes that column.
  - `get_meal_with_dishes` (:1024) returns the meal row plus `{role, position, recipe}` per dish, ordered by position. It reads `recipe_id` from `meal_dishes` but **doesn't return it**, and a recipe that can't be read comes back as `recipe: {}` (:1057–1060).
- **Schema:** `meals` (`00013_meals.sql`:12–28) has `times_cooked`, `last_cooked_at` and `is_draft`. `meal_dishes` cascades on recipe delete (:53). The latest migration is `00014_meals_source_ref.sql`.
- **Next.js proxies:**
  - `app/api/ai/recipes/cook/confirm/route.ts` uses `aiProxyJson` (:43). It reads the pantry rows' expiry before forwarding (:31–41). After a 2xx it awards `cook_confirm` with `${recipe_id}:${server UTC date}` (:53–56), and capped `rescue` awards with `${pantry_item_id}:${server UTC date}`, judging "expiring soon" on the client's `date` (:69–76).
  - The meal proxy `app/api/ai/meals/side-alternatives/route.ts` uses `aiProxyFetch`, parses once, and returns `NextResponse.json(data, { status: res.status })` (:16–26).
  - Non-streaming AI calls go through `/api/ai/*` with `lib/api/ai-proxy.ts` (header, :7–8).
- **PR #595, *fix(bubbles): key daily_visit/cook_confirm/rescue on one exact local date*** (open; fixes issue #550, *Bubbles ledger: date keys let daily_visit be claimed ahead and cook_confirm pay twice across UTC midnight*). It rewrites the recipe confirm proxy's keying: `cook_confirm` and `rescue` are keyed on the client's exactly-validated local date, `cook_confirm` gets a 20h cooldown on the ledger's `created_at`, and `validateClientDate` gains an offset parameter. It collides with this PR's award extraction (same file, same lines) and touches `lib/bubbles.ts`. See §4 for the single keying function and the merge order.
- **Issue #651, *Predictive pills and meal entry points*** (open; its PR A is being built in the shared worktree on `feat/issue-651-a-predictive-pills`, with no PR opened yet). Its uncommitted edits add `get_recent_cuisines` to `supabase_repo.py` near :532, which shifts `get_meal_with_dishes` down by about 64 lines. There's no semantic overlap with this PR. **Every line number in this doc is at `abf7629`**, so re-locate by symbol if #651 lands first.
- **Bubbles:** `lib/bubbles.ts` has `BUBBLE_AMOUNTS` (:22–32), `RESCUE_CAP_PER_COOK = 3` (:40), and `awardBubbles`, which never throws (:56). `bubble_events.event_type` is open text, checked only as snake_case (`00011_gamification_bubbles_ledger.sql`:59), and `(user_id, event_type, ref_key)` is unique (:63), so a repeated award is a no-op. `meal_bonus` needs **no migration**. `BubblePop` pops the balance *delta* on the next `['bubbles']` refetch (`components/ui/BubblePop.tsx`:57–62), so one invalidation after all awards land shows the total.
- **The single-recipe sheet** (`components/recipes/CookModal.tsx`):
  - It fetches its own proposal (:572–592).
  - `summariseDeductions` (:418) reads only `matches` and `compound_suggestions`, and merges deductions per pantry item (:470). The cross-suggestion key guard is :494–510.
  - It rechecks the two-tab guard before confirming (:613), calls `endCookSession` only after `confirmCook` resolves (:630), and redirects after **1200 ms** (`setTimeout` at :633, the delay at :637).
  - The review body is :809–926, the footer summary text :935–979, and the confirm label demotion ("Cook anyway") :1002–1023. `formatQty` (:109) is private.
  - Exports used elsewhere: `summariseDeductions` and `MissingItemsList` (`assumed-staples.test.tsx`:14, `cook-flow-redesign.test.tsx`:374), `compoundOverrideKey` (`cook-flow-redesign.test.tsx`:665), `effectiveCompoundOverride` (:1120), and the default export (`app/chat/page.tsx`:24, `RecipeBook.tsx`:14, `cook-session-teardown.test.tsx`:118).
- **The ended one-way door:** `lib/cook-session.ts` (issue #440), mirrored by `lib/meal-cook-session.ts`: `endMealCookSession` (:240), and `getActiveMealCookSession` refuses an ended meal (:215). `saveMealCookProgress` is a no-op once the meal is ended (:199–202). `startMealCookSession` (:171) replaces any other meal's active session silently.
- **The meal cook-along (issue #653, closed; merged in PR #661):**
  - `MealCookSession.ingredient_amendments` is typed `Record<string, unknown[]>` (:64), initialized `{}` (:187), and guarded only as "an object" (:101). The guard is `isMealCookSession` (:87).
  - Step keys are `${dish_id}:${index}` (`lib/meal-cook-stream.ts`:94), and `dish_id` is the recipe id (`lib/meal-dishes.ts`:52). A dish with no structured steps gets `fallbackSteps(instructions)` (:55–56), which is empty when it has no instructions either.
  - `deriveStream` returns `finished` when there's at least one step and every step is done or skipped (`lib/meal-cook-stream.ts`:445–448).
  - `timerIdsToDismiss` (:249) returns only `running` records' timers, so it's always empty for a finished session.
  - The cook page renders `MealCookFinished` on `finished` (`app/meals/[id]/cook/page.tsx`:410–411). ✕ Close (`handleClose`, :332–334) leaves the session active. "Back to meal" (`handleBackToMeal`, :336–339) calls `endMealCookSession`.
  - The meal screen shows Start cooking only when this meal has no active session (`app/meals/[id]/page.tsx`:572–581), "Resume cooking?" for an active non-stale one (:583–611), and the stale notice otherwise (:612–630). `activeCookSession` is memoized on `[meal]` only (:228).
- **Scaling on the meal screen:** `scale = meal.servings / (recipe.servings > 0 ? recipe.servings : meal.servings)` (`app/meals/[id]/page.tsx`:725–726), applied with `scaledIngredients` (`lib/recipe-helpers.ts`:222–234). That helper turns a **string** ingredient into `{ name: "<whole string>" }` unscaled. Fine for display, wrong for the matcher: see §3.
- **Frontend types:** `IngredientMatch`, `CompoundSuggestion`, `ExpiredMatchedItem`, `CookProposal` and `DeductionItem` are in `types/recipes.ts` (:134, :185, :200, :209, :227). `RecipeIngredient` (:46) has `name`, `quantity`, `unit`, `preparation`, `optional`. It has **no** `notes`.
- **Queries to invalidate:** `['bubbles']`, `['pantry']`, `['meal', id]`, `['meals']`, and `['inbox-entries']` (`hooks/useInboxEntries.ts`:76).

## 1. Where it lives: new meal routes

**Decision:** two new ai-service routes in `api/routes/meals_ai.py` (prefix `/v1/meals`, :35), `POST /v1/meals/cook` and `POST /v1/meals/cook/confirm`. The logic goes in a new `services/meal_cook.py` that reuses the matcher's functions. The Next.js proxies are `app/api/ai/meals/cook/route.ts` and `app/api/ai/meals/cook/confirm/route.ts`.

- *Rejected:* a meal wrapper on `/v1/recipes/cook`. One route would return two response shapes, and its confirm marks one recipe and knows nothing about the meal row.
- *Rejected:* calling `/v1/recipes/cook` once per dish and merging in the browser. That's N model calls, and the status logic would be reimplemented in TypeScript, where it would drift from the matcher's.
- `MealCookProposal` is **not** added to `ProposalUnion` or `AnyProposal` (`models/proposals.py`:330, :345). It never travels in a chat envelope.

## 2. Wire shapes (backend owns the Pydantic models in `models/cook.py`; frontend mirrors them in `types/meals.ts`, §2d)

### 2a. `POST /v1/meals/cook` (no writes)

```python
class MealCookIngredient(BaseModel):
    # The object shape a recipe row stores, as the frontend's RecipeIngredient
    # sends it. Its `preparation` key isn't modelled and is dropped (Pydantic
    # ignores extra keys). `notes` is accepted for an amendment's objects.
    name: str                                 # plain str; a blank name is dropped server-side
    quantity: float | None = None
    unit: str | None = None
    optional: bool = False
    notes: str | None = None

class MealCookDishRequest(BaseModel):
    recipe_id: UUID
    # The list as cooked (§3). OBJECTS are at meal scale and used verbatim. STRINGS
    # are at recipe scale: the server parses each and scales it by string_scale.
    # None means "read the recipe row and scale everything by servings / recipe servings".
    ingredients: list[str | MealCookIngredient] | None = Field(default=None, max_length=100)
    # meal servings / recipe servings, set by the client. Applied to string elements only.
    # Ignored when `ingredients` is None (the server derives its own factor).
    string_scale: float = Field(default=1.0, gt=0, le=100)

class MealCookRequest(BaseModel):
    meal_id: UUID
    servings: int = Field(ge=1, le=100)       # the bounds PUT /api/meals/[id] enforces
    dishes: list[MealCookDishRequest] = Field(min_length=1, max_length=3)   # unique recipe_ids, else 422
```

```python
class MealCookSource(BaseModel):              # one dish's contribution to a merged line
    recipe_id: UUID
    dish_title: str
    ingredient_name: str                      # that dish's own spelling
    ingredient_qty: float | None
    ingredient_unit: str | None
    # ready/substitute: deduct_qty; shortfall: deduct_qty + shortfall; everything else: None
    required_base_qty: float | None
    status: <IngredientMatch.status literal>  # the per-dish status, before merging
    match_type: Literal["exact", "substitute", "none"]
    substitution_note: str | None

class MealIngredientMatch(IngredientMatch):   # every IngredientMatch field keeps its meaning
    sources: list[MealCookSource] = Field(min_length=1)

class MealCookProposalDish(BaseModel):
    recipe_id: UUID
    title: str
    role: Literal["main", "side"]
    position: int
    ingredients_source: Literal["supplied", "recipe"]

class MealCookProposal(BaseModel):
    proposal_type: Literal["meal_cook"] = "meal_cook"
    meal_id: UUID
    meal_title: str
    servings: int
    dishes: list[MealCookProposalDish]        # only the requested dishes, by position
    matches: list[MealIngredientMatch]
    missing: list[str]
    missing_sources: dict[str, list[UUID]]    # key: the exact string in `missing`
    missing_notes: dict[str, str]
    unit_conflicts: list[dict[str, str]]      # the existing keys, plus "recipe_id"
    compound_suggestions: list[CompoundSuggestion]
    expired_items: list[ExpiredMatchedItem]
```

- **Errors:**
  - An unknown or foreign meal is `404 "Meal not found"`.
  - A `recipe_id` that isn't a dish of this meal is `409 { detail: { error_kind: "dish_mismatch", message } }`. Membership comes from each dish dict's `recipe_id` (below, N1). A dish whose recipe came back as `recipe: {}` (deleted between the two reads) doesn't count as a member.
  - Duplicate `recipe_id`s are a `422`.
  - A matcher crash is a `500`, as `/v1/recipes/cook` does. A model outage **degrades**, as today: unplaced ingredients just become missing.
- **`get_meal_with_dishes` (N1):** each dish dict gains `"recipe_id": raw["recipe_id"]` (as a str). The change is additive, so the issue #652 callers are unaffected.
- **Matching** (`match_meal_with_llm(dishes, pantry_items, ai_manager)` in `services/meal_cook.py`):
  1. **Resolve each dish's list** into matcher-ready dicts:
     - **Supplied:** a `MealCookIngredient` becomes its dict, verbatim. A `str` is parsed with `_parse_ingredient_string`. When `string_scale != 1`, a numeric `quantity` is multiplied by `string_scale` and rounded to 2 dp. At `1` it passes through unrounded (Nit 2). An element whose name is blank after stripping is dropped.
     - **Fallback** (`ingredients is None`): the recipe row's `ingredients`. `recipe_servings = recipe.servings if > 0 else servings`, and `factor = servings / recipe_servings`. When `factor != 1`, a dict's numeric `quantity` is scaled, and a string is parsed and scaled by the same `factor`, both rounded to 2 dp. At `1` nothing is scaled or rounded. This is the meal screen's factor (`page.tsx`:725–726), extended to strings.
     - Pre-parsing a string gives the same `ingredient_name` the matcher's own parse gives today (:660–661), so nothing downstream changes.
  2. **One** `resolve_aliases_with_llm` call, for the de-duplicated (by `_normalize_ingredient_name`) union of every dish's `_unmatched_ingredient_names`. Nothing unmatched means no call.
  3. `match_ingredients(aliases=…)` **per dish**, each against the full pantry. The cross-dish accounting happens in the merge.
  4. `missing_notes` and `compound_suggestions` are filtered to what's still missing, per dish, exactly as `match_ingredients_with_llm` does (:1286–1307).
  5. `merge_meal_matches` (2b).
  6. Expiry correlation over the merged lines, once per pantry item. Move the route's :228–248 block into `services/meal_cook.py::correlate_expired(matches, pantry_items)` and call it from both routes, so `/v1/recipes/cook`'s behaviour is unchanged.

### 2b. `merge_meal_matches`: pure, deterministic, unit-tested directly

Input: `[(dish, CookProposal)]` in position order (main, then side 1, then side 2). Output: the merged `matches`, `missing`, `missing_sources`, `missing_notes`, `unit_conflicts` and `compound_suggestions`.

- **A substitute source** means `match_type == "substitute"`. That includes a short substitute, whose status is `shortfall` (`models/cook.py`:44–46).
- **Line kind** for a per-dish match `m` with a `pantry_item_id`:
  - `measured`: status `ready`, `substitute` or `shortfall`. That includes a no-quantity `ready`/`substitute`, where `deduct_qty is None`.
  - `unit_conflict`.
  - `imprecise`.
- **Merge key** is `(pantry_item_id, line kind)`. `assumed` lines (staples, no pantry item) merge by `_normalize_ingredient_name`. So one pantry item is one line in the ordinary case, and at most three lines when dishes use it in genuinely different ways.
  - *Rejected:* forcing one line per pantry item. Folding a `unit_conflict` part into a measured line would drop its typed-quantity input and silently under-deduct. The sheet's deductions are merged per pantry item anyway (`summariseDeductions`, `CookModal.tsx`:470, and the confirm collapse).
- **A merged `measured` line:**
  - `Q` is its sources with `required_base_qty is not None`.
  - `total = Σ required_base_qty(Q)`.
  - `available` is the maximum `pantry_qty_available` over `Q`. Every dish's pass starts with an empty ledger, so its first line on a row reports the row's full base quantity.
  - **Shortfall test with a 1e-4 tolerance:** `total > available + 1e-4` gives `status="shortfall"`, `deduct_qty=available` and `shortfall=round(total − available, 4)`. The tolerance absorbs the 4 dp rounding already inside a per-dish shortfall source's `required_base_qty` (:939).
  - Otherwise `deduct_qty=min(total, available)`, and `status="substitute"` if every `Q` source is a substitute source, else `"ready"`. **This is where two individually "ready" dishes become a shortfall.**
  - With `Q` empty (only no-quantity parts), the status is `substitute` if every source is a substitute source, else `ready`. `deduct_qty=None`, and `pantry_qty_available` is the maximum over the sources.
  - `match_type="substitute"` only when every source is a substitute source, and then `substitution_note` is the first source's note. Otherwise it's `"exact"` with no note. Per-dish notes stay on `sources`.
  - `ingredient_name` is the first source's. `ingredient_qty` and `ingredient_unit` are the sum and the shared unit when every `Q` source has the same unit (case-insensitive, trimmed); otherwise both are `None`. The sheet then shows the base quantity (`formatQty(deduct_qty, base_unit)`, `CookModal.tsx`:868). `base_unit` is the `Q` sources' value, which is always the row's base unit.
- **A merged `unit_conflict` or `imprecise` line:** `deduct_qty=None`, with qty and unit summed when they share a unit, else `None`. The user types one quantity for a `unit_conflict` line, as today.
  - **The `base_unit` caveat:** it's the first source's. A `unit_conflict` source's `base_unit` falls back to *its own* recipe unit when the pantry row has no base unit (:861), so two sources can disagree. That only happens on a row with no base unit, which `deduct_pantry_item` refuses anyway. The confirm reports it in `deductions_skipped`, and nothing is deducted in the wrong unit.
- **Order:** the first appearance across dishes in position order, then line order within each dish.
- **`missing`:** the union by normalized name, keeping the first spelling and first-appearance order. `missing_sources[spelling]` lists every dish that lacked it.
- **`missing_notes`** (Nit 1): the first note wins, and it's **re-keyed to the kept spelling**. If the main kept "Heavy cream" and the side's note was under "heavy cream", the merged map has `"Heavy cream": <note>`. So every key is an exact string in `missing`, which is how the sheet looks notes up.
- **`compound_suggestions`** (Nit 1): de-duplicated by `_normalize_ingredient_name(ingredient_name)` (not just `.lower()`), keeping the first. The kept suggestion's `ingredient_name` is rewritten to the kept `missing` spelling, so the sheet's case-insensitive lookup (`MissingItemsList`, `CookModal.tsx`:264–266) and `compoundOverrideKey` agree on one name. The frontend's cross-suggestion key guard (`CookModal.tsx`:494–510) stays as the belt-and-braces.
- **`unit_conflicts`:** the union, with each entry's `"recipe_id"` set, de-duplicated on `(ingredient.lower(), recipe_unit, pantry_unit, recipe_id)`.

### 2c. `POST /v1/meals/cook/confirm` (the writes)

```python
class MealCookConfirmRequest(BaseModel):
    meal_id: UUID
    # MealCookSession.cook_id (§3). A safe charset, because it goes into a PostgREST filter.
    cook_ref: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    recipe_ids: list[UUID] = Field(min_length=1, max_length=3)   # the dishes actually cooked (§3), unique
    deductions: list[DeductionItem]
# `date` is sent by the client for the proxy and ignored here (extra keys are ignored, as on CookConfirmRequest).

class MealCookClaim(BaseModel):              # what repo.claim_meal_cook returns
    outcome: Literal["claimed", "replay_applied", "replay_in_progress", "replay_claimed"]
    times_cooked: int
    cooked_on: date                           # the UTC date of the claim's last_cooked_at
```

Response 200:

```json
{ "success": true, "already_confirmed": false,
  "deductions_applied": 4, "deductions_requested": 5, "deductions_skipped": ["<pantry_item_id>"],
  "recipes_marked_cooked": ["<recipe_id>", "..."], "meal_times_cooked": 3,
  "cooked_on": "2026-09-29" }
```

On a replay of an applied cook, the counts are zero, `deductions_skipped` and `recipes_marked_cooked` are `[]`, and `meal_times_cooked` and `cooked_on` are the stored values.

**The idempotency record lives on the meal row (S2):** `meals.last_cook_ref` and `meals.last_cook_status` (`'claimed' | 'applied'`), added by migration 00015 (§6).

Order of operations. **Claim first, then write. It never double-deducts.**

1. `get_meal_with_dishes` → 404. No writes yet.
   - **A replay skips the membership check (S3).** When the meal row (the query selects `*`, so it carries `last_cook_ref`) has `last_cook_ref == cook_ref`, go straight to step 2's classification. Otherwise a dish swapped after a successful confirm would turn a harmless replay into a `dish_mismatch`.
   - Otherwise, any `recipe_ids` entry that isn't a member (§2a) → 409 `dish_mismatch`.
2. `repo.claim_meal_cook(user_id, meal_id, cook_ref) -> MealCookClaim | None` (new):
   - Read `times_cooked, last_cook_ref, last_cook_status, last_cooked_at`. No row → `None` → 404.
   - **`last_cook_ref == cook_ref`:** don't write. A null status with a matching ref is treated as `'claimed'`.
     - Status `'applied'` → `replay_applied`.
     - Status `'claimed'` with `last_cooked_at` less than **30 s** before `now(UTC)` → `replay_in_progress` (S2). The first post is probably still writing.
     - Status `'claimed'` and older → `replay_claimed`.
   - **Otherwise** update `{ times_cooked: n+1, last_cooked_at: now(UTC), last_cook_ref: cook_ref, last_cook_status: 'claimed' }` with `.eq(id).eq(user_id).or_("last_cook_ref.is.null,last_cook_ref.neq.<cook_ref>")`. One updated row → `claimed`, with `cooked_on = now(UTC).date()`. Postgres rechecks that `WHERE` after the row lock, so two racing posts with one ref update once.
   - **Zero rows updated:** re-read once and classify as above (a racing post with the same ref just won). Still no matching row → `None`.
3. **`replay_applied`** → 200, `already_confirmed: true` (the shape above). **No other writes.**
4. **`replay_in_progress`** → `409 { detail: { error_kind: "confirm_in_progress", message: "This cook is still being saved." } }`. **No writes.** The sheet waits and retries once (§5).
5. **`replay_claimed`** → `409 { detail: { error_kind: "confirm_incomplete", message: "This cook started saving but didn't finish. Your pantry may be partly updated." } }`. **No writes.** It's never retried automatically (§5).
6. **`claimed`:**
   1. Collapse and apply the deductions. Move `recipes_ai.py`:346–365 into `services/meal_cook.py::apply_collapsed_deductions(repo, user_id, deductions) -> (applied, requested, skipped)`, and call it from both confirm routes.
      - **On an exception partway (Nit 5),** it logs the ids already applied (and `skipped`) at error level, then re-raises the original exception unchanged. So the route's 500 log names what landed, and `/v1/recipes/cook/confirm`'s 500 behaviour is unchanged apart from the extra log line.
   2. `repo.update_recipe_cooked` once per `recipe_ids` entry.
   3. `repo.mark_meal_cook_applied(user_id, meal_id, cook_ref)` (new): `update { last_cook_status: 'applied' }` with `.eq(id).eq(user_id).eq("last_cook_ref", cook_ref)`, so it never stamps a newer cook's claim.
   4. Return 200 with `already_confirmed: false` and `cooked_on` from the claim.
7. **A failure after the claim** returns 500, and the status stays `'claimed'`. The log line names `cook_ref`, the meal, and the pantry item ids already applied (from `apply_collapsed_deductions`' own log). A retry within 30 s of the claim gets `confirm_in_progress`, and a later one gets `confirm_incomplete`. The worst case is a partial deduction the user is told about, never a double one.
   - *Rejected:* deduct first, then claim. A lost response plus a retry deducts twice.
- **Never touched:** `meals.is_draft`. Cooking a draft meal doesn't promote it (N6). Neither does `update_recipe_cooked` promote a draft recipe: it writes only `times_cooked`/`last_cooked_at`.
- **The single-slot limitation (N8), accepted:** only the latest `cook_ref` is remembered. If cook A's response is lost, cook B of the same meal confirms, and *then* A is replayed, A claims again and deducts again. That needs a lost response, a second full cook of the same meal, and a stale retry of the first, all in that order. It's documented and not handled.
- *Rejected:* a `meal_cooks` table (one row per `cook_ref`, unique on `(meal_id, cook_ref)`). It would remember every ref and remove N8, but it adds a table, RLS policies and a second write path for a replay that needs three rare events in a row.

### 2d. The TypeScript mirrors (frontend, `types/meals.ts`, written out verbatim; build step 0)

```ts
import type {
  CompoundSuggestion,
  DeductionItem,
  ExpiredMatchedItem,
  IngredientMatch,
  IngredientMatchStatus,
  IngredientMatchType,
} from '@/types/recipes'

/**
 * One ingredient object on a meal cook request (issue #654). RecipeIngredient's
 * fields except `preparation` (the AI service ignores it), plus `notes`, which an
 * amendment's objects carry. A blank `name` is dropped server-side.
 */
export interface MealCookIngredient {
  name: string
  quantity?: number | null
  unit?: string | null
  optional?: boolean
  notes?: string | null
}

export interface MealCookDishRequest {
  recipe_id: string
  /** Objects at meal scale (used verbatim); strings at recipe scale (scaled by the server with `string_scale`). */
  ingredients: (string | MealCookIngredient)[] | null
  /** meal servings / the recipe's effective servings. Applied to string elements only. */
  string_scale: number
}

export interface MealCookRequest {
  meal_id: string
  servings: number
  dishes: MealCookDishRequest[]
}

/** One dish's contribution to a merged line. */
export interface MealCookSource {
  recipe_id: string
  dish_title: string
  ingredient_name: string
  ingredient_qty: number | null
  ingredient_unit: string | null
  required_base_qty: number | null
  status: IngredientMatchStatus
  match_type: IngredientMatchType
  substitution_note: string | null
}

export interface MealIngredientMatch extends IngredientMatch {
  sources: MealCookSource[]
}

export interface MealCookProposalDish {
  recipe_id: string
  title: string
  role: MealDishRole
  position: number
  ingredients_source: 'supplied' | 'recipe'
}

export interface MealCookProposal {
  proposal_type: 'meal_cook'
  meal_id: string
  meal_title: string
  servings: number
  dishes: MealCookProposalDish[]
  matches: MealIngredientMatch[]
  missing: string[]
  /** Key: the exact string in `missing`. */
  missing_sources: Record<string, string[]>
  missing_notes: Record<string, string>
  unit_conflicts: Array<{ ingredient: string; recipe_unit: string; pantry_unit: string; recipe_id: string }>
  compound_suggestions: CompoundSuggestion[]
  expired_items: ExpiredMatchedItem[]
}

export interface MealCookConfirmRequest {
  meal_id: string
  /** MealCookSession.cook_id. */
  cook_ref: string
  /** The dishes actually cooked (cookedDishIds). */
  recipe_ids: string[]
  deductions: DeductionItem[]
  /** The client's local date (localDateString()), for the proxy's rescue judgement. The AI service ignores it. */
  date: string
}

export interface MealCookConfirmResponse {
  success: true
  already_confirmed: boolean
  deductions_applied: number
  deductions_requested: number
  deductions_skipped: string[]
  recipes_marked_cooked: string[]
  meal_times_cooked: number
  /** YYYY-MM-DD: the UTC date of the claim's last_cooked_at. The award key date. */
  cooked_on: string
}

export type MealCookErrorKind = 'dish_mismatch' | 'confirm_in_progress' | 'confirm_incomplete'

/** What lib/api/meals.ts throws for a meal cook call (the class itself is in lib/api/meals.ts, §4). */
export interface MealCookError {
  message: string
  kind?: MealCookErrorKind
}
```

- `MealDishRole` is already in `types/meals.ts` (:12).
- The `MealCookError` interface is the shape. The throwable class of the same name lives in `lib/api/meals.ts` (§4) and satisfies it structurally. `lib/api/meals.ts` imports only `MealCookErrorKind` from here, so the two names never meet in one module.
- **`lib/meal-cook-session.ts` imports `MealCookIngredient` from `@/types/meals`.** It doesn't redeclare it.
- **Build step 0:** frontend commits `types/meals.ts` with exactly this block (type-only, no runtime code) as the branch's first commit. ui-ux starts from that commit.

## 3. The session and the deduction inputs (frontend `lib/`)

### The session (`lib/meal-cook-session.ts`)

```ts
import type { MealCookIngredient } from '@/types/meals'

export interface DishAmendment {
  /** The FULL replacement list (RecipeAmendmentProposal.amended_ingredients), at `servings` scale. */
  ingredients: MealCookIngredient[]
  /**
   * The servings the list is expressed at: the recipe's effective servings
   * (recipe.servings > 0 ? recipe.servings : meal.servings) when it was written.
   * cookedIngredientsForDish rescales by mealServings / servings.
   */
  servings: number
  change_summary: string | null
  applied_at_ms: number
}

export interface MealCookSession {
  // ...every #653 field unchanged...
  /** Idempotency key for the confirm (§2c). Always set by startMealCookSession; optional only for sessions written before #654. */
  cook_id?: string
  /**
   * Per-dish amendment slot, keyed by dish id (= recipe id). Written only by PR B's
   * withDishAmendment; read ONLY through readDishAmendment, which validates.
   * `{}` stays valid, so a #653 session restores.
   */
  ingredient_amendments: Record<string /* dish_id */, unknown>
}
```

- **`startMealCookSession`** also sets `cook_id: crypto.randomUUID()`.
- **The guard** (`isMealCookSession`, :87) additionally accepts `cook_id` when it's `undefined` or a string. The `ingredient_amendments` check stays "is an object", so a session from #653 still restores.
- **Pure helpers, all new:**
  - `ensureCookId(session)`: the same object when `cook_id` is a string matching `^[A-Za-z0-9-]{1,64}$`. Otherwise it's a copy with `cook_id: \`legacy-${Math.trunc(session.started_at_ms)}\``.
    - It's deterministic (N5), so two tabs restoring the same pre-#654 session derive the same ref and the server's claim still dedupes them.
    - The cook page calls it on restore and saves the result.
  - `readDishAmendment(session, dishId): DishAmendment | null` validates the shape:
    - `ingredients` is a non-empty array of objects, each with a non-blank string `name`, `quantity` a finite number, `null` or absent, and `unit` a string, `null` or absent;
    - `servings` is a finite number > 0;
    - `change_summary` is a string or `null`;
    - `applied_at_ms` is a number.
    - Anything else gives `null`, so the dish falls back to its recipe list. It's never a corrupt session.
- **One amendment slot per dish.** The latest full list replaces the previous one. *Rejected:* an edit log. The model already returns the full stacked list, so a log adds shape for nothing.
- `withDishAmendment` is **not** in this PR (PR B writes the slot).

### Deduction inputs (`lib/meal-cook-deduction.ts`, new, pure)

- `recipeServingsFor(dish: MealDishFull, mealServings: number): number` returns `recipe.servings > 0 ? recipe.servings : mealServings`, the meal screen's rule.
- `isMealCookFinished(session, dishes: SchedulerDish[]): boolean` lives in `lib/meal-cook-stream.ts`. It's true when there's at least one step key (`${dish_id}:${i}` over every dish's steps) and every key's record is `done` or `skipped`. `deriveStream`'s check at :445–448 calls it, **keeping the `streamSteps.length > 0` guard**, so there's one definition.
- `cookedDishIds(dishes: SchedulerDish[], session): string[]` (S9): a dish counts as **not cooked only when it has ≥1 step and every step is `skipped`**. A zero-step dish (no structured steps and no instructions) counts as cooked.
- `cookedIngredientsForDish(dish: MealDishFull, mealServings, session): { ingredients: (string | MealCookIngredient)[]; string_scale: number }`, where `string_scale = mealServings / recipeServingsFor(dish, mealServings)`:
  - **With `readDishAmendment` non-null:** its objects. When `mealServings / amendment.servings != 1`, each numeric `quantity` is scaled by that factor and rounded to 2 dp.
  - **Otherwise:** the recipe's ingredients. **Objects** get the meal-screen factor on a numeric `quantity` (scaled and rounded to 2 dp only when the factor isn't 1, Nit 2), and `preparation` is dropped. **Strings stay strings, unscaled**: the server scales them with `string_scale` (§2a).
  - **Sanitising (S5),** applied to either list before it's returned, so the request never 422s on a malformed stored recipe:
    - it keeps only **strings** (non-blank after trimming) and **objects with a non-blank string `name`**, and drops everything else (`null`, numbers, nameless or non-string-named objects);
    - a `quantity` that isn't a finite number (`NaN`, `Infinity`, a string) becomes `null`;
    - it sends **at most 100 elements** (the server's `max_length`), keeping the first 100.
  - Don't use `scaledIngredients` here. Its `{ name: "1 cup flour" }` hides the quantity from the matcher's string parser (`cook_matcher.py`:660–661).
- `buildMealCookRequest(meal, session, dishes): MealCookRequest | null`. It sends every cooked dish with its `ingredients` always supplied, plus `string_scale`, and returns `null` when no dish was cooked.

### Skipped steps

- **A dish whose every step was skipped isn't cooked** (and it has at least one step). It's left out of the request and the confirm's `recipe_ids`, so it's not deducted and not marked cooked. The finished screen names it.
- **A partial skip changes nothing.** Structured steps have no link from a step to its ingredients (the fields are text, label, ongoing_label, duration, hands_on, depends_on, exclusive), so a partial skip can't safely remove anything.
- *Rejected:* ignoring skips entirely, which deducts a dish that was never made.
- *Rejected:* inferring removals from step text, which is unreliable.

## 4. Confirm, the proxies, and bubbles (frontend)

### `app/api/ai/meals/cook/route.ts`

A pass-through proxy to `/v1/meals/cook`, exactly the `side-alternatives` pattern (`aiProxyFetch`, parse once, `NextResponse.json(data, { status: res.status })`).

### `lib/cook-awards.ts` (new): the one place cook award keys are built (S8)

```ts
export type CookAwardSubject = { kind: 'recipe'; recipeId: string | null } | { kind: 'meal'; mealId: string }

export interface CookAwardRefs {
  cookConfirm: string | null   // null: no cook_confirm award (a recipe body with no recipe_id)
  mealBonus: string | null     // meal only
  rescue: (pantryItemId: string) => string
}

/** recipe: `${recipeId}:${keyDate}`; meal: `meal:${mealId}:${keyDate}` for both cook_confirm and meal_bonus. rescue: `${pantryItemId}:${keyDate}`. */
export function cookAwardRefs(subject: CookAwardSubject, keyDate: string): CookAwardRefs

/** The pantry rows' expiry_date, read BEFORE forwarding (moved from the recipe proxy :31–41). */
export async function readExpiryByItemId(
  supabase: SupabaseClient, userId: string, pantryItemIds: string[],
): Promise<Map<string, string | null>>

/** De-duplicated, order-preserving, minus excludeIds, expiring-soon on validDate, capped at RESCUE_CAP_PER_COOK. */
export function rescueCandidates(
  pantryItemIds: string[], expiryByItemId: Map<string, string | null>, validDate: string, excludeIds?: string[],
): string[]

/** Awaits cook_confirm, then meal_bonus, then each rescue, in that order. Never throws (awardBubbles never does). */
export async function awardCookBubbles(userId: string, refs: CookAwardRefs, rescueIds: string[]): Promise<void>
```

- **The recipe proxy** (`app/api/ai/recipes/cook/confirm/route.ts`) switches to these helpers with **no behaviour change**: it keeps `aiProxyJson`, keys on the server's UTC `today` as on `main`, awards `cook_confirm` only when `recipe_id` is set, and rescues only with a valid `date`. `cook-confirm-route.test.ts` passes unchanged.
- **The merge order with PR #595** (*fix(bubbles): key daily_visit/cook_confirm/rescue on one exact local date*, open). **Decision (review 2): this PR lands first, and PR #595 rebases onto `lib/cook-awards.ts` afterwards.**
  - This PR is built on `main` without #595. The recipe proxy keeps `main`'s keying (server UTC `today`) behind `cookAwardRefs`, and the meal proxy uses `main`'s `validateClientDate(date, 'date')`.
  - **#595's rebase** changes the recipe route's `keyDate` argument to its `validDate`, adds its cooldown gate in the recipe route (a gate, not a key, so it stays out of `cookAwardRefs`), and updates the meal proxy's `validateClientDate` call to the new offset signature. The rebase must leave `meal-cook-confirm-route.test.ts` green.
  - The **meal** keys stay on `cooked_on` after the rebase. #595's problem (a replay across midnight pays twice) can't happen for a meal, because `cooked_on` is fixed by the server's claim and returned identically on every replay.
  - Record this order in the sprint doc when this PR opens, and leave a comment on PR #595 pointing at `lib/cook-awards.ts` once this merges.

### `app/api/ai/meals/cook/confirm/route.ts` (S7)

`requireAuth()` comes first.

1. Parse the body. Validate `date` with `validateClientDate` → `validDate` (or `null`). Collect the string `pantry_item_id`s from `deductions`, and `readExpiryByItemId` **before** forwarding.
2. Forward with **`aiProxyFetch`** (not `aiProxyJson`) to `/v1/meals/cook/confirm`. If it returns a `NextResponse` (401), return it. **Parse the upstream body once**: `const data = await res.json().catch(() => ({}))`.
3. **Award on every 2xx, `already_confirmed` included** (S2), because every ref is keyed on `cooked_on`, which the server fixes at the claim, so the ledger's unique key dedupes a replay:
   - Only when `meal_id` is a string and `data.cooked_on` matches `^\d{4}-\d{2}-\d{2}$`. Otherwise log and award nothing. **Never fall back to the proxy's own date**, which would let a replay across midnight mint a second day.
   - `refs = cookAwardRefs({ kind: 'meal', mealId: meal_id }, data.cooked_on)`.
   - `cook_confirm`: exactly one per meal cook, never one per dish. `meal_bonus`: one.
   - `rescue`: `rescueCandidates(pantryItemIds, expiry, validDate, data.deductions_skipped)`. It excludes refused rows (N4), and the cap of `RESCUE_CAP_PER_COOK` is **for the whole meal**. It's skipped when `validDate` is null, as today.
     - On a replay `deductions_skipped` is `[]`, so a row refused on the first call could earn a rescue on the replay. That's accepted: it needs both a lost response and a row with no derivable base unit.
   - `awardCookBubbles(user.id, refs, rescueIds)`, awaited before responding.
4. Return `NextResponse.json(data, { status: res.status })`. A non-2xx (404, 409 `dish_mismatch`/`confirm_incomplete`, 422, 500) passes through with its body and **no awards**.
5. An award failure never changes the response: `awardBubbles` never throws.

- **`lib/bubbles.ts`:** add `meal_bonus: 10` with the comment `/** Finishing a whole meal — issue #654. PROVISIONAL: tuned once the flow is playable (spec #647, "Further Notes"). */`.
- **Bubble keys follow the spec** ("keyed by the meal and the server's date"): `meal:<id>:<cooked_on>`. A second cook of the same meal on the same UTC day deducts but earns no second `cook_confirm`/`meal_bonus`, matching the per-recipe rule.
- **Clients (`lib/api/meals.ts`):**
  - `requestMealCookProposal(req: MealCookRequest): Promise<MealCookProposal>` posts to `/api/ai/meals/cook`.
  - `confirmMealCook(req: MealCookConfirmRequest): Promise<MealCookConfirmResponse>` posts to `/api/ai/meals/cook/confirm`.
  - On a non-OK response both throw `MealCookError` (S6), defined in `lib/api/meals.ts`:
    ```ts
    export class MealCookError extends Error {
      readonly kind?: MealCookErrorKind
      constructor(message: string, kind?: MealCookErrorKind) { super(message); this.name = 'MealCookError'; this.kind = kind }
    }
    ```
  - **`aiErrorDetail` (S1), new in `lib/api/meals.ts`:**
    ```ts
    async function aiErrorDetail(res: Response, fallback: string): Promise<{ message: string; kind?: MealCookErrorKind }>
    ```
    - It **parses the body once**, with the same message rules as today's `aiErrorMessage` (:114–120): a string `detail` is the message, else `detail.message ?? error ?? "<fallback>: <status>"`.
    - `kind` is `detail.error_kind` when it's one of the three `MealCookErrorKind` values, else `undefined`.
    - `aiErrorMessage(res, fallback)` becomes `(await aiErrorDetail(res, fallback)).message`, so `fetchSideAlternatives` and `expandMealDish` behave exactly as before.
  - The meal cook clients do `const d = await aiErrorDetail(res, '…'); throw new MealCookError(d.message, d.kind)`.
  - **Any other failure** (a network error, a thrown `fetch`, a 500 or 422) surfaces with **no `kind`**, so the sheet shows Retry. There's no ad hoc `fetch` in components.

## 5. The finished screen and the carry-over fix (frontend page wiring, ui-ux components)

### The cook route (`app/meals/[id]/cook/page.tsx`)

- **Restore:** `ensureCookId`, then save when it changed.
  - If the restored session is already finished, the finished screen renders. **Auto-open the sheet the first time `stream.now.kind === 'finished'` on a restored session** (Nit 6), not at restore time, and only when `canDeduct`, once per mount (a ref). Coming back to a finished cook means "finish up". A cook that becomes finished live on this mount (the last Done tapped here) doesn't auto-open: the user taps Mark meal as cooked.
  - The stream is never restarted: a finished session stays finished.
- **The finished screen, `MealCookFinished`** (ui-ux; these props replace `onBackToMeal`):
  ```ts
  { mealTitle: string; skippedDishTitles: string[]; canDeduct: boolean;
    onMarkCooked: () => void; onFinishWithoutPantry: () => void;
    /** @deprecated Build-order shim (S6): an alias for onFinishWithoutPantry, so the #653 page compiles between build steps 1 and 3. Removed by frontend in step 3. */
    onBackToMeal?: () => void }
  ```
  - **The transition (S6):** in build step 1, ui-ux ships the new props but also accepts `onBackToMeal?`. When `onFinishWithoutPantry` is absent it's used in its place, and `onMarkCooked`/`canDeduct` get safe defaults (`canDeduct` false, so only Back to meal renders). So `app/meals/[id]/cook/page.tsx`'s existing `onBackToMeal={handleBackToMeal}` still compiles and behaves as on `main`. In step 3, frontend switches the page to the new props and **deletes** `onBackToMeal` from the component and its test.
  - With `canDeduct`, the primary button is **Mark meal as cooked** and the secondary text button is **Skip pantry update**. With skipped dishes it notes "‹Garlic bread› was skipped, so it won't be taken from your pantry."
  - With `!canDeduct` (every dish skipped), it says "Nothing was cooked, so there's nothing to take from your pantry." and offers only **Back to meal** (`onFinishWithoutPantry`).
- **`onFinishWithoutPantry`:** dismiss `timerIdsToDismiss(session)` through the dock's `dismiss` (N6; defensive, since a finished session has no running records), then `endMealCookSession(id)` → `router.push('/meals/'+id)`. No writes, no bubbles, not marked cooked.
  - *Rejected:* marking the meal cooked without a deduction. That's a hidden write with no reviewed proposal, and it would make "cooked" mean two things.
- **✕ Close keeps the current behaviour:** the session stays active, and the deduction is pending.
  - *Rejected:* ✕ ending the session, which loses the deduction for someone who only wanted to glance at the meal.
- **The sheet state machine:** `closed → loading → review → confirming → success | error`.
  - `loading` calls `requestMealCookProposal(buildMealCookRequest(...))`.
  - **Errors (S6):**
    - A `MealCookError` with no `kind` gives the error state with **Retry**.
    - With `kind === 'dish_mismatch'` the sheet shows "This meal changed while you were cooking, so it can't be taken from your pantry as it was." and **Back to meal**, which invalidates `['meal', id]` and pushes `/meals/`+id **without ending the session**. The meal screen then shows the stale notice (below).
    - With `kind === 'confirm_incomplete'` the sheet shows "Your pantry may be partly updated — check it." and **Back to meal**, which calls `endMealCookSession(id)`, invalidates `['pantry']`, `['meal', id]`, `['meals']` and `['inbox-entries']`, and pushes `/meals/`+id.
    - **With `kind === 'confirm_in_progress'` (S2)** from the confirm, the sheet stays in `confirming`, waits **2 s**, and retries **once** with the same `cook_ref`. A success (or `already_confirmed`) is handled as success. A second `confirm_in_progress` is handled exactly like `confirm_incomplete`: the page passes `errorKind: 'confirm_incomplete'` to the sheet. Any other result is handled as that result. The wait timer is cleared on unmount.
    - **There's never a Retry button for any kind.**
  - **Confirm:**
    0. **`confirmingRef` guard (S2):** `handleConfirm` returns immediately while a `useRef<boolean>` is set. It's set before the first await and cleared only in the error path (success navigates away). A double tap, or a tap landing during the 2 s in-progress wait, can't start a second request, even before React re-renders the disabled button.
    1. The two-tab checkpoint: if `isMealCookSessionEnded(id)`, close and push the meal screen (mirroring `CookModal.tsx`:613).
    2. `confirmMealCook({ meal_id, cook_ref: session.cook_id, recipe_ids: cookedDishIds(...), deductions, date: localDateString() })`.
    3. **On success, `already_confirmed` included:** `endMealCookSession(id)`. Then invalidate `['bubbles']`, `['pantry']`, `['meal', id]`, `['meals']` and `['inbox-entries']` (N6). The sheet goes to `success` ("Pantry updated"), and after 1200 ms it does `router.push('/meals/'+id)`, the same delay as `CookModal.tsx`:633–637. The timer is cleared on unmount.
    4. A Retry after a plain error resends the same `cook_ref`. The server's claim makes that safe: it either succeeds, replays as `already_confirmed`, or answers `confirm_in_progress` (handled as in the errors list) or `confirm_incomplete`.
  - **Double-deduct proof:**
    - The confirm button is disabled while `confirming`, and `confirmingRef` stops a second call before the re-render.
    - `endMealCookSession` then makes the cook route redirect: `getActiveMealCookSession` returns `null` (:215), so a reload, Back or a stale link lands on the meal screen.
    - The server's `last_cook_ref` claim covers a lost response and a second tab.

### The meal screen (`app/meals/[id]/page.tsx`)

- **An active, non-stale, finished session** replaces the Resume banner (:583–611) with a `data-testid="meal-cook-finish-banner"` banner: "Dinner's done! Update your pantry?"
  - **Update pantry** goes to `/meals/[id]/cook`, which auto-opens the sheet.
  - **Skip** dismisses leftover linked timers (`timerIdsToDismiss`) and calls `endMealCookSession`.
- **An unfinished session** keeps "Resume cooking?". **A stale session** keeps the stale notice, and stale wins over finished. The stale notice's copy (:612–630) gains a second sentence (S6): "This meal changed since you started cooking. Your pantry wasn't updated for that cook."
- **Another meal's cook (S5):** when `getActiveMealCookSession()` (no id) returns a session whose `meal_id` isn't this meal, Start cooking (:572–581) doesn't start straight away. It opens an inline confirm under the button: "You haven't finished another meal's cook — starting this one drops it", with:
  - **Start anyway**, which dismisses that session's `timerIdsToDismiss`, then runs `handleStartCooking` (`startMealCookSession` replaces it);
  - **Go to that meal**, which does `router.push('/meals/<other meal_id>')`.
  - A session for this same meal isn't "another meal's". It keeps the existing Resume/finish/stale handling.
- `activeCookSession` (:228) and the new `otherMealCookSession` also depend on a local `sessionTick`, bumped after Skip, so the banner goes away without a reload.

### Components (ui-ux; no new visual language, the final look is Goal 3)

- **`components/recipes/CookReviewBody.tsx`**, extracted from `CookModal.tsx`:809–926: the expired banner, the ingredient table, collapsed staples, and `MissingItemsList`.
  - Props: `{ proposal: CookReviewProposal; overrides; onOverrideChange(key, value); expiredDismissed; onDismissExpired(); sourceNote?: (m: IngredientMatch) => string | null; missingSourceNote?: (name: string) => string | null }`.
  - `sourceNote` renders under the ingredient name, like the substitution note.
  - **`MissingItemsList` gains an optional `sourceNote?: (name: string) => string | null` prop** (N7), rendered under each missing name. `CookReviewBody` passes `missingSourceNote` to it. Without the prop it renders exactly as today.
  - The same file holds `CookDeductionSummary` (the footer text, `CookModal.tsx`:935–979), taking `{ summary, mode }`, and the pieces both bodies need: `summariseDeductions`, `mergeDeduction`, `compoundOverrideKey`, `dedupeByPantryItemId`, `effectiveCompoundOverride`, `MissingItemsList`, `ExpiredIngredientsBanner`, `formatQty`, `statusColor`, `statusLabel`, and the `CookReviewProposal` type. It never imports `CookModal`.
- **`CookModal`** uses both with **no behaviour change**.
  - **It keeps exporting `summariseDeductions`, `MissingItemsList`, `compoundOverrideKey` and `effectiveCompoundOverride`** (and `ExpiredIngredientsBanner`, `dedupeByPantryItemId`) by re-export, so every existing import path works (N7).
  - `summariseDeductions`'s parameter widens to `CookReviewProposal = Pick<CookProposal, 'matches' | 'missing' | 'missing_notes' | 'compound_suggestions' | 'expired_items'>`, a type-only change. `MealCookProposal` is assignable to it.
  - *Rejected:* adding meal props to `CookModal`. It hard-codes `endCookSession(recipeId)`, the `/chat?cooking=` redirect and the draft "add to library" prompt.
- **`components/meal/MealCookSheet.tsx`:** the sheet shell, on the existing sheet and focus-trap pattern.
  - Props: `{ open; mealTitle; state: 'loading'|'review'|'confirming'|'success'|'error'; proposal: MealCookProposal | null; errorMessage?: string; errorKind?: MealCookErrorKind; onConfirm(deductions: DeductionItem[]); onRetry(); onBackToMeal(); onClose() }`.
  - The overrides are internal. It computes `summariseDeductions(proposal, overrides)` and passes `.deductions` to `onConfirm`.
  - In `error`: with `errorKind` set it shows **Back to meal** (`onBackToMeal`) and no Retry; otherwise it shows **Retry** (`onRetry`). The page never hands the sheet `confirm_in_progress`: it waits and retries itself, then maps a second one to `confirm_incomplete`.
  - The **source note** appears only on lines whose `sources` span 2 or more distinct `recipe_id`s: "From Pasta (2 cloves) + Salad (1 clove)", or just the dish names when a source has no quantity. Shared missing items (`missing_sources[name]` with 2 or more ids) get "Needed for Pasta + Salad".
  - The confirm label is **Update pantry**, or **Update anyway** while quantities are unresolved (the same demotion as `CookModal.tsx`:1002–1023).
- **`components/meal/MealCookFinished.tsx`**, with the props above.

## 6. Migration (backend writes it, flagged; the orchestrator applies it)

`supabase/migrations/00015_meals_last_cook_ref.sql`: **additive only.**

```sql
-- Issue #654: server-side idempotency for POST /v1/meals/cook/confirm. The client's
-- MealCookSession.cook_id is sent as cook_ref. The confirm claims it with a
-- conditional UPDATE (status 'claimed') before any deduction, and stamps 'applied'
-- after the deductions and the recipe marks. A replayed ref never deducts twice:
-- 'applied' replays as already_confirmed; 'claimed' under 30 s old (probably still
-- writing) is refused as confirm_in_progress, and older (a confirm that failed
-- partway) as confirm_incomplete.
ALTER TABLE meals ADD COLUMN IF NOT EXISTS last_cook_ref TEXT;
ALTER TABLE meals ADD COLUMN IF NOT EXISTS last_cook_status TEXT
  CHECK (last_cook_status IS NULL OR last_cook_status IN ('claimed', 'applied'));
COMMENT ON COLUMN meals.last_cook_ref IS
  'cook_ref of the most recent meal cook confirm (issue #654). Written only by the AI service confirm route.';
COMMENT ON COLUMN meals.last_cook_status IS
  'claimed = the confirm claimed last_cook_ref and may be mid-write; applied = its deductions and recipe marks finished (issue #654).';
```

- Two nullable columns with no backfill, no index (they're read by primary key) and no RLS change. The existing own-rows policy covers them. The inline `CHECK` only applies when the column is added, and every existing row is `NULL`.
- **The orchestrator pushes it (`supabase db push --linked`) just before the `verify` run**, which is before the merge. The ai-service confirm names both columns, and Railway deploys on merge.
- List the PR in the sprint doc's "schema changes" line.
- *Rejected:* a client-only guard (the #440 pattern). It can't see a lost response and retry on kitchen wifi, or a second tab that loaded before the first confirmed.
- *Rejected:* a `meal_cooks` table (§2c).

## 7. Ownership

| Role | Owns |
|---|---|
| **backend** | `models/cook.py` (the §2 models, `MealCookClaim`); `services/meal_cook.py` (`match_meal_with_llm`, `merge_meal_matches`, `correlate_expired`, `apply_collapsed_deductions`); `api/routes/meals_ai.py` (the two routes); `recipes_ai.py` (switched to the shared helpers, behaviour unchanged); `supabase_repo.py` (`claim_meal_cook`, `mark_meal_cook_applied`, the `recipe_id` key on `get_meal_with_dishes`); migration 00015; the ai-service tests, including the fake-chain repo tests (S4) |
| **frontend** | `types/meals.ts` (§2d, build step 0); `app/api/ai/meals/cook/route.ts`, `app/api/ai/meals/cook/confirm/route.ts`; `lib/cook-awards.ts` (and the switch-over in the recipe confirm proxy); `lib/bubbles.ts` (`meal_bonus`); `lib/api/meals.ts` (clients, `MealCookError`, `aiErrorDetail`, with `aiErrorMessage` delegating to it); `lib/meal-cook-session.ts` (`cook_id`, `ensureCookId`, `DishAmendment`, `readDishAmendment`); `lib/meal-cook-deduction.ts`; `lib/meal-cook-stream.ts` (`isMealCookFinished`); `app/meals/[id]/cook/page.tsx`, `app/meals/[id]/page.tsx`; the Next.js lib, route and page tests; the `verify` run |
| **ui-ux** | `components/recipes/CookReviewBody.tsx` + `CookDeductionSummary` (extracted, with `CookModal` switched over and re-exporting); `MissingItemsList`'s `sourceNote`; `components/meal/MealCookSheet.tsx`; `components/meal/MealCookFinished.tsx`; the component tests |

**Where it's built (S7):** after issue #651's PR A (*Predictive pills and meal entry points*, the starter/predicted pills slice) has merged, in the **shared worktree** (`.claude/worktrees/state-check-cb0ff6`) on a **fresh branch off `main`**: `feat/issue-654-a-meal-deduction`. A separate worktree isn't possible, because the desktop app blocks writes to other worktrees. So this work has to wait for #651's branch to be off the worktree, not run beside it. Re-check §0's line numbers by symbol on that `main`: #651 shifts `supabase_repo.py`.

Build order:
0. **Frontend commits `types/meals.ts` (§2d) first, type-only.** ui-ux branches its work from that commit.
1. Backend, and ui-ux in parallel. ui-ux's `MealCookFinished` keeps the optional `onBackToMeal` alias (S6, §5), so the unchanged page still compiles.
2. Frontend: lib, clients and proxies.
3. Frontend page wiring last, **removing the `onBackToMeal` alias** from `MealCookFinished` and its test.
4. The orchestrator runs `supabase db push --linked` (§6).
5. `verify`.

## 8. Acceptance criteria and tests

**Backend** (`ai-service/tests/test_issue_654_meal_cook.py`; `pytest`, `ruff check bubbly_chef/`, and `./scripts/mypy_gate.sh` with 0 new errors):
- `merge_meal_matches`, as pure unit tests:
  - a shared ingredient is summed into one line whose `sources` are in dish order;
  - two individually `ready` parts become a `shortfall` with the right `shortfall` and `deduct_qty = available`;
  - a per-dish shortfall source plus a ready source whose total equals `available` within 1e-4 is **not** a shortfall;
  - a short substitute (`status="shortfall"`, `match_type="substitute"`) merged with a ready substitute gives `match_type="substitute"`;
  - mixed recipe units leave `ingredient_qty`/`unit` as `None` and still sum the base quantity;
  - `unit_conflict` stays its own line kind, and its `base_unit` is the first source's;
  - staples merge by name;
  - `missing` is unioned, with `missing_sources`;
  - **`missing_notes` is re-keyed to the kept spelling** ("Heavy cream" kept from the main, the note from the side's "heavy cream") (Nit 1);
  - compound suggestions are de-duplicated by `_normalize_ingredient_name`, not just case ("cream" and "Cream " collapse), and the kept one's `ingredient_name` is the kept `missing` spelling (Nit 1);
  - the same input gives identical output.
- `POST /v1/meals/cook`:
  - summing across dishes per pantry item;
  - shortfall after summing;
  - **servings scaling (fallback):** no list, recipe servings 4, `servings` 2 halves an object's quantity *and* a string's parsed quantity;
  - **`string_scale` (S3):** a supplied `"2 cloves garlic"` with `string_scale = 4 / 2` gives a line with `ingredient_qty == 4.0`, `ingredient_unit == "cloves"`, and `deduct_qty` twice the `string_scale = 1` case. Recipe servings 2 and meal servings 4 deduct for four;
  - supplied objects are used verbatim (never rescaled), and a blank-name object is dropped (N2);
  - with `string_scale = 1`, a string's parsed quantity is passed unrounded (`"0.333 cup milk"` stays `0.333`) (Nit 2);
  - **an amended list overrides the DB:** an ingredient only in the DB row is absent, the supplied one is matched, and `ingredients_source == "supplied"`;
  - two dishes with unplaced names make exactly **one** alias model call (a stub at `AIManager`). The test clears `_alias_cache` (`cook_matcher.py`:84) itself as well as relying on the conftest fixture, so it can't pass on a cache hit (N10);
  - 404 for an unknown meal, 409 `dish_mismatch` for a foreign recipe id, 409 `dish_mismatch` for a dish whose recipe came back `{}`, and 422 for duplicate ids;
  - `expired_items` is emitted once per pantry item.
- `get_meal_with_dishes` returns `recipe_id` on every dish dict (N1).
- **Repo tests for the claim (S4)**, in `tests/test_issue_654_meal_cook_repo.py`, with a fake Supabase chain that records each call (`table`, `select`, the `update` payload, every `eq`/`or_` argument) and returns scripted `data`:
  - **the `.or_` filter string** is exactly `"last_cook_ref.is.null,last_cook_ref.neq.<cook_ref>"`, alongside `.eq("id", meal_id)` and `.eq("user_id", user_id)`;
  - **claimed:** the read returns another ref and the update returns one row → `outcome == "claimed"`, `times_cooked == n + 1`, `cooked_on == today (UTC)`, and the payload has `last_cook_status: "claimed"`;
  - **zero rows, then `replay_applied`:** the update returns `[]`, and the re-read shows `last_cook_ref == cook_ref` with `'applied'`;
  - **zero rows, then no row → `None`:** the update returns `[]`, and the re-read returns nothing;
  - a matching ref with `'claimed'` and `last_cooked_at` 5 s old → `replay_in_progress`, and 60 s old → `replay_claimed` (a clock injected, or `now` patched);
  - **`mark_meal_cook_applied`** sends `{last_cook_status: "applied"}` filtered by `.eq("id")`, `.eq("user_id")` **and `.eq("last_cook_ref", cook_ref)`**.
- `POST /v1/meals/cook/confirm`:
  - it deducts once per pantry item across dishes, with duplicates collapsed;
  - `update_recipe_cooked` is called for every `recipe_ids` entry;
  - the claim sets `times_cooked` +1, `last_cooked_at`, `last_cook_ref` and `last_cook_status='claimed'`, and the end state is `'applied'`;
  - `cooked_on` is the UTC date of the claim's `last_cooked_at`;
  - **a replay with status `'applied'`** returns `already_confirmed: true` and the same `cooked_on`, with no deduct, mark or update calls;
  - **a replay with status `'claimed'` under 30 s old** returns 409 `confirm_in_progress`, and **older** returns 409 `confirm_incomplete`, both with no writes (S2);
  - **a replay after a dish was swapped** (the meal row's `last_cook_ref == cook_ref`, and a `recipe_ids` entry no longer a member) is classified by the claim (`already_confirmed: true` for `'applied'`), not 409 `dish_mismatch` (S3);
  - `apply_collapsed_deductions` raising partway logs the already-applied ids, then re-raises (Nit 5);
  - a failure injected after the claim (in `deduct_pantry_item`) returns 500 and leaves the status `'claimed'`;
  - a new `cook_ref` deducts again;
  - an empty `deductions` still marks everything cooked;
  - `is_draft` is never in any update payload;
  - a bad `cook_ref` charset is a 422, and 409 `dish_mismatch` happens before any claim.
- The existing `test_cook_routes.py` and `test_cook_matcher.py` pass unchanged after the helper extraction.

**Frontend** (`npx tsc --noEmit`; vitest):
- `meal-cook-confirm-route.test.ts`, following `cook-confirm-route.test.ts` and `bubbles-award-call-sites.test.ts`:
  - one `cook_confirm` and one `meal_bonus`, both `meal:<id>:<cooked_on>`, where the test's `cooked_on` differs from the server's today;
  - rescue awards de-duplicated, capped at 3 across dishes, keyed `<pantry_item_id>:<cooked_on>`, and excluding `deductions_skipped` ids;
  - `already_confirmed: true` awards again with the **same** refs;
  - a 2xx with no valid `cooked_on` awards nothing;
  - an award failure still returns the upstream 200 body;
  - a non-2xx (409 `confirm_incomplete`) is passed through with its body and status, and no awards;
  - a missing `date` still awards `cook_confirm` and `meal_bonus`, with no rescue;
  - the upstream body is read once.
- `cook-awards.test.ts`: `cookAwardRefs` for both subjects, and `rescueCandidates`' de-dupe, exclude and cap.
- `cook-confirm-route.test.ts` passes **unchanged**.
- `meals-ai-proxy-routes.test.ts`: `/api/ai/meals/cook` passes status and body through.
- `BUBBLE_AMOUNTS.meal_bonus === 10`.
- `meal-cook-session.test.ts`:
  - a new session has a UUID `cook_id`;
  - a #653-shaped session with no `cook_id` restores, and `ensureCookId` gives `legacy-<started_at_ms>` deterministically (two calls on two reads agree);
  - a `cook_id` outside the charset is replaced;
  - a well-formed amendment seeded into storage is returned by `readDishAmendment` after a fresh read;
  - a malformed amendment gives `null`, and the session still restores.
- `meal-cook-deduction.test.ts`:
  - a seeded amended dish uses its amendment;
  - an amendment at servings 2 is rescaled for meal servings 4;
  - an unamended object ingredient is scaled, and a string stays a string with the right `string_scale`;
  - an all-skipped dish is excluded;
  - a zero-step dish counts as cooked (S9);
  - no cooked dish gives `null`;
  - `isMealCookFinished` agrees with `deriveStream`'s `finished`, including zero steps overall being unfinished.
- **`meals-api.test.ts` (new file, Nit 4):**
  - `aiErrorDetail` reads the body once (a `Response` whose body can only be consumed once still yields message and kind);
  - `MealCookError.kind` comes from `detail.error_kind` for each of the three kinds;
  - an unknown `error_kind`, a string `detail`, a 500 with no JSON, and a network rejection all give no `kind`;
  - `fetchSideAlternatives`' error message is unchanged (`aiErrorMessage` now delegates) (S1).
- `meal-cook-page.test.tsx`. **This replaces the test at :436** ("shows the finished screen once every step is done, and Back to meal ends the session"), whose behaviour this PR deliberately reverses:
  - "Mark meal as cooked" requests a proposal with each cooked dish's list and `string_scale`, and without the all-skipped dish;
  - confirm ends the session, invalidates `['bubbles']`, `['pantry']`, `['meal', id]`, `['meals']` and `['inbox-entries']`, navigates after 1200 ms, and a remount then redirects;
  - ✕ Close on the finished screen doesn't end the session;
  - restoring a finished session shows the finished screen with the sheet open, and no Now card. The sheet opens on the first render where `stream.now.kind === 'finished'`, and not before it (Nit 6);
  - finishing live on this mount (the last Done) shows the finished screen with the sheet **closed**;
  - `confirm_in_progress` then success: one retry after 2 s (fake timers) with the same `cook_ref`, then the success path;
  - `confirm_in_progress` twice: the sheet shows the `confirm_incomplete` state (Back to meal, no Retry), with exactly two confirm calls in total;
  - a double tap on Update pantry sends one confirm (`confirmingRef`) (S2);
  - a meal-cook proposal request with a nameless object and a `NaN` quantity in a dish's recipe row sends the nameless object dropped and the quantity as `null`, and a 120-element list is sent as 100 (S5);
  - Skip pantry update ends the session with no network call;
  - `confirm_incomplete` shows Back to meal with no Retry, and it ends the session;
  - `dish_mismatch` shows Back to meal, which doesn't end the session;
  - the two-tab checkpoint closes the sheet when the meal was ended elsewhere.
- `meal-screen.test.tsx`:
  - a finished pending session shows "Update pantry" and not "Resume";
  - Skip ends the session and brings back Start cooking;
  - stale wins over finished, and the stale notice includes "Your pantry wasn't updated for that cook.";
  - **S5:** with another meal's active session, Start cooking shows the inline confirm; **Start anyway** starts this meal's session and navigates; **Go to that meal** navigates to `/meals/<other>` and starts nothing.

**ui-ux:**
- `meal-cook-sheet.test.tsx`, the **combined sheet**:
  - the summed shared line with its source note;
  - no note on a single-dish line;
  - "Needed for …" on a shared missing item;
  - staples collapsed;
  - a `unit_conflict` input feeding `onConfirm`'s deductions;
  - loading, error with Retry, and error with `errorKind` showing Back to meal and no Retry;
  - success;
  - confirm disabled while confirming;
  - "Update anyway" while unresolved.
- `meal-cook-finished.test.tsx` (updated): both actions, the skipped-dish note, `canDeduct = false`. In step 1 it also covers the `onBackToMeal` alias (used when `onFinishWithoutPantry` is absent). Frontend deletes that case with the alias in step 3 (S6).
- **These pass unmodified** (N7): `cook-flow-redesign.test.tsx`, `chat-cook-two-tab-guard.test.tsx`, `assumed-staples.test.tsx` and `cook-session-teardown.test.tsx`. `MissingItemsList` without `sourceNote` renders exactly as before.

**`verify` (frontend, after the migration push; screenshots in the PR body as absolute `blob/<sha>/…?raw=true` URLs):**
1. Cook a meal whose two dishes share an ingredient. Use a meal servings count different from the recipes', and a string ingredient on one dish.
2. Finish, and show the combined sheet with the summed shared line and its source note. The string ingredient's quantity is scaled to the meal.
3. Confirm. Show the pantry deducted once, both recipes' and the meal's `times_cooked`/`last_cooked_at`, and the "+N" pop showing cook plus bonus plus any rescues.
4. Show that Back or reloading `/meals/[id]/cook` lands on the meal screen with no banner.
5. The ✕-Close-on-finished path: the banner reads "Dinner's done! Update your pantry?", and **Update pantry** reopens the sheet. Then the same path with **Skip**: the banner goes away, and nothing is deducted.
6. A cook with one dish fully skipped: the finished screen names it, and it's absent from the sheet and not marked cooked.
7. With a second meal's cook left active, Start cooking on the first meal shows the "another meal's cook" confirm.

## 9. Reversible product calls (log each in the sprint doc)

1. **New `/v1/meals/cook*` routes.** Rejected: a wrapper on the recipe cook routes, or a merge in the browser (§1).
2. **One alias call, deterministic per-dish passes, then a merge.** Rejected: one pass over a concatenated list, which loses the per-dish attribution the matcher can't carry; and a model call per dish, which is three times the latency.
3. **The merge key is pantry item × line kind.** Rejected: strictly one line per pantry item (§2b).
4. **Objects travel at meal scale; strings travel at recipe scale with a `string_scale` the server applies after parsing** (S3; spec issue #647 story 59, "cooking for four deducts for four"). Rejected: leaving strings unscaled, which under-deducts every string-ingredient dish cooked for more people than the recipe serves; and parsing strings in TypeScript, which would duplicate `_parse_ingredient_string` and drift from it.
5. **An all-skipped dish (≥1 step, all skipped) isn't cooked; a zero-step dish is; partial skips don't count** (S9). Rejected: ignoring skips, or inferring from step text.
6. **Idempotency is two nullable columns on `meals` (`last_cook_ref`, `last_cook_status`), claim first** (S2). Rejected: a `meal_cooks` table, a client-only guard, or deduct-then-claim. Accepted limitation: only the latest ref is remembered (N8).
7. **A half-finished confirm (`confirm_incomplete`) ends with Back to meal and a "check your pantry" message, never a Retry.** A claim under 30 s old is `confirm_in_progress` instead, and the sheet waits 2 s and retries once (S2). Rejected: a Retry button, which can't tell what already landed; and treating every `'claimed'` replay as incomplete, which shows a fresh double-send (a slow first post still writing) as a failure.
8. **Award keys use the server's `cooked_on` from the claim, and every 2xx awards, `already_confirmed` included; the ledger dedupes.** This replaces the earlier "no awards on `already_confirmed`" call. Rejected: skipping awards on a replay, which loses them when the first response was lost after the deduction; and keying on the proxy's own date, which a replay across midnight defeats.
9. **Rescue excludes rows the confirm refused** (N4). Rejected: rescuing on the request's ids, which pays for an item the pantry never lost.
10. **✕ Close leaves a finished cook pending; the banner offers Update pantry / Skip.** Rejected: ✕ ending the session.
11. **Skip pantry update writes nothing, including not marking it cooked.** Rejected: marking it cooked without a deduction.
12. **Returning to a finished cook auto-opens the sheet.** Rejected: an extra tap, or a `?sheet=` query parameter.
13. **Starting a cook while another meal's cook is active asks first** (S5). Rejected: silently replacing it (today's behaviour), or blocking the new cook.
14. **`dish_mismatch` sends you back to the meal without ending the session,** so the meal screen's stale notice explains it. Rejected: a Retry, which can't succeed against a changed meal; and ending the session, which hides why nothing was deducted.
15. **Pre-#654 sessions get a deterministic `legacy-<started_at_ms>` cook id** (N5). Rejected: a random id, which two tabs would mint differently.
16. **The amendment slot is typed `Record<string, unknown>` and read only through `readDishAmendment`.** Rejected: typing it `Record<string, DishAmendment>`, which claims a shape the "is an object" guard never checked.
17. **Extract `CookReviewBody`/`CookDeductionSummary`, with `CookModal` re-exporting.** Rejected: adding meal props to `CookModal`.
18. **The source note only on lines shared by 2 or more dishes.** Rejected: a note on every line, which is noise on a mostly single-dish sheet.

Carried over unchanged: the banner copy "Dinner's done! Update your pantry?"; `meal_bonus` of 10, keyed `meal:<id>:<date>` (the date is now `cooked_on`); the migration is pushed with `supabase db push --linked` just before `verify`.

## 10. Out of scope

- **Mid-cook amendments** (Ask Bubbles on the Now card, applying an amendment, and the router changes). PR B does these, and closes issue #654. This PR only reads the slot.
- **Single-recipe amendments.** Issue #489 (*Spec A.1 — Applied amendment must reach the deduction and the pinned recipe*, open) and issue #490 (*Spec A.2 — An applied amendment is lost on page reload mid-cook*, open) stay open.
- **Cross-row summing for duplicate pantry rows.** Issue #127 (*Cook flow: duplicate pantry rows under-report available stock*) is closed, but the `cook_matcher.py`:630–640 limitation remains, and a meal can over-report a shortfall with two rows of one item.
- **Unit conversion beyond the normalizer's base units.** Issue #6 (*Unit conversion system*) is closed. A cross-dimension pair stays `unit_conflict`.
- **Editing or removing lines on the sheet.** The single-recipe sheet doesn't do it either. Compound substitutions stay opt-in (the rules of issue #284, *deduct compound substitutions*, closed, unchanged).
- **The same meal cooked on two devices at once.** Each device has its own `cook_id`, so both deduct. `times_cooked`'s read-then-write can also lose one increment in that race.
- **A replay of an older ref after a newer cook of the same meal** (N8, §2c).
- **The final visual design** (Goal 3), a Playwright meal-cook e2e, the meal cook proposal in chat envelopes, and any change to timers or the scheduler.

## 11. Needs the human

None. Nothing here changes v1 scope or costs money. The `meal_bonus` amount of 10 is the spec's own provisional value. The migration is additive, and the orchestrator pushes it.

## §R Review 1 resolutions

| Finding | Where applied | Decision |
|---|---|---|
| B1 | Not in this PR | Stream-path amendment detection is PR B (router change 2). |
| S1 | §2d, §7 build step 0 | TS mirrors written out verbatim in `types/meals.ts`, committed type-only first; `lib/meal-cook-session.ts` imports `MealCookIngredient`; ui-ux starts from that commit. `RecipeAmendmentProposal` is PR B's. |
| S2 | §2c, §4, §5, §6, §9.6–8 | Columns option: `meals.last_cook_ref` + `meals.last_cook_status` (`claimed`/`applied`). The claim writes `claimed`, the confirm `applied`. An `applied` replay → `already_confirmed`; a `claimed` replay → 409 `confirm_incomplete`, Back to meal, no Retry. `cooked_on` returned; awards keyed on it and made on every 2xx. `meal_cooks` table rejected; N8 accepted. |
| S3 | §2a, §2d, §3, §8, §9.4 | `string_scale` (default 1.0, >0, ≤100); strings parsed and scaled server-side, objects verbatim; the fallback scales strings too; the garlic test added. Client sets `string_scale = mealServings / recipeServings`. |
| S4 | Not in this PR | The narrowed pin rule is PR B. |
| S5 | §5 meal screen, §8, §9.13 | Inline confirm with Start anyway / Go to that meal, plus `meal-screen.test.tsx` cases. Start anyway also dismisses the other session's running timers. |
| S6 | §4 clients, §5, §8 | Stale notice gains "Your pantry wasn't updated for that cook."; `MealCookError {message; kind?}`; the sheet's `errorKind` prop; Back to meal instead of Retry on both kinds. Added: `dish_mismatch` doesn't end the session (§9.14). |
| S7 | §4 confirm proxy | `aiProxyFetch`, parse once, award per S2, `NextResponse.json(data, {status})`; the recipe proxy keeps `aiProxyJson`. |
| S8 | §0, §4 `lib/cook-awards.ts` | PR #595 named; `cookAwardRefs` is the one keying function; merge order spelled out for both orders. |
| S9 | §3, §8, §9.5 | Not cooked only with ≥1 step all skipped; zero-step is cooked; `isMealCookFinished` keeps the non-empty guard. |
| N1 | §2a, §8 | `get_meal_with_dishes` dish dicts gain `recipe_id`; membership built from it; `recipe: {}` isn't a member (409). |
| N2 | §2a, §2d | `name` is plain `str`; blank names dropped server-side; the comment now says RecipeIngredient minus `preparation`, plus `notes`. |
| N3 | §0, §2b, §8 | "Substitute" defined as `match_type == "substitute"`; 1e-4 tolerance; `base_unit` caveat on merged `unit_conflict` lines. |
| N4 | §4 confirm proxy, §9.9 | Rescue excludes `deductions_skipped`; the replay edge is documented. |
| N5 | §3, §9.15 | Deterministic `legacy-${started_at_ms}` cook id. The pin/stacking/stepN parts are PR B. |
| N6 | §2c, §5 | `['inbox-entries']` invalidated; Skip pantry update dismisses `timerIdsToDismiss` (defensive: empty for a finished session); a draft meal isn't promoted. |
| N7 | §5 components, §8 | CookModal re-exports the four names; `assumed-staples.test.tsx` and `cook-session-teardown.test.tsx` added to the unmodified list; `MissingItemsList` gains optional `sourceNote`. |
| N8 | §2c, §10 | Single-slot replay accepted and documented. |
| N9 | Not in this PR | PR #617 is named in PR B's §0. It touches none of this PR's files; it edits `cook-session-teardown.test.tsx`, which this PR requires unmodified, not unchanged-from-today. |
| N10 | §0, §8 | `_alias_cache` is at `cook_matcher.py`:84 (not :71); the conftest autouse fixture already clears it, and the alias test clears it explicitly too. |
| Drift | §0 | Corrected: CookModal redirect delay `:633–637`; review footer `:935–979`; confirm label `:1002–1023`; expiry block `:228–248`; `deriveStream` check `:445–448`; `BubblePop` `:57–62`; proposal unions `:330`/`:345`; `get_meal_with_dishes` doesn't return `recipe_id` today. |

## §R2 Review 2 resolutions

| Finding | Where applied | Decision |
|---|---|---|
| S1 | §4 clients, §7, §8 `meals-api.test.ts` | `aiErrorDetail(res, fallback) → {message; kind?}` parses the body once; `aiErrorMessage` delegates to it; the meal clients throw `new MealCookError(d.message, d.kind)`; any other failure has no kind, so the sheet shows Retry. |
| S2 | §2c, §2d, §5, §6, §8, §9.7 | `claim_meal_cook` returns `replay_in_progress` for `'claimed'` under 30 s old → 409 `confirm_in_progress`. It's added to `MealCookErrorKind` (§2d, step 0). The sheet waits 2 s and retries once with the same `cook_ref`; a second one is handled as `confirm_incomplete`. `handleConfirm` is guarded by `confirmingRef`. |
| S3 | §2c step 1, §8 | When the meal row's `last_cook_ref == cook_ref`, the membership check is skipped and the claim classifies the replay. |
| S4 | §8 repo tests, §7 | Fake-chain tests: the exact `.or_` string; claimed; zero rows → `replay_applied`; zero rows → no row → `None`; the 30 s boundary; `mark_meal_cook_applied` filters on `last_cook_ref`. |
| S5 | §3 `cookedIngredientsForDish`, §8 | Keeps strings and objects with a non-blank string `name`; a non-finite `quantity` → `null`; at most 100 elements. Tested with a nameless object and a NaN quantity (and a 120-element list). |
| S6 | §5 `MealCookFinished`, §7 build order, §8 | `onBackToMeal?` kept as an optional alias in step 1 so the unchanged page compiles; frontend removes it in step 3. |
| S7 | §7 | Built after issue #651 PR A merges, in the shared worktree, on a fresh `feat/issue-654-a-meal-deduction` off `main`. A separate worktree isn't possible: the desktop app blocks writes to other worktrees. |
| Nit 1 | §2b, §8 | `missing_notes` re-keyed to the kept spelling; compound suggestions de-duplicated by `_normalize_ingredient_name`. Added: the kept suggestion's `ingredient_name` is rewritten to the kept spelling, so the sheet's lookup and override keys agree. |
| Nit 2 | §2a, §3, §8 | Rounding only when the scale factor isn't 1, server- and client-side. |
| Nit 4 | §8 | `meals-api.test.ts` is a new file. |
| Nit 5 | §2c step 6.1, §8 | `apply_collapsed_deductions` logs the applied (and skipped) ids, then re-raises unchanged. |
| Nit 6 | §5 restore, §8 | The sheet auto-opens the first time `stream.now.kind === 'finished'` on a restored session, not at restore time. A live finish doesn't auto-open. |
| PR #595 order | §4 | Decision: this PR lands first; PR #595 rebases onto `lib/cook-awards.ts` afterwards. The rebase's scope is spelled out. |
| S8–S10, Nit 3, Nit 7 | Not in this PR | PR B's findings (the envelope typing, the test harness, verify, the non-streaming path, null-servings scaling). |
