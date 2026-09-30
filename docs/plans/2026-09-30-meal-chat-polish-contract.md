# Meal and chat polish: seven small bugs and one wording fix, the contract

One PR fixes seven small open bugs and one unfiled wording bug. The PR body carries these lines, each on its own line:

```
Fixes #667
Fixes #662
Fixes #665
Fixes #408
Fixes #669
Fixes #671
Fixes #672
```

- **Issue #667**, *Different ideas can repeat an earlier option set after two taps* (open). The "Already suggested" prompt block lists only the last option set, so a third tap can bring back the first set.
- **Issue #662**, *Saved lookup and cuisine hint include draft recipes* (open). `get_user_recipes` has no draft filter, so the saved lookup and the dashboard suggestion can show recipes the user never saved. The cuisine-hint half was fixed by PR #666; only the `get_user_recipes` half is left.
- **Issue #665**, *Chat pills are announced as toggle buttons* (open). `Chip` puts `aria-pressed` on every clickable chip, so screen readers call one-shot send pills "toggle button, not pressed".
- **Issue #544** (*Chat refine ignores the user's stored dietary preferences*) **moved out** to its own contract, `2026-09-30-issue-544-refine-diet-contract.md` (R3).
- **Issue #408**, *Recipe brainstorm defaults to "snack ideas" when no dish type is given* (open). The time-of-day default writes `meal_type: snack` at 14:00–17:00 and after 21:00, and it's saved and inherited next turn. The generation-downgrade half landed in PR #436.
- **Issue #669**, *Editing a pantry item's amount leaves quantity_base stale* (open). The next cook deducts from the old amount.
- **Issue #671**, *Single-recipe cook confirm awards the rescue bonus for items the server refused* (open). The meal proxy already excludes refused items; the single-recipe proxy doesn't.
- **Issue #672**, *Ask Bubbles overlay doesn't scroll a new amendment card into view* (open). At 375px, **Use this change** / **Keep original** can sit below the fold.
- **Unfiled (a):** under a fixed main (make-it-a-meal, PR #673), **Different ideas** sends "Show me different meal options", but it can only return new sides for the same main.

The slices: **backend** owns `ai-service/`; **frontend** owns `nextjs/src/app`, `lib` and `types`; **ui-ux** owns `nextjs/src/components`. Every line below was checked on `origin/main` at `94c0a84`. Re-locate by symbol if anything lands first.

**Branch:** `fix/issue-667-meal-chat-polish`, off current `main`. **Not held behind PR C** (issue #651 PR C, *the meal-again lookup*, contract `2026-09-30-issue-651-c-meal-again-contract.md`), which hasn't started and is blocked on a Gemini fixture capture. Either order works, and whichever PR lands second rebases (§11). Copy this file to `docs/plans/2026-09-30-meal-chat-polish-contract.md` in the PR.

## 0. What exists (origin/main `94c0a84`)

### Issue #667
- `prompts/meal.py:234-238` `MEAL_OPTIONS_PREVIOUS_BLOCK`: "Already suggested in this conversation: {options}. …"
- `workflows/meal/nodes.py`:
  - `_retained_meal_plan_state` (261-274) reads `session.metadata.meal_plan`.
  - `meal_options_stage` (777): `retained_state` is set only on a `meal_followup` turn without a fresh fixed main (804).
  - `previous_block` (892-899) formats **only `retained_state.options`**, the previous turn's three.
  - The new `MealPlanSessionState` (1013-1018) holds only this turn's options.
- `models/meal.py:289-303` `MealPlanSessionState`: `options`, `servings`, `constraints`, `fixed_main`. Every field has a default, so an old retained session still validates.
- `workflows/router.py:1396-1405` replaces `session.metadata.meal_plan` wholesale on every options turn.
- **Tests that read the block's text** (there's no recorded LLM fixture for it; only the classifier has recorded fixtures):
  - `test_issue_651_meal_pills.py:835` asserts `MEAL_OPTIONS_PREVIOUS_BLOCK.split("{options}")[0] in prompt_used`, and 842 looks for "Already suggested";
  - :995 and `test_issue_651_make_it_a_meal.py:476` assert it's absent.

### Issue #662
- `repository/supabase_repo.py:528-550` `get_user_recipes`: `.eq("user_id")`, ordered by `created_at` desc, **no `is_draft` filter**. Its three callers:
  - `search_saved_recipes`' candidate pool (692);
  - the lookup's browse branch (`workflows/chat/nodes.py:399`);
  - the dashboard daily suggestion (`services/dashboard_service.py:360`).
- The precedent filter is `.eq("is_draft", False)`: `get_recent_cuisines` (576, 586), the library's `GET /api/recipes` (`app/api/recipes/route.ts:88-92`) and `starter-context` (121-139). `recipes.is_draft` is `BOOLEAN DEFAULT false` and nullable (`00001_initial_schema.sql:68`).
- **Test fakes.** `_FakeQuery.execute` in `test_issue_493_saved_recipe_search.py:23-53` and in `test_issue_542_exact_title_match.py` (104+) applies every `eq` as `row.get(k) == v`. **No fixture row has an `is_draft` key**, so adding the filter as-is would empty both suites.

### Issue #665
- `components/ui/Chip.tsx:88`: `aria-pressed={selected}` on every clickable chip. `selected` (61) also drives the visual (74-77).
- The clickable call sites:
  - one-shot actions: `PostMessageChips` (81, 106), `HeaderQuickSetTimers` (49), `EmptyState` (89) and the cooking suggestions (`app/chat/page.tsx:859`);
  - real multi-select toggles: `ClarificationCard` (72-79) and `PantryProposalCard` (291-298). These show their state by `tone` and an `ariaLabel` of "Select X" / "Deselect X", **not by `selected`**, so today they announce "not pressed" even when selected;
  - demo toggles: `app/chip-demo/page.tsx` (85-91, 123-130), which do use `selected`.
- No test asserts `aria-pressed` on a Chip.

### Issue #408
- `workflows/recipe/nodes.py`:
  - `_default_meal_type` (658-665) wraps `meal_time_bucket` (`domain/mealtime.py:27`), which returns `snack` from 14:00 to 17:00 and `late-night snack` from 21:00 to 05:00;
  - it's called in `extract_recipe_constraints` (878-881, after the prior merge, so the default is saved and inherited through `_merge_constraints`) and in `brainstorm_recipe_ideas` (982-988, citing #248);
  - the brainstorm constraints line is at 1085 (`Meal type: …`).
- `prompts/recipe.py:59-60` and `84-85`: "if meal_type is specified, every idea must fit that meal". Nothing covers the unset case.
- `workflows/meal/nodes.py` comments at 199, 282-285 and 830 explain `_state_with_recipe_constraints` in terms of "the default fill-in". The meal options stage reads `constraints["meal_type"]` (403-404), so a "plan a meal" at 15:00 is "Meal type: snack" today.
- **Tests that pin the default:**
  - `test_must_use_ingredients.py:325-345` (`_default_meal_type() in prompt`);
  - `test_mealtime.py:41-57` (the delegation test);
  - `test_issue_651_meal_pills.py:1065` (patches `_default_meal_type`).
- **Docstrings that name `_default_meal_type`:** `domain/mealtime.py:5-7`, `services/dashboard_ranking.py:36`, `test_dashboard_ranking.py:94` and `test_mealtime.py:5`. The dashboard itself uses `meal_time_bucket` directly, and that stays.
- The triage decision (signed off by Ayush, 2026-09-23): no meal type named means **neutral, any dish**, replacing the time-of-day default; only a meal type **the user named** carries into the next turn; #248 (breakfast at midnight) must not come back.

### Issue #669
- `app/api/pantry/[id]/route.ts:27-73` `PUT` copies `quantity` and `unit` (47-48) and never touches `quantity_base`/`unit_base`.
- `POST` (`app/api/pantry/route.ts:60-68`) calls `normalizeBaseUnit` (`lib/api/ai-proxy.ts:136-166`). That call is best-effort and returns `{null, null}` on any failure.
- The only UI caller is `AddItemModal.tsx:107-113` via `updatePantryItem` (`lib/api/pantry.ts:144`). It **always** sends `name`, `quantity`, `unit` and `category` (plus `expiry_date`).
- **A null base is safe.** Cook time derives a missing base from `(quantity, unit)`: `deduct_pantry_item` at `supabase_repo.py:855-868`, and the matcher at `cook_matcher.py:745-754`. It refuses the row only when no base can be derived (885-895). A **stale** base is the only wrong state.
- `pantry-id-route.test.ts:24-53` mocks only `from().update()…`. Its test at 93-101 sends `{ quantity: 2 }`. The file doesn't mock `@/lib/api/ai-proxy`.

### Issue #671
- `app/api/ai/recipes/cook/confirm/route.ts`: `aiProxyJson` (32) returns a `NextResponse`, which is returned as-is (63). `rescueCandidates(pantryItemIds, expiryByItemId, validDate)` (57) has **no exclude list**.
- The meal proxy (`app/api/ai/meals/cook/confirm/route.ts:74-80`) filters `deductions_skipped` to strings and passes them as `rescueCandidates`' 4th argument (`lib/cook-awards.ts:94-114`, `excludeIds`).
- The test mocks (`cook-confirm-route.test.ts:33-35`, `bubbles-award-call-sites.test.ts:45`) resolve plain `Response`s.

### Issue #672
- `components/cook/AskBubblesOverlay.tsx`: the thread is `flex-1 overflow-y-auto … min-h-0` (368) with no ref. The dialog is capped at `maxHeight: 75vh` (352).
- `handleSend` appends the assistant turn (with an optional `amendment`) in the stream's done callback (266-297).
- `AmendmentCard` (77-182) focuses only its *resolved* state (102-105). Only the latest card is actionable (335-339).
- The overlay is mounted by `GuidedCookFlow` (39) and the meal cook page (15). Repo precedent: `CompactMealCard.tsx:59` uses `scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })`, and `app/pantry/page.tsx:131` uses framer-motion's `useReducedMotion`.

### Item (a)
- `lib/chat-chips.ts` options stage (174-214): with `opts.fixedMain`, the first two pills become Quicker sides / Lighter sides, but **Different ideas** (208-214) still sends "Show me different meal options".
- `DIFFERENT_IDEAS_LABEL` (107) is also the reserved-slot key in `resolveChips` (292-297).
- The page passes `fixedMain` at options stage only (`app/chat/page.tsx:1196-1198`).

### Item (b)
- **Now filed as issue #675**, *Saved meals can't be deleted from the UI* (open). See §15.
- `deleteMeal` (`lib/api/meals.ts:104-110`) has no caller.
- `DELETE /api/meals/[id]` (`app/api/meals/[id]/route.ts:126-179`) deletes the meal and its draft dish recipes, and keeps saved ones.
- The meal screen (`app/meals/[id]/page.tsx`, 956 lines) has Save meal (537-549) and no delete.

## 1. Issue #667: remember every option set shown in this conversation (backend)

- `models/meal.py` `MealPlanSessionState` gains `shown_options: list[str] = Field(default_factory=list)`, documented as "every option shown in this conversation's meal flow, oldest first, as `Title (Dish, Dish)`, capped at 9".
- `workflows/meal/nodes.py`:
  - A new pure helper `_option_descriptor(o: MealOption) -> str` returns `f"{o.title} ({', '.join(d.name for d in o.dishes)})"`, the same string `previous_block` builds today.
  - `_descriptor_key(s: str) -> str`: the **whole** descriptor, case-folded with whitespace collapsed. It's not the title part, because titles under a fixed main are near-identical ("Lemon Pasta with …") and only the sides tell options apart.
  - Another, `_roll_shown_options(prior: list[str], new: list[str], cap: int = 9) -> list[str]`, appends `new` after `prior`. When a `_descriptor_key` repeats, it keeps the **newer** entry in the newer position. It then returns the last `cap` entries.
  - **`previous_block`:**
    - `latest = [_option_descriptor(o) for o in retained_state.options]` (the three just shown);
    - `shown = retained_state.shown_options or latest`. The fallback covers a session saved before this PR;
    - `earlier = [s for s in shown if _descriptor_key(s) not in {keys of latest}]`;
    - the block's `{options}` value is `"Just shown: " + "; ".join(latest)`, plus `". Earlier: " + "; ".join(earlier)` when `earlier` is non-empty.
  - **The new session state:** `shown_options = _roll_shown_options(shown, [_option_descriptor(o) for o in options])` when `retained_state` is set. Otherwise it's just this turn's descriptors, so a fresh "Plan dinner" starts a fresh list.
- **The prompt changes (logged in §14):**
  - `MEAL_OPTIONS_PREVIOUS_BLOCK` keeps its prefix `"\nAlready suggested in this conversation: {options}"` byte for byte, so `test_issue_651_meal_pills.py:835` and 842 hold unmodified.
  - Its tail becomes `". If the user's request refers to one of these (most likely one just shown), build on it; otherwise suggest meals different from all of them."`
  - No recorded fixture depends on this text (§0). The rule stays soft: the server doesn't reject a repeat.
- **Tests** (`tests/test_issue_667_meal_option_history.py`, new):
  - **Three stamped turns:** call `meal_options_stage` three times with `meal_followup: True` and a dispatching AI stub returning sets A, B and C.
    - Each turn feeds back `meal_plan_session_state.model_dump(mode="json")` as `session.metadata.meal_plan`, which is the JSON shape the session store really holds.
    - The third prompt has "Just shown:" followed by set B's descriptors, and "Earlier:" followed by set A's **(fails on main: it lists only set B)**.
  - `_roll_shown_options` dedupes on the whole descriptor, case- and space-insensitively (the newer entry wins), and caps at 9. Two fixed-main descriptors with the same title and different sides are **both** kept.
  - A retained state with no `shown_options` falls back to its `options`, so an old session still works.
  - A non-followup turn's state has only its own three descriptors.
  - A fixed-main followup keeps the list too. Its descriptors carry the sides, so a repeat of the sides is visible in the prompt.

## 2. Issue #662: drafts never leave `get_user_recipes` (backend)

- `get_user_recipes` adds `.eq("is_draft", False)` after the `user_id` filter. Its docstring says "non-draft (saved) recipes", the same set the recipe library shows.
- `search_saved_recipes`, the browse branch and the dashboard all inherit it. **There's no change to `search_saved_recipes` or `chat/nodes.py`**, so none of PR C's hunks move.
- **The test fakes:** in each `_FakeQuery.execute` whose rows feed `get_user_recipes`, a missing `is_draft` key reads as `False` (the column default). The change is one line, `row.get(k, False if k == "is_draft" else None) == v`, in:
  - `test_issue_493_saved_recipe_search.py`;
  - `test_issue_542_exact_title_match.py`;
  - **any fake PR C adds** for its repo-level `ignore_tokens` test. This is a reminder for **whichever PR lands second** (§11): if PR C lands first, this PR applies the one-liner to PR C's new fake; if this PR lands first, PR C's fake rows need `is_draft` or the same default.

  The PR body lists these as harness-only changes; no assertion changes.
- **Tests** (`tests/test_issue_662_saved_excludes_drafts.py`, new, on the 493 fake):
  - `get_user_recipes` over a saved row and an `is_draft: True` row returns only the saved one **(fails on main)**;
  - `search_saved_recipes("lemon pasta")` with a draft titled "Lemon Pasta" and a saved "Lemon Pasta Bake" returns only the bake **(fails on main)**;
  - the lookup node's browse ("show me my saved recipes"), on a real repo over that fake, lists no draft **(fails on main)**.
  - The dashboard needs no new test: it only consumes the rows.

## 3. Issue #665: only toggles are announced as toggles (ui-ux; the demo page is frontend)

- **`Chip`** gains `pressed?: boolean`. The button renders `aria-pressed={pressed}` only when `pressed !== undefined`, and `selected` stays purely visual. So every one-shot chip (PostMessageChips, HeaderQuickSetTimers, EmptyState, the chat cooking suggestions) becomes a plain button with **no call-site change**.
- **`ClarificationCard` and `PantryProposalCard`** pass `pressed={isSelected}` and **drop `ariaLabel`**, so the visible text (`titleCase(item)`) is the accessible name. That replaces "Select X" / "Deselect X". Their visual stays tone-driven.
- **frontend:** `app/chip-demo/page.tsx` passes `pressed={…}` equal to its `selected` at 85-91 and 123-130.
- **Tests** (`__tests__/chip-aria.test.tsx`, new):
  - a clickable Chip with no `pressed` has no `aria-pressed` attribute **(fails on main: it renders `"false"`)**;
  - `pressed` gives `"true"` or `"false"`;
  - `PostMessageChips` pills have no `aria-pressed` **(fails on main)**;
  - a selected `ClarificationCard` pill is `aria-pressed="true"` with the item as its name **(fails on main)**;
  - a non-clickable Chip renders a `span` with no `aria-pressed`, a guard.

## 4. (Moved) Issue #544

Issue #544 moved to `2026-09-30-issue-544-refine-diet-contract.md` (R3). Nothing in this contract depends on it.

## 5. Issue #408: no meal type means any dish (backend)

- **`workflows/recipe/nodes.py`:**
  - delete `_default_meal_type` and both fills (878-881, 982-988), and the `meal_time_bucket` import if it's left unused;
  - `meal_type` now comes only from the extraction (the user's words), a prior turn's value inherited through `_merge_constraints`, or the fixed main's recipe (`fixed_main.py:411-439`). A value the model invents from the clock can no longer be saved.
- **`prompts/recipe.py`** (both brainstorm prompts, 59-60 and 84-85) append to the meal-type rule: `If no meal type is given, don't assume one from the time of day or frame the ideas as snacks; suggest ordinary dishes for any meal.` This is the #248 guard: at midnight, the model is told not to lean on the clock.
- **Comments:**
  - `meal/nodes.py` 199, 282-285 and 830 drop "the default fill-in". `_state_with_recipe_constraints` still exists so a retained `meal_type` survives, and its behaviour is unchanged;
  - `domain/mealtime.py:5-7` (its caller list drops `_default_meal_type`, leaving the dashboard), `dashboard_ranking.py:36`, `test_dashboard_ranking.py:94` and `test_mealtime.py:5` name `meal_time_bucket` only.
- **Tests:**
  - **Replace `test_must_use_ingredients.py:325-345`** with `test_brainstorm_has_no_meal_type_when_unset`: the prompt has no `Meal type:` line and does contain the new rule **(fails on main)**. The PR body names it as a test that encoded the bug.
  - New in `tests/test_issue_408_neutral_meal_type.py`:
    - `extract_recipe_constraints` with an extraction of `meal_type=None` and no prior gives `meal_type is None` **(fails on main)**;
    - with prior `{"meal_type": "dinner"}` it gives `"dinner"`, a guard (a named type still carries);
    - the meal options prompt for "plan a meal" has no `Meal type:` line **(fails on main)**. The clock is pinned with `patch("bubbly_chef.workflows.recipe.nodes._default_meal_type", return_value="snack", create=True)`: on main that forces `snack`, and after the deletion `create=True` keeps the patch valid. Don't patch `nodes.datetime`, which breaks once ruff drops the unused import.
  - **Delete** `test_mealtime.py:41-57` (the function is gone; `meal_time_bucket` keeps its own tests). **Drop** the `_default_meal_type` patch at `test_issue_651_meal_pills.py:1065`; its assertions still hold. The PR body names both.

## 6. Issue #669: an amount edit re-derives the base (frontend)

- In `PUT /api/pantry/[id]`, when `body.quantity !== undefined || body.unit !== undefined`:
  1. If any of `name`, `quantity`, `unit` or `category` is missing from the body, read the row first: `select('name, quantity, unit, category').eq('id').eq('user_id').single()`. A miss returns `notFound`.
  2. `const { quantity_base, unit_base } = await normalizeBaseUnit({ name, quantity, unit, category })`, using body values over row values.
  3. Set `updates.quantity_base = quantity_base ?? null` and `updates.unit_base = unit_base ?? null`.
- A body without `quantity` or `unit` does no read and no normalise call, which is exactly today.
- **Who hits which branch.** `AddItemModal` always sends all four fields (§0), so every modal save runs the normaliser with no read. The read-first branch only matters for direct API callers that send a partial body.
- **Tests** (`pantry-id-route.test.ts`, extended; mock `@/lib/api/ai-proxy`'s `normalizeBaseUnit`):
  - editing 500 g to 1 kg (`{ quantity: 1, unit: 'kg' }`) with the normaliser returning `{1000, 'g'}` stores `quantity_base: 1000` and `unit_base: 'g'` **(fails on main)**;
  - `{ quantity: 2 }` alone reads the row's name, unit and category and passes them to the normaliser **(fails on main)**;
  - the normaliser returning nulls stores nulls;
  - an `expiry_date`-only body never calls the normaliser (a guard).
  - `makeSupabaseMock` gains a `select().eq().eq().single()` branch so the existing 93-101 test runs. Plumbing only; named in the PR body.

## 7. Issue #671: refused items earn no rescue (frontend)

- In `app/api/ai/recipes/cook/confirm/route.ts`, inside the 2xx branch, `const data = await response.clone().json().catch(() => ({}))`, then `skipped` is extracted exactly as the meal proxy does (74-77). `rescueCandidates(pantryItemIds, expiryByItemId, validDate, skipped)`.
- **The route still returns `response` untouched.** PR #674's `confirmCook` reads `deductions_skipped` from that same body.
- **Tests** (`cook-confirm-route.test.ts`, extended):
  - two expiring items are sent, and the upstream body lists one in `deductions_skipped`: exactly one `rescue` award results, for the other **(fails on main: two)**;
  - a body with no `deductions_skipped` behaves exactly as today (a guard);
  - the response body is forwarded byte-identical.

## 8. Issue #672: a new turn scrolls into view (ui-ux, `AskBubblesOverlay.tsx`)

- The thread div (368) gets `ref={threadRef}` and `data-testid="ask-bubbles-thread"`.
- `const reduced = useReducedMotion()` (framer-motion).
- An effect on `[messages.length, streaming]` calls `threadRef.current?.scrollTo?.({ top: threadRef.current.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })`.
- So each sent message, the typing bubble and each settled assistant turn, including one carrying an amendment card (always the last element when it mounts), scroll the list, and only the list, to the bottom.
- The resolved-card focus (102-105) is unchanged.
- **Streamed text growth doesn't auto-scroll.** `streamingText` isn't in the effect's dependencies, so tokens arriving don't move the list, which is intended: a user reading back isn't yanked down every token. The list scrolls when the typing bubble appears and again when the turn settles.
- **Tests** (`ask-bubbles-overlay.test.tsx`, extended):
  - Stub `HTMLElement.prototype.scrollTo` with a `jest.fn` that records, on each call, whether `screen.queryByText('Use this change')` is in the DOM.
  - When the pinned stream resolves with an amendment, the **last** `scrollTo` call is on the thread (`this` is `ask-bubbles-thread`), with `behavior: 'smooth'`, and its record says the card was present **(fails on main: never called)**;
  - with `useReducedMotion` mocked `true`, `behavior: 'auto'`;
  - the existing overlay tests pass unmodified.

## 9. Item (a): Different ideas says "sides" under a fixed main (frontend, `lib/chat-chips.ts`)

- With `opts?.fixedMain`, the options-stage Different ideas pill sends **`'Show me different sides for this main'`**. The label stays `DIFFERENT_IDEAS_LABEL`, so the reserved slot and dedup logic are untouched.
- Without `fixedMain`, it's unchanged.
- **Tests** (`chat-chip-resolver.test.ts`, the fixedMain block at 537+):
  - with `fixedMain: true`, the Different ideas chip's message is the new string **(fails on main)**;
  - without it, it's "Show me different meal options" (a guard);
  - the existing `resolveStaticChips` equals `resolveChips` loop (587-595) still passes.

## 10. Ownership

| Role | Owns |
|---|---|
| **backend** | `models/meal.py`, `workflows/meal/nodes.py` (§1, the §5 comments), `repository/supabase_repo.py` (`get_user_recipes` only), `workflows/recipe/nodes.py` (§5 only), `prompts/recipe.py` (the brainstorm prompts only), `services/dashboard_ranking.py` (the docstring), and their tests, including the 493 and 542 fakes |
| **frontend** | `app/api/pantry/[id]/route.ts`, `app/api/ai/recipes/cook/confirm/route.ts`, `lib/chat-chips.ts`, `app/chip-demo/page.tsx`, their tests, `verify`, and the PR body |
| **ui-ux** | `components/ui/Chip.tsx`, `components/chat/ClarificationCard.tsx`, `components/chat/PantryProposalCard.tsx`, `components/cook/AskBubblesOverlay.tsx`, and their tests |

There's no seam commit: nothing crosses roles except the Chip's `pressed` prop, which the demo page uses after ui-ux lands it. All three roles can start at once.

## 11. Overlaps and landing order

**PR #674** (open, *fix: cook-along Start now, timer dock layout and stacking, show skipped deductions*, fixes issues #663, #664, #657 and #621). Its files: CookModal, MealCookSheet, MealNowCard, TimerDock, TimerDockLayer, Providers, GuidedCookFlow, `lib/cook-skipped.ts`, `lib/meal-cook-stream.ts`, `lib/api/recipes.ts`, `types/recipes.ts`, the meal cook page and their tests.
- **No file overlap.** This PR touches none of them. `AskBubblesOverlay` is mounted by GuidedCookFlow and the meal cook page but isn't in PR #674's diff.
- **The one coupling:** PR #674's `confirmCook` parses the single-recipe proxy's body for `deductions_skipped`. §7 reads a **clone**, so the body PR #674 relies on is unchanged. Either order works.
- PR #674's contract lists issue #671 as filed separately; this PR closes it.

**PR #595** (open, *fix(bubbles): key daily_visit/cook_confirm/rescue on one exact local date*, for issue #550). It changes the date keys the cook, daily-visit and rescue awards use.
- **It overlaps §7** on `app/api/ai/recipes/cook/confirm/route.ts` and `__tests__/cook-confirm-route.test.ts`. It rewrites the award-key and date handling around the same `rescueCandidates` / `awardCookBubbles` block.
- **Rule:** whichever lands second rebases. §7's change is only the `clone().json()` read and the 4th `rescueCandidates` argument, so keep it as two lines beside PR #595's keys. The §7 tests go in their own `describe`, so they don't collide with PR #595's.

**The issue #544 contract** (`2026-09-30-issue-544-refine-diet-contract.md`, split out in R3). Two shared files, in separate hunks:
- `workflows/recipe/nodes.py`: §5 deletes `_default_meal_type` and its fills; #544 adds `refine_dietary_constraints` near `refine_recipe_node`.
- `prompts/recipe.py`: §5 edits the brainstorm prompts; #544 edits `RECIPE_FOLLOWUP_PROMPT`.

Either order works; whichever lands second rebases. This PR no longer touches `test_recipes_ai_routes.py`, `test_refine_recipe_node.py`, `test_issue_514_recipe_error_kind.py`, `recipe_generator.py` or `recipes_ai.py`.

**PR C** (issue #651 PR C, *the meal-again lookup*; not started, blocked on a Gemini fixture capture). **Either order works; whichever lands second rebases.** This PR isn't held behind it.

| File | PR C | This PR | Rule |
|---|---|---|---|
| `supabase_repo.py` | new meal words and helpers, `search_saved_recipes(ignore_tokens=)`, `search_saved_meals` | `get_user_recipes`' filter only (528-550) | Separate hunks. Semantically intended: PR C's two case-C recipe searches and its case-A browse all pool through `get_user_recipes`, so drafts drop out of them too |
| PR C's tests | a repo-level `ignore_tokens` test on a fake-client pool (§10), node tests with `get_user_recipes` stubbed | the §2 fake tweak | **Whichever PR lands second applies the §2 one-liner to any fake whose rows lack `is_draft`**, or its pool empties. Stubbed `get_user_recipes` tests are unaffected |
| PR C's verify step 6 | accepts a draft main's *recipe* card as issue #662's known bug | removes that case | This PR's verify step 3 re-runs it: no draft recipe card |
| PR C's body | names issue #662 as still open | `Fixes #662` | — |
| `lib/chat-chips.ts` | `mealLookup` on `MealChipOpts`, the `saved_recipe_lookup` case, `mealLookupChips` | the options-stage Different ideas message (208-214) | Different hunks in one file; the second to land rebases |
| `app/chat/page.tsx`, `prompts/router.py`, the fixtures, `chat/nodes.py`, `router.py` | edited | **untouched** | No classifier edit here, so **no fixture re-capture**. The prompt hash covers only `INTENT_CLASSIFICATION_SYSTEM_PROMPT` (`test_intent_classification.py:41`) |

## 12. Gates

`cd ai-service && pytest && ruff check bubbly_chef/ && ./scripts/mypy_gate.sh`, and `cd nextjs && npx tsc --noEmit && npx eslint src && npx jest`. Each **(fails on main)** test must be seen red on the base `main` (`94c0a84`, or later if PR C or PR #595 lands first) first, and the PR body says so.

## 13. `verify` (375×812; screenshots as absolute `blob/<sha>/…?raw=true` URLs)

Gemini is over its spending cap. **[model]** marks a step that needs a live model: Gemini, or the Ollama fallback if one is running. If none is available, the step is skipped, and the PR body says so and points to the unit test that stands in for it. Run each reproduction on `main` first where it's cheap.

1. **#669** (no model; the ai-service must be running for `normalize-base-unit`). Add "Flour, 500 g". Edit it to 1 kg. Read the row (`GET /api/pantry/<id>` or the Supabase table): `quantity_base` is 1000. On main it's 500. Then cook a recipe using 400 g of flour: about 600 g is left, not about 100 g.
2. **#671** (the cook proposal may call the model). Deleting the item in a second tab can't reproduce the bug, because `readExpiryByItemId` (`cook/confirm/route.ts:30`) then finds no row, so there's no expiry and no rescue. Instead:
   - Seed a pantry row expiring tomorrow whose base is null and can't be derived, with `quantity_base`/`unit_base` null. Correction from verify: "bag" is derivable as `(1, count)`, so use a unit like `tub`/`punnet`/`packet`, and change the row to that unit after the cook proposal is built, because the proposal marks rows it can't quantify as "Have it" with no deduction. `deduct_pantry_item` refuses it (`supabase_repo.py:885-895`), and the row keeps its expiry.
   - Cook a recipe that uses spinach through CookModal and confirm.
   - The server lists the row in `deductions_skipped`, and the `bubble_events` ledger has **no `rescue` row** for it. On main it has one.
   - If the proposal can't run, `cook-confirm-route.test.ts` is the evidence.
3. **#662** (no model for the setup; **[model]** for the chat lookup, which needs the classifier):
   - `POST /api/recipes` with `is_draft: true`, title "Zzz Draft Test Pasta".
   - The dashboard suggestion (`GET /v1/dashboard/daily`, which falls back to `source: "fallback"` without AI) never names it.
   - **[model]** "show me my saved recipes" doesn't list it, and "show me my saved zzz draft" gives "couldn't find". Correction from verify: adding "pasta" fuzzy-matches other saved pasta recipes; the draft is still absent.
   - Delete the row afterwards.
4. **#665** (no model). On an empty `/chat`, the starter pills have no `aria-pressed`. Paste `[...document.querySelectorAll('button[aria-pressed]')].map(b => b.textContent)`, which should give `[]`. **[model]** Also check a clarification card's selected pill, which gives `aria-pressed="true"`.
5. **#672** **[model]**. In a meal cook-along, open Ask Bubbles on a dish and ask "can I swap the cream for milk?" Screenshot: the amendment card's two buttons are visible without scrolling. Then run `document.querySelector('[data-testid="ask-bubbles-thread"]').scrollTop > 0`.
6. **#408** **[model]**. Between 14:00 and 17:00, or after 21:00, "just give me some recipe ideas" gives no "snack" framing. At about midnight, no breakfast list. Then "breakfast ideas", then "something else": still breakfast.
7. **#667 and (a)** **[model]**. "Plan dinner for 2", then **Different ideas** twice: the third set repeats no title from set 1. Make a saved recipe into a meal and tap **Different ideas**: the bubble reads "Show me different sides for this main", and the main is unchanged.

## 14. Reversible product calls (log each in the sprint doc)

1. **#667:** keep a rolling list of 9 descriptors (title plus dishes) in the session, deduped on the whole normalised descriptor. *Rejected:* titles only, or deduping on the title, which under a fixed main are near-identical and hide repeated sides. *Rejected:* rejecting repeats on the server, which could leave fewer than 3 options.
1a. **#667 prompt change:** `MEAL_OPTIONS_PREVIOUS_BLOCK` lists "Just shown: …" separately from "Earlier: …", and its tail says "most likely one just shown" and "different from all of them". The prefix is unchanged, and no recorded fixture depends on the text. *Rejected:* one flat list, which loses which set a "make it vegetarian" tap most likely refers to.
2. **#662:** filter at `get_user_recipes`, one place, the same `eq(false)` the library uses. *Rejected:* a `saved_only` parameter, since all three callers want saved only. *Rejected:* `or(is_draft.is.null,…)`, which disagrees with the library for NULL rows.
3. **#665:** a separate `pressed` prop, so the ARIA state is independent of the `selected` visual. The two multi-select cards become real toggles with a stable name. *Rejected:* the issue's `toggle` flag that reuses `selected`, which would restyle those cards. *Rejected:* leaving their "Select/Deselect" labels, a name that changes on toggle.
4. **Issue #544 moves to its own PR** (R3, the coordinator's call), `2026-09-30-issue-544-refine-diet-contract.md`, so its rule's review loop doesn't hold the other seven fixes. *Rejected:* keep iterating §4 inside the polish PR.
6. **#408:** delete the time-of-day default outright and add a neutral prompt rule (the triage decision). *Rejected:* keeping the default but not persisting it, which still frames one reply as snacks.
7. **#669:** an amount edit re-runs the normaliser, and a failed or impossible normalisation writes `null` bases.
   - Null is safe: cook time derives a missing base from `(quantity, unit)` (`supabase_repo.py:855-868`, `cook_matcher.py:745-754`) and refuses the row only when none can be derived.
   - Keeping the stale base is the one wrong state: it deducts from the old amount.
   - *Considered:* just nulling both bases on any amount edit, with no network call. It's correct too, and simpler.
   - *Chosen, and why:* the normaliser, because it's what `POST /api/pantry` and `pantry/bulk` already do, so an edited row stores exactly what a freshly added identical row would, including the category-aware conversion the runtime fallback doesn't pass. The cost is one call per modal save, and a failure degrades to the null the alternative would have written anyway.
8. **#672:** scroll the thread (not the page) to the bottom on every turn. *Rejected:* `scrollIntoView` on the card, which can also scroll the page behind the fixed overlay.
9. **(a):** keep the label "Different ideas" and change only the message. *Rejected:* a "Different sides" label, which needs a second reserved-slot key in `resolveChips`.

## 15. Split out

- **(b) Delete a meal from the meal screen. File it as its own issue; it doesn't belong here.** It's a new destructive feature, not a bug fix. It needs:
  - a confirm step, which there isn't a shared pattern for yet;
  - a decision on a meal whose cook session is running (`lib/meal-cook-session.ts`: end it and dismiss its timers, or block the delete);
  - invalidation of the meal and recipe lists (draft dish recipes go too);
  - a redirect target, and likely the same action in the recipe book's Meals filter.

  That's past the half-day line, and it's user-visible design work. **Filed as issue #675**, *Saved meals can't be deleted from the UI* (open).

## 16. Out of scope

- **The pick stage's "Different options"** under a fixed main has the same wording problem. The page passes only `{ mealSaved }` there (`chat/page.tsx:1231`), so fixing it needs a check that the pick-stage proposal carries `fixed_main`. Noted in the PR body, not fixed.
- **Sessions already holding a defaulted `meal_type: "snack"`** from before this PR keep it until the user names a type or starts a new conversation.
- **A name-only pantry edit** doesn't re-derive the base (the conversion rarely depends on the name).
- **A server-side check that options differ.** The #667 rule stays a prompt instruction.

## 17. Needs the human

None. All eight fixes (seven bugs plus item (a)) are reversible, within v1 scope and cost nothing. The #408 behaviour follows Ayush's triage decision, and nothing needs a paid model call beyond the verify steps marked **[model]**.

## Revision R1 (fresh review, all findings accepted)

| # | Where | Change |
|---|---|---|
| 1 | §4, §14.4 | **Blocker.** `refine_dietary_constraints` takes `previous_recipe`. The forbidden-food check runs on the tweak text plus the recipe's title and ingredient names, with `constraints={}`, so earlier turns' `must_use_ingredients` don't count. There are tests for a pinned chicken card and for the refine route with a saved chicken recipe |
| 2 | §13 step 2 | #671 verify uses an expiring row with a null, underivable base ("1 bag" spinach), which the server refuses while the row keeps its expiry. The second-tab delete couldn't reproduce the bug |
| 3 | §0, §1, §14.1a | Dedupe on the whole normalised descriptor. The block lists "Just shown" separately from "Earlier", which is logged as a prompt change. The prefix is kept, so `test_issue_651_meal_pills.py:835` and 842 hold; there's no recorded fixture for this text |
| 4 | Header, §2, §11 | Either order with PR C; whichever lands second rebases. The fake-default note is now a reminder for the second PR |
| 5 | §0, §6, §14.7 | The reason is corrected: a null base is derived at cook time, so null is safe and stale is wrong. The modal always sends all four fields; the read-first branch only serves direct API callers. "Just null the bases" is logged as the alternative, and the normaliser is chosen for parity with the POST and bulk paths |
| 6 | §5 | The clock pin patches `nodes._default_meal_type` with `create=True`, not `nodes.datetime` |
| 7 | §0, §4 | `test_recipes_ai_routes.py:96-114` joins the tests that need the `get_stored_dietary_preferences` patch |
| 8 | §4 | An excluded ingredient the tweak names is dropped for that reply, with a test |
| 9 | §8 | The `scrollTo` mock records whether the card is in the DOM, and the last call must have seen it. Stream-token growth deliberately doesn't scroll |
| 10 | §11 | PR #595 (issue #550, bubbles date keys) is named as an overlap on the single-recipe confirm route and its test |
| 11 | §0, §5 | The four docstrings naming `_default_meal_type` are in the comment list |
| 12 | §1 | Each turn feeds back `model_dump(mode="json")` |
| 13 | §3 | The two toggle cards drop `ariaLabel`, so the visible text is the name |
| — | §0, §15 | Item (b) is issue #675 |
| R2 | §4, §14.4, §14.4a, §13 step 6 | **#544 redesigned to trust tags first** (the coordinator's call): (a) a tag keeps a label, (b) other tags set it aside, (c) an untagged recipe gets a widened, plural-aware, modifier-aware ingredient check, and (d) the tweak sets a label aside only when it adds a forbidden food un-negated. Exclusions: a stemmed match, dropped when the tweak adds one or the recipe contains it. The dietary block moves after "Modify the recipe…", and the example is labelled format-only (a prompt change, no fixtures). The route maps library `tags` to `dietary_tags`, and has a `recipe: {}` test (no exclusions on that path). Refine never writes `state["recipe_constraints"]`, with a test. Assertions use `"dietary" not in constraints`. There's one patch target |
| R3 | Header, §0, §4, §10, §11, §13, §14.4, §16, §17 | **Issue #544 moved out** (the coordinator's call) to `2026-09-30-issue-544-refine-diet-contract.md`, which carries the review 3 fixes. Removed here: the `Fixes #544` line, §0's #544 block, §4 (now a one-line pointer), the #544 verify step (steps renumbered), §14 items 4, 4a and 5 (item 4 is now the split decision, with "keep iterating §4 inside the polish PR" rejected), and §16's allergies line. §10 drops `recipe_generator.py` and `recipes_ai.py`. §11 names the two shared files. The only shared test patch (`test_recipes_ai_routes.py` and the refine suites) went with it. R1 rows 1, 7 and 8 and the R2 row are kept as history |
