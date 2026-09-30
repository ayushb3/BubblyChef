# Pantry write fixes: missing rows, stale bases, a doubled chat seed, the contract

One PR fixes three open bugs. The PR body carries these lines, each on its own line:

```
Fixes #676
Fixes #677
Fixes #679
```

- **Issue #676**, *Cook confirm returns 500 when a matched pantry row is deleted before confirm* (open). If the row a cook matched is deleted (say in another tab) before confirm, both cook confirm routes return 500 instead of listing the row as skipped. On the meal path, the deductions before it have already landed and the confirm claim stays open.
- **Issue #677**, *Chat pantry 'use' and 'update' proposals leave quantity_base stale* (open). The same stale-base bug as issue #669 (closed by PR #678), but on the AI service's write path. After "I used 2 eggs", the next cook deducts from the old base amount.
- **Issue #679**, *Make it a meal from the recipe page sends the chat seed twice* (open). A client-side navigation into a seeded `/chat` sends two `/v1/chat/stream` requests, so the model runs and bills twice, and one bubble is shown.

The slices: **backend** owns `ai-service/`; **frontend** owns the one `nextjs/` change and `verify` (§4). Every line below was checked on `origin/main` at `1e8223c`. Re-locate by symbol if anything lands first.

**Branch:** `fix/issue-676-pantry-write-fixes`, off current `main`. Copy this file to `docs/plans/2026-09-30-pantry-write-fixes-contract.md` in the PR.

## 0. What exists (origin/main `1e8223c`)

### Issue #676
- **The three `.single()` reads in `repository/supabase_repo.py`** are the only ones in `ai-service/bubbly_chef`. Each has an `if not result.data` "not found" branch that can't run:
  - `get_recipe` at 759-778 (`.single()` at 773, `return None` at 776-777);
  - `update_recipe_cooked` at 796-820 (`.single()` at 804, `if result.data else {}` at 807);
  - `deduct_pantry_item` at 822-906 (`.single()` at 850, `return False` at 853-855).
- **What `.single()` does on zero rows.** supabase-py and postgrest-py are both **2.31.0** here (`pyproject.toml:22,27` pins `>=2.0` with no upper bound and no lockfile). `.single()` sets `Accept: application/vnd.pgrst.object+json`. PostgREST answers zero rows with 406, and `SyncSingleRequestBuilder.execute` raises `APIError` with `code == "PGRST116"` and details "The result contains 0 rows". `result.data` is never reached.
- **`.maybe_single()` in 2.31.0.** `SyncMaybeSingleRequestBuilder.execute` returns **`None` itself** (not a response with `data=None`) on zero rows. It returns `SingleAPIResponse(data=<dict>)` on one row and raises `APIError` code `"406"` on more than one. Its declared type is `Optional[SingleAPIResponse]`.
- **`.limit(1)`** returns an `APIResponse` whose `data` is `[]` or `[row]`. This file already reads that shape everywhere else: `find_similar_item` (277-291), `get_meal_with_dishes` (1127-1136) and `claim_meal_cook` (1196-1205).
- **Every caller expects `None` on a miss:**
  - `recipes_ai.py:207-209` (`POST /v1/recipes/cook`) and `317-319` (`/cook/confirm`) raise 404 on `None`. Today a missing recipe raises PGRST116 into the route's generic handler, which gives **500** (239, 343);
  - `services/structured_steps.py:80-82` raises `RecipeNotFoundError` (404 at `recipes_ai.py:279-280`). Today it's a 500;
  - `workflows/router.py:1053-1059` (the `?cooking=` handoff) logs and stays unpinned on a falsy result. Today it raises into the chat turn;
  - `supabase_repo.py:1149-1155` (`get_meal_with_dishes`) stores `recipe_row or {}` and its docstring (1116-1119) promises `{}` for a deleted recipe. Today it raises, so every meal route 500s when one dish's recipe is gone;
  - `workflows/meal/fixed_main.py:226-233,253-272` catches the raise with `_is_zero_rows_error` (PGRST116, or "0 rows" in the text). This is the only caller that copes today.
- **Why the tests are green.** The fakes return `data=None` for a miss instead of raising:
  - `test_pantry_deduction.py:18-39` (`single()` returns self, `execute` returns `data=self._row`). `test_missing_row_is_a_no_op` (145) passes against a shape the real client never produces;
  - `test_get_recipe_contract.py:20-38`, the same shape;
  - `test_issue_654_meal_cook_repo.py:266-294` `_FakeTable`, where `single` gives `rows[0] if rows else None`. So `test_deleted_recipe_gives_empty_recipe_but_keeps_recipe_id` (327-340) passes on main while the real method raises. The fake has no `limit()`;
  - `test_cook_routes.py:120` mocks `get_recipe` to return `None`;
  - `test_issue_651_make_it_a_meal.py:132-141` is the one mock that raises, as the real client does, and 1197-1205 pins the PGRST116 case.
- **The shared deduction loop.** `services/meal_cook.py:628-674` `apply_collapsed_deductions`: a `False` from `deduct_pantry_item` appends the id to `skipped` and **the loop continues** (657-663). An exception logs the ids applied and skipped so far and **re-raises** (664-672). Nothing is rolled back.
- **The single-recipe confirm** (`recipes_ai.py:303-343`) calls it, then `update_recipe_cooked` (330). There's no claim.
- **The meal confirm** (`api/routes/meals_ai.py:297-411`):
  - the claim (`claim_meal_cook`, `supabase_repo.py:1167-1246`) sets `last_cook_status='claimed'` before any write (327);
  - inside one `try` (379-394) it calls `apply_collapsed_deductions`, `update_recipe_cooked` per dish (383-384) and `mark_meal_cook_applied` (385, `supabase_repo.py:1266-1283`);
  - **a skipped middle row:** the loop runs on, the recipes are marked, the claim is stamped `'applied'`, and the response is 200 with `deductions_skipped`;
  - **a raise (today's PGRST116):** the earlier deductions stay applied and later ones never run. `mark_meal_cook_applied` is skipped and the route returns 500;
  - **the claim is not released on an exception, by design** (the comment at 376-378). It stays `'claimed'`: a replay of the same `cook_ref` gets 409 `confirm_in_progress` under 30 s and 409 `confirm_incomplete` ("Your pantry may be partly updated") after (342-360). The frontend reuses `cook_ref` for the session (`app/meals/[id]/cook/page.tsx:556`, `lib/meal-cook-session.ts`), so a retry can't re-deduct;
  - `update_recipe_cooked`'s own `.single()` (804) is a **second** path to the same stuck claim: a dish recipe that vanished after the deductions raises PGRST116 there;
  - `recipes_marked_cooked` (402) is built from `request.recipe_ids`, not from what was actually marked. `update_recipe_cooked` returns `None`.
- **The update result is ignored.** `deduct_pantry_item` returns `True` after its update (887-894) whatever the update matched, so a row deleted between its read and its write reads as applied.
- **The frontend needs nothing.** PR #674 (merged) turns `deductions_skipped` into names through the proposal (`lib/cook-skipped.ts:26-55`), and `SkippedDeductionsNotice.tsx:51` renders "Couldn't update N items…". The meal proxy already excludes skipped ids from rescue, and PR #678 did the same for the single-recipe proxy (issue #671).

### Other `.single()` reads, with a verdict
| Where | What it reads | Verdict |
|---|---|---|
| `supabase_repo.py:773` `get_recipe` | a recipe by id + user | **Fix** (§1). Every caller expects `None` |
| `supabase_repo.py:804` `update_recipe_cooked` | `times_cooked` | **Fix** (§1). A miss after the deductions strands the meal claim |
| `supabase_repo.py:850` `deduct_pantry_item` | the pantry row | **Fix** (§1). This is the issue |
| `fixed_main.py:226-272` `_is_zero_rows_error` | (catches the raise) | **Keep unchanged.** It becomes defensive only; `if not row` (270) handles the new `None` |
| Next.js GET reads: `pantry/[id]/route.ts:21`, `pantry/[id]/resolve/route.ts:72`, `recipes/[id]/route.ts:24`, `profile/[id]/route.ts:18`, `profile/email/[email]/route.ts:17`, `profile/username/[username]/route.ts:17`, `meals/[id]/route.ts:107`, `lib/meal-helpers.ts:78` | one row | **Correct as is.** supabase-js **returns** `{ data: null, error: { code: 'PGRST116' } }` rather than throwing, and each maps `error \|\| !data` to `notFound` |
| `pantry/[id]/route.ts:84` | the PUT read-first (PR #678) | **Correct.** It splits PGRST116 (404) from other errors (500) at 87-88 |
| `recipes/[id]/route.ts:78`, `app/profile/page.tsx:28` | optional reads | **Correct.** A miss is ignored on purpose |
| `update().select().single()`: `pantry/[id]/route.ts:114`, `pantry/[id]/slot/route.ts:22`, `profile/[id]/route.ts:49`, `recipes/[id]/route.ts:91` | the updated row | **Wrong status, out of scope.** A missing row is PGRST116, `if (error) return errorResponse(...)` sends **500**, and the `if (!data) notFound` after it is dead. Nothing is half-written. File a follow-up (§9) |
| `insert().select().single()`: `pantry/route.ts:94`, `recipes/route.ts:169`, `profile/route.ts:22`, `meals/route.ts:100,158`, `lib/meal-helpers.ts:274`, `kitchen/unlock/route.ts:103` | the inserted row | **Correct.** An insert always returns its row |

### Issue #677
- `supabase_repo.py:361-498` `apply_pantry_proposal`, called only by `POST /v1/workflows/apply` (`api/routes/workflows.py:50`).
- **The flat action shape** that chat sends (`nextjs/src/lib/api/chat.ts:301-308`) is `action, name, quantity, unit, category, location`. Chat always sends `unit`; the parse prompt defaults it to `"item"` (`prompts/pantry.py:15,25`).
- **The `add` merge branch** (380-402) adds quantities, then calls `normalize_to_base_unit(name=name, quantity=new_qty, unit=action.get("unit", existing.unit), category=action.get("category", existing.category.value))` and writes `quantity`, `quantity_base` and `unit_base`.
- **The `use` branch** (458-471) sets `new_qty = max(0, existing.quantity - action.quantity)` and **ignores `action["unit"]`**. It deletes at ≤ 0, and otherwise writes `{"quantity": new_qty}` only.
  - So "used 2 eggs" (`2 item`) against a "1 dozen" row computes 1 - 2, floors to 0 and **deletes the row**.
  - Against a "12 item" row it writes 10 and leaves `quantity_base` at 12.
- **The `update` branch** (472-481) passes every non-`None` action key except `action`/`name` straight to `update_pantry_item` (313-336). It never re-derives the base. An action without `quantity`/`unit` (for example the location-only one in `test_issue_541…:323-333`) must stay base-neutral.
- **`normalize_to_base_unit`** (`domain/normalizer.py:652-761`) returns `(qty, unit)` or `(None, None)`. It accepts `target_unit=` to convert toward a known base. Values checked on this machine:
  - `("eggs", 12, "item", "dairy")` → `(12, "count")`; `("eggs", 1, "dozen")` → `(12.0, "count")`;
  - `("eggs", 2, "item", target_unit="count")` → `(2, "count")`;
  - `("flour", 1, "kg", "dry_goods")` → `(1000.0, "g")`;
  - `("matcha", 3, "tbsp", *)` → `(None, None)`; `("spinach", 1, "handful", target_unit="g")` → `(None, None)`;
  - `normalize_unit("eggs")` is `"eggs"`, an unknown unit.
- **A null base is safe:** `deduct_pantry_item` derives one at cook time (861-877), and the matcher does the same (`cook_matcher.py:745-754`). A stale base is the one wrong state.
- **The harness to reuse:** `test_issue_541_apply_response_affected_ids.py:77-245` (`_repo(existing_by_name=…)`). It records `store["updates"]`/`["deletes"]`, and `tests/` is a package (`tests/__init__.py`), so a new file can import `_repo` and `_EXISTING_ROW`. The existing `use` tests (293-321) send no `unit`.

### Issue #679
- **The seed path is shared by all four seeds.** `app/chat/page.tsx`:
  - `seed` is `useMemo(deriveChatSeed(searchParams))` (95-98);
  - one effect sends it, guarded by `seedSentRef` (184, 278-290);
  - `deriveChatSeed` (`lib/chat-seed.ts:207+`) covers `meal`, `plan`, `tip` and `use`. The links are `makeMealHref` (the recipe page's `<Link>`, `app/recipes/[id]/page.tsx:259-270`), `planDinnerHref`, `tipChatHref` and `cookThisHref`.
- **What's ruled out:**
  - **The guard holds within one instance.** `chat-deep-links.test.tsx:173-188` (re-renders) and 193-206 / 232-245 (`plan` and `meal` under a **StrictMode** double mount) both see exactly one send on main. StrictMode keeps refs across its simulated remount, and `verify` runs a production build anyway.
  - **Search params settling** re-renders the same instance, which the ref guards.
  - **`streamChatMessage` has no retry** (`lib/api/chat.ts:72-82`).
  - So a second send needs a **second `ChatSurface` instance**.
- **The cause is `components/ui/PageTransition.tsx`**, mounted around every page by the root layout (`app/layout.tsx:67`).
  - It's `<AnimatePresence mode="wait"><motion.div key={pathname} … exit={…}>{children}</motion.div></AnimatePresence>` (8-19).
  - On a client navigation, framer-motion 12.38 (`AnimatePresence/index.mjs`, 100-160) keeps rendering the **exiting** child element (`key` = the old pathname) until its 200 ms exit ends, and only then mounts the new keyed child.
  - In the App Router, `children` is a router slot that renders **whatever route is current in context**. So the exiting wrapper renders the new page: `ChatSurface` #1 mounts and its seed effect sends. After the exit, that wrapper unmounts, taking #1 and its bubble with it, and the `/chat` wrapper mounts `ChatSurface` #2 with fresh refs, which sends again.
  - `useChat` has no unmount abort, so #1's stream runs to the end on its own conversation id.
  - A direct load has no key change, so one mount and one send. That matches the issue exactly.
- **It isn't specific to `meal`.** Any client navigation from a different pathname into `/chat?meal=`, `?plan=`, `?tip=` or `?use=` sends twice. `router.replace` within `/chat` (the `?cooking=` swaps) doesn't change the key.
- **More generally, every page mounts twice** on every client navigation. User-visibly, the new page renders, fades **out** for 200 ms, then mounts again and fades in. No page uses `usePresence`/`useIsPresent`, and no test renders `PageTransition` (grep).
- **Test precedent:** `chat-make-it-a-meal.test.tsx` and `chat-deep-links.test.tsx` mock `next/navigation`, `useChat` and `@/lib/api/chat`. Many suites mock `framer-motion` outright. The new test must **not**, because the bug lives in `AnimatePresence`.

## 1. Issue #676: a missing row reads as "not found", never as a raise (backend)

- **In `supabase_repo.py`, the three reads switch from `.single()` to `.limit(1)`** and read `rows = _as_rows(result.data)`:
  - **`deduct_pantry_item`:** `if not rows:` keeps the existing warning and `return False`; then `row = rows[0]`. The update's result is kept, and it returns `bool(_as_rows(update_result.data))` instead of `True`, so an update that matched nothing (the row went between read and write) is skipped, not applied. The refusal branch is unchanged.
  - **`get_recipe`:** `return rows[0] if rows else None`. The docstring adds "a miss is a zero-row read that returns `None`; it never raises".
  - **`update_recipe_cooked` now returns `bool`.** `if not rows:` → `logger.info("update_recipe_cooked: recipe %s not found for user %s; nothing to mark", …)` and `return False`, with **no write**. Otherwise `current = rows[0]`, the write is as today, and it returns `True`.
- **`api/routes/meals_ai.py:383-402`:** the dish loop collects `marked: list[str]`, appending `str(recipe_id)` only when `await repo.update_recipe_cooked(...)` is truthy. The response's `recipes_marked_cooked` is `marked`. The single-recipe route (`recipes_ai.py:330`) ignores the return, since its recipe was just read. So `test_cook_routes.py:181,242,271`, which set `update_recipe_cooked.return_value = None`, are harmless and stay.
- **Nothing else changes:**
  - no other route, `meal_cook.py` or `fixed_main.py` change;
  - the 404s in `recipes_ai.py:208-209,318-319` and `structured_steps.py:81-82` start working with no edit, so **this PR doesn't touch `recipes_ai.py`** (see §6, issue #544);
  - the meal confirm keeps its rule: **a raise still leaves the claim `'claimed'`**, and a skip closes it as `'applied'`.
- **Harness-only changes** (the PR body lists them; no assertion changes):
  - `test_pantry_deduction.py` `_FakeQuery`: add `limit(self, *_a)` → `self`, and `execute` returns `data=[self._row] if self._row else []`. `single` can go. That same `execute` also answers the update, and `deduct_pantry_item` now **reads** the update's result (`bool(rows)`). A present row gives `[row]` → `True`, so `test_applied_deduction_reports_true` (153) holds;
  - `test_issue_654_meal_cook.py:845`: `repo.update_recipe_cooked.return_value = None` becomes **`True`**. Under the new truthy check, `None` would empty `recipes_marked_cooked` and break the assertion at 904;
  - `test_get_recipe_contract.py` `_FakeQuery`: the same, plus a docstring saying `.limit(1)`;
  - `test_issue_654_meal_cook_repo.py` `_FakeTable`: add `limit(n)` (stores `n`; `execute` slices `rows[:n]`), and drop the `_single` branch;
  - `test_issue_651_make_it_a_meal.py:132-141`: `_get_recipe` returns `None` for a missing pair, and its docstring says it mirrors the real client. `test_postgrest_zero_rows_error_is_not_found` (1197-1205) **stays**, since `fixed_main` still guards a raise.
- **Tests** (`tests/test_issue_676_missing_row_is_skipped.py`, new):
  - **The fake.** `_PostgrestLikeClient(tables: dict[str, list[dict]])` is a fake that behaves like 2.31.0:
    - its table supports `select/eq/limit/single/order/update`, and `eq` filters rows;
    - with `single()` set and a filtered count ≠ 1, `execute` **raises** `postgrest.exceptions.APIError({"message": "JSON object requested, multiple (or no) rows returned", "code": "PGRST116", "details": "The result contains 0 rows", "hint": None})`;
    - otherwise it returns `data` as a list (sliced by `limit`);
    - `update(...).eq(...).execute()` records the payload, applies it to the matching rows and **returns those matched rows as `data`** (PostgREST's `return=representation`, the supabase-py default that `update_pantry_item` relies on at 334). So a present row reads as deducted, and a row removed before the update gives `[]` → skipped.
  - **Repository:**
    - `deduct_pantry_item` on an absent id returns `False` and records no update **(fails on main: raises `APIError`)**;
    - `deduct_pantry_item` whose read finds the row but whose update matches no row (the fake drops the row between the two calls) returns `False` **(fails on main: `True`)**;
    - `get_recipe` on an absent id returns `None` **(fails on main)**;
    - `update_recipe_cooked` on an absent id returns `False` and records no update **(fails on main: raises)**. On a present id it returns `True`;
    - `get_meal_with_dishes` with one dish whose recipe row is gone gives `recipe == {}` and keeps `recipe_id` **(fails on main)**;
    - a present row still deducts exactly as `test_pantry_deduction.py` expects (a guard).
  - **The single-recipe route** (`POST /v1/recipes/cook/confirm`, `httpx.AsyncClient` over `create_app()`, auth overridden as in `test_cook_routes.py:60-80`):
    - `repo = MagicMock()` whose `get_recipe`, `deduct_pantry_item` and `update_recipe_cooked` are the **real bound methods** of a `SupabaseRepository.__new__` over the fake. It holds a recipe row and pantry rows A and C, with **B absent**;
    - the deductions are sent in the order A, B, C;
    - it returns 200 with `deductions_applied == 2`, `deductions_requested == 3` and `deductions_skipped == [B]`, and A and C are updated **(fails on main: 500)**.
  - **The meal route** (`POST /v1/meals/cook/confirm`, the harness of `test_issue_654_meal_cook.py`):
    - `get_meal_with_dishes` and `claim_meal_cook` are `AsyncMock`s (the claim returns `outcome="claimed"`), and `mark_meal_cook_applied` is an `AsyncMock`;
    - `deduct_pantry_item` and `update_recipe_cooked` are the real bound methods over the fake;
    - the main dish's deductions are A and **B (absent)**, and the side's is C;
    - it returns 200 with `deductions_skipped == [B]` and `deductions_applied == 2`, both recipes in `recipes_marked_cooked`, and `mark_meal_cook_applied` awaited once with `(user, meal_id, cook_ref)` **(fails on main: 500, never awaited)**.
  - **The meal route, a dish recipe gone:** the same harness with every pantry row present but **the side's recipe row absent** from the fake. It returns 200 with every deduction applied, `recipes_marked_cooked == [main]` and `mark_meal_cook_applied` awaited once **(fails on main: 500 from `update_recipe_cooked`, claim stuck)**.
  - **The kept rule (a guard):** the same meal request where the real `deduct_pantry_item` is replaced by one raising `ConnectionError` on B. It returns 500, A is applied, C isn't attempted and `mark_meal_cook_applied` isn't awaited, so the claim stays `'claimed'`. This passes on main too; it pins that the PR doesn't release claims.
  - **404s:** `POST /v1/recipes/cook` and `POST /v1/recipes/cook/confirm` for a recipe id absent from the fake return **404** **(both fail on main: 500)**.

## 2. Issue #677: `use` and `update` keep the base in step (backend)

All changes are in `apply_pantry_proposal`, `supabase_repo.py:452-482`. The helpers come from `bubbly_chef.domain.normalizer` (`normalize_to_base_unit` is already imported at 18; add `normalize_unit`). `category = existing.category.value` throughout, the same fallback the `add` merge uses.

### `use` (replaces 458-471)
```
used_qty  = float(action.get("quantity", 1))
used_unit = action.get("unit") or existing.unit
```
- **Same display unit** (`normalize_unit(used_unit) == normalize_unit(existing.unit)`). This is today's arithmetic plus the `add`-merge re-derivation:
  - `new_qty = max(0, existing.quantity - used_qty)`. At ≤ 0 it deletes, as today;
  - otherwise `qb, ub = normalize_to_base_unit(name=name, quantity=new_qty, unit=existing.unit, category=category)`, and it writes `{"quantity": new_qty, "quantity_base": qb, "unit_base": ub}`. The **keys are always present**, so an underivable base writes `None`/`None`.
- **Different units** ("used 2 eggs", `2 item`, from "1 dozen"). It subtracts in the base:
  - **The row's base comes from the displayed amount first:** `row_base, row_unit = normalize_to_base_unit(name, existing.quantity, existing.unit, category)`. Only when that gives `(None, None)` does it fall back to the stored `(existing.quantity_base, existing.unit_base)`, and only when both are recorded. Stored bases can be stale from the old `use` path (§0), and the display amount is what the user sees and trusts;
  - `used_base, _ = normalize_to_base_unit(name, used_qty, used_unit, category, target_unit=row_unit)` when `row_unit`, else `(None, None)`;
  - `new_base = max(0.0, row_base - used_base)`. At ≤ 0 it deletes;
  - otherwise it writes `{"quantity": round(existing.quantity * new_base / row_base, 4), "quantity_base": new_base, "unit_base": row_unit}`. That's `deduct_pantry_item`'s proportional scaling (880-886), and the row keeps its display unit;
  - so **"used 2 eggs" from "1 dozen"** gives `quantity 0.8333` dozen and `quantity_base 10` count, not a deleted row.
- **When the base can't be worked out** (`row_base` or `used_base` is `None`), what happens depends on the action's unit:
  - **A default or count-like unit** (`normalize_unit(action.get("unit") or "") in {"item", "count"}`). That covers the parse prompt's default `"item"` (`prompts/pantry.py:15,25`, which `normalize_unit` maps to `"count"`), `items`, `piece(s)`, `each`, `""` and size adjectives such as `large` (all map to `"item"`). It falls back to **today's display-unit subtraction**, `new_qty = max(0, existing.quantity - used_qty)`. It deletes at ≤ 0, and otherwise writes `quantity` plus the base re-derived from `new_qty` in `existing.unit` (nulls when underivable), exactly as in the same-unit branch. So "used 2 carrots" (`2 item`) from "500 g carrots" with no piece weight still writes 498 g, as today, but with a current base. This is imprecise, but it's no worse than main, and it doesn't turn the most common chat phrasing into an error;
  - **A real unit the user said** (anything else, e.g. `handful`, `cup` against `g` with no density): **refuse.** `errors.append(f"Units don't match ({used_unit} vs {existing.unit}), edit the unit for: {name}")`, `failed += 1`, `continue`, and the row is untouched.
    - The name is the text after the first `": "`, which is what the retry parser takes (`lib/api/chat.ts:328-338`). So `failedActions` narrows to this one action, and `useChat.approveProposal` (619-636) shows `errors[0]` on the card.
    - **Retry stays enabled, and the card must let the user fix the unit** (frontend, `components/chat/PantryProposalCard.tsx`). Today the inline editor shows only when `needsQtyEdit` holds, meaning a missing quantity or `unit === 'item'` (52-56). That's locked in at mount (`wasEverEditable`, 71-72), and a failed card (`isFailed`, 171-172) only re-enables the rows. So "1 handful spinach" has no editor, and **Try again** would loop on the identical action.
      - **The editor.** `ActionRow` gains `forceEditor?: boolean`, and `showEditor = wasEverEditable || needsQtyEdit(action) || forceEditor`. The editor's fields already initialise from the action (77-82, which keeps `handful`).
    - **An existing double-apply on retry, fixed here.** After a partial failure, `approveProposal` narrows `pendingProposals[msgId].actions` to the failed set (`useChat.ts:625-630`). But the card still renders **every** row from `message.response.proposal` (`chat/page.tsx:1297-1320`). `handleQtyChange` sends the whole `localActions` list (`PantryProposalCard.tsx:230-244`), and `updateProposalActions` replaces the pending set with it (`useChat.ts:661-667`).
      - So editing the failed row resurrects the rows that already succeeded, and **Try again** applies them twice: a `use` of eggs is subtracted twice, and an `add` is added twice.
      - That's true on main for any row with an editor. §2's `forceEditor` would make it the normal path, so it's fixed here (frontend):
      - **One key everywhere:** `key = action.item.name.trim().toLowerCase()`. It's the same expression in the card, in filter (a) and in the `proposalFailedNames` write. A small exported helper `proposalActionKey(action)` in `lib/api/chat.ts` (or `types/chat.ts`) is used by all three.
      - **(a) `updateProposalActions` keeps only pending keys.** It filters `actions` to those whose key is in `existing.actions`' keys. Before any failure the pending set is every action, so pre-approve edits are unchanged. After a partial failure, only the failed set can be edited and re-sent.
      - **(b) Failed names reach the card.**
        - `useChat` gains `proposalFailedNames: Record<string, string[]>` (keys), returned from the hook, set on every failure to the keys of the actions that will be retried. It deletes the entry on success.
        - **On a `success: false` result** (620-636), that's `result.failedActions`' keys when present, else every pending action's key (the whole set is resent then).
        - **On a thrown `applyPantryProposal`** (the `catch`, 645-651: network error, non-2xx), that's every pending action's key. Nothing is known to have applied, and the pending set is unchanged.
        - **`startNewChat`** (575-584) also calls `setProposalFailedNames({})`, beside the other proposal-state resets.
        - `chat/page.tsx` passes `failedNames={proposalFailedNames[message.id]}` to `PantryProposalCard` at 1315-1320, a one-line prop.
        - **In the card**, `failedSet = new Set(failedNames ?? [])`, and `retryable = (k: string) => !failedNames || failedSet.has(k)`. So `failedNames === undefined` means **every row is retryable**: a failed card whose names never reached it (the prop unset, or a restored card) degrades to today's behaviour instead of locking every row.
        - Each row gets `forceEditor={(isFailed || isApproving) && retryable(key)}` and `disabled={!isEditable || isApproving || (isFailed && !retryable(key))}`. So rows that already applied stay read-only, instead of taking an edit that (a) would silently drop.
      - **While approving after a failure** (nit, §9.9), the editor stays open, disabled, instead of collapsing for the in-flight request: `failedNames` persists until success, so no ref is needed. On success the state becomes `approved`, the entry is deleted and the editor goes.
      - A retry without an edit fails again harmlessly: no write happens, and the same message shows.
    - **Jest, the card transitions** (`__tests__/pantry-proposal-inline-qty.test.tsx`, extended). One card with the actions eggs `use 2 item` and **`Spinach`** (capitalised, to exercise the key) `use 1 handful`:
      - rendered `pending`: no "Unit for Spinach" input;
      - re-rendered `failed` with `failedNames={['spinach']}`: the input labelled **"Unit for Spinach"** has value `handful` **(fails on main: no editor)**, and the eggs row's editor (shown since `item`) is disabled;
      - re-rendered `approving`: the spinach editor is still there and disabled;
      - re-rendered `approved`: no editor;
      - separately, a `failed` card with `failedNames` **undefined**: both rows' editors are enabled (every row is retryable).
    - **Jest, the hook** (the `renderHook` + mocked `streamChatMessage`/`applyPantryProposal` harness of `pantry-card-merge.test.tsx`, in a new `__tests__/pantry-retry-failed-only.test.ts`). The envelope has two actions, eggs `use 2 item` and **`Spinach`** `use 1 handful`.
      - **No double-apply:**
        - the first `approveProposal` resolves `{ success: false, failedCount: 1, errors: ["Units don't match (handful vs g), edit the unit for: Spinach"], failedActions: [Spinach] }`, and `proposalFailedNames[msgId]` is `['spinach']`;
        - call `updateProposalActions(msgId, [eggs, Spinach with quantity 30, unit 'g'])`, the **full** list the card sends;
        - the second `approveProposal`'s `applyPantryProposal` call carries **only** Spinach 30 g **(fails on main: eggs and Spinach)**. On success the entry is gone.
      - **A thrown apply:** `applyPantryProposal` rejects with `new Error('Failed to fetch')`. The state is `failed`, and `proposalFailedNames[msgId]` is `['eggs', 'spinach']`. A following `updateProposalActions` with both rows keeps both, and a retry sends both.
      - **`startNewChat` clears it:** after a failure, `startNewChat()` leaves `proposalFailedNames` equal to `{}`.

### `update` (472-481)
- After building `updates` as today: if `"quantity" in updates or "unit" in updates`,
  - `qb, ub = normalize_to_base_unit(name=updates.get("name", name), quantity=float(updates.get("quantity", existing.quantity)), unit=updates.get("unit", existing.unit), category=updates.get("category", existing.category.value))`;
  - `updates["quantity_base"] = qb`; `updates["unit_base"] = ub`, set explicitly so `None` is written.
- A caller-sent `quantity_base` is overwritten in that case (chat never sends one).
- An update with neither key is unchanged, so the location-only update stays base-neutral.

### The parse prompt (a prompt change, logged in §9.8)
- **The bug it closes.** `prompts/pantry.py:18-19` tells the model `"remove" for items used/thrown out, "use" for partial consumption`. The `remove` branch (`supabase_repo.py:484-492`) deletes the row whatever the quantity, so "I used 2 eggs" parsed as `remove` still deletes the dozen, the same user-visible bug. Nothing on the server can tell "used 2" from "finished them" in a `remove` action (chat always sends a quantity, defaulting to 1).
- **The change.** Lines 18-19 become:
  ```
  - action: "add" for purchases; "use" when some of an item was used, eaten or
    cooked with (quantity = the amount used; unit as in rule 3, so "item" when
    the user just counts); "remove" only when the item is gone entirely (used
    up, finished, thrown out, or the user used all of it, the rest, or the last of it)
  ```
  Rule 3 (`prompts/pantry.py:25`, "Default unit to 'item' if not specified") stays. The wording points at it, rather than inviting noun-units like "eggs" that `normalize_unit` can't read (§10).
  So "I used all the eggs" still removes, and "I used 2 eggs" is a `use`.
- **No fixture depends on it.** The recorded fixtures cover only the intent classifier (`tests/fixtures/intent_classifications.json`, hash on `INTENT_CLASSIFICATION_SYSTEM_PROMPT`), and no test reads `PANTRY_PARSE_SYSTEM_PROMPT`'s text, so no re-capture is needed.
- **A live-model check is owed** (§8 step 2b). If no model is available, the PR body says the prompt change is unverified against a model and names this section.
- **Test:** `test_issue_677_apply_base_units.py::test_parse_prompt_reserves_remove_for_gone_items` asserts that `PANTRY_PARSE_SYSTEM_PROMPT` contains `quantity = the amount used; unit as in rule 3, so "item" when`, `"remove" only when the item is gone entirely` and `all of it, the rest, or the last of it`; that it still contains `Default unit to "item" if not specified`; and that it no longer has `"remove" for items used` or `as the user said it`. It's a text pin only; it proves nothing about the model.

### Tests
The file is `tests/test_issue_677_apply_base_units.py`, new. It imports `_repo` and `_EXISTING_ROW` from `tests.test_issue_541_apply_response_affected_ids`, and each row is `dict(_EXISTING_ROW, …)`.

- **`use`, same unit:**
  - 2 `item` from `eggs 12 item` (`quantity_base 12, unit_base count`) writes `{"quantity": 10.0, "quantity_base": 10, "unit_base": "count"}` **(fails on main: `{"quantity": 10.0}` only)**;
  - with an underivable base (`matcha 3 tbsp` → use 1 `tbsp`), the payload has `quantity 2.0` and **`quantity_base`/`unit_base` present and `None`** **(fails on main: the keys are absent)**.
- **`use`, different units:**
  - 2 `item` from `eggs 1 dozen` with base 12 count gives `quantity ≈ 0.8333`, `quantity_base 10.0` and `unit_base "count"`, with no delete **(fails on main: the row is deleted)**;
  - the same with the row's base null derives 12 and gives the same result **(fails on main)**;
  - **a stale row:** `eggs 0.5 dozen` with a stored `quantity_base 12`, and 2 `item` used. The base is derived from the display (6), so the result is `quantity_base 4.0` and `quantity ≈ 0.3333`, not 10 **(fails on main: the row is deleted)**;
  - 12 `item` from `eggs 1 dozen` deletes the row (a guard; main deletes too);
  - **the default-unit fallback:** 2 `item` from `matcha 30 g`. The row's base derives fine (30 g), but the **used amount** can't: `item` to g has no piece weight for matcha. It takes the fallback and writes `quantity 28` with a re-derived `quantity_base 28`/`unit_base "g"`, with no error **(fails on main: `quantity_base` isn't written)**;
  - **a count-like unit:** "used 2 pieces" of carrots (`2 pieces` from `carrots 500 g`; `normalize_unit("pieces") == "item"`, and there's no piece weight) takes the **fallback, not a refusal**: `quantity 498` and `quantity_base 498`, `failed == 0` **(fails on main: `quantity_base` isn't written)**;
  - **a real mismatch:** 1 `handful` from `spinach 200 g` gives `failed == 1`, the error `"Units don't match (handful vs g), edit the unit for: spinach"`, and no update or delete **(fails on main: it writes 199)**. A jest case in `__tests__/apply-pantry-proposal.test.ts` feeds that error string back and asserts `failedActions` is exactly the spinach action. That's a guard on the existing parser.
- **`update`:**
  - `flour 500 g` (base 500 g) with `{"action": "update", "name": "flour", "quantity": 1, "unit": "kg"}` gives a payload with `quantity 1`, `unit "kg"`, `quantity_base 1000.0` and `unit_base "g"` **(fails on main)**;
  - `matcha 30 g` updated to `3 tbsp` gives `quantity_base`/`unit_base` present and `None` **(fails on main)**;
  - a location-only update's payload has no `quantity_base`/`unit_base` key (a guard).
- `test_issue_541…` and `test_issue_182…` pass unmodified.

## 3. (No change) `add` merge
The `add` merge branch isn't touched. It sums quantities across units without converting (§9).

## 4. Issue #679: one mount per navigation (frontend)

- **`components/ui/PageTransition.tsx`:** drop `AnimatePresence` and `exit`. It renders `<motion.div key={pathname} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} style={{ minHeight: '100%' }}>{children}</motion.div>`.
  - A key change unmounts the old page at once and mounts the new one **once**, which fades in exactly as now. The exit fade never showed the old page anyway: it faded the **new** page out.
  - A comment names issue #679 and why there's no `AnimatePresence`: the App Router's `children` follow the current route, so an exiting copy mounts the next page twice.
- **Ownership:** the file is in `components/ui`, ui-ux's folder. It's an 8-line motion change with no design-system surface, so **frontend** takes it with the test. The coordinator can reassign it to ui-ux without changing anything else.
- **No #679 change** to `app/chat/page.tsx`, `lib/chat-seed.ts` or `useChat.ts`. The `seedSentRef` guard is right within an instance. (§2's retry fix edits `useChat.ts` and adds one prop in `chat/page.tsx`, far from the seed code.)
- **Tests** (`__tests__/page-transition-single-mount.test.tsx`, new; **don't mock `framer-motion`**):
  - **The App Router shape.** `const RouteCtx = createContext('/recipes/r1')`, and `function Outlet() { return useContext(RouteCtx) === '/chat' ? <ChatPage /> : <MountCounter /> }`. **One** `<Outlet />` element is created once and passed as `PageTransition`'s children, so its output follows context the way the router slot does.
  - **Mocks:**
    - `next/navigation`: `usePathname` returns `mockPathname`, `useSearchParams` returns `mockSearchParams`, and `useRouter` returns `{ replace, push, refresh }` as `jest.fn`s;
    - the **real `useChat`**, with `@/lib/api/chat` mocked: `streamChatMessage: jest.fn(() => new Promise(() => {}))`, plus `checkAIHealth`, `fetchChatHistory` and `applyPantryProposal` stubs;
    - `react-markdown`, `remark-gfm`, `CookModal` and `@/lib/api/recipes`, as in `chat-make-it-a-meal.test.tsx:23-83`;
    - wrap in `ThemeProvider` and `QueryClientProvider`.
  - **Mechanism:** the outlet renders `<MountCounter key={route} />`, which bumps a counter in `useEffect(() => { mounts++ }, [])`. Keying it by route stands in for the router rendering a different segment per route; without the key the counter can't tell main from the fix. The context value and the pathname both change from `/a` to `/b`. After `await act(() => new Promise(r => setTimeout(r, 600)))` the counter is **2** (the first mount plus one after navigating) **(fails on main: 3)**.
  - **Request count:** start at `/recipes/r1` with empty params. Then set `mockPathname = '/chat'` and `mockSearchParams = new URLSearchParams('meal=<uuid>&title=Lemon Pasta')` and re-render with the context at `'/chat'`. Wait 600 ms as above.
    - `streamChatMessage` has been called **exactly once**, and its request carries `context.meal_fixed_main.recipe_id === <uuid>` **(fails on main: twice)**.
    - The same as `it.each` over `plan=dinner`, `tip=Salt your pasta water` and `use=spinach` **(each fails on main)**.
  - **Guard:** rendering straight at `/chat?meal=…` with no navigation gives exactly one call.
  - **No `StrictMode` wrapper.** StrictMode double-invokes mount effects in development, so a mount counter would read 2 per real mount and blur the 2-vs-3 difference. And the seed's `seedSentRef` already holds under StrictMode (the existing suites at `chat-deep-links.test.tsx:193,232` pin that), so StrictMode isn't the bug. Production, which `verify` runs, has no StrictMode.
  - **Red on main first.** If framer's exit doesn't complete in jsdom (so main shows 1, not 2), set `MotionGlobalConfig.skipAnimations = true` (framer-motion 12) in the test and check again. If it still can't go red, stop and report. Don't mock `AnimatePresence`: that mocks away the bug.
- The existing `chat-deep-links` and `chat-make-it-a-meal` suites pass unmodified. They don't render the layout.

## 5. Ownership

| Role | Owns |
|---|---|
| **backend** | `repository/supabase_repo.py` (`get_recipe`, `update_recipe_cooked`, `deduct_pantry_item`, `apply_pantry_proposal`), `api/routes/meals_ai.py` (the `recipes_marked_cooked` loop only), `prompts/pantry.py` (lines 18-19 only), the two new test files, and the five harness edits in §1 (including `test_issue_654_meal_cook.py:845`) |
| **frontend** | `components/ui/PageTransition.tsx` (§4 explains why it isn't ui-ux's), its new test, `components/chat/PantryProposalCard.tsx` (`forceEditor`, `failedNames` and the row `disabled` rule only, §2; also in ui-ux's folder, assigned to frontend by the coordinator), `hooks/useChat.ts` (`updateProposalActions`, `proposalFailedNames`), the one `failedNames` prop in `app/chat/page.tsx`, the extended `pantry-proposal-inline-qty.test.tsx`, the new `pantry-retry-failed-only.test.ts`, the `applyPantryProposal` parser guard (§2), `verify`, and the PR body |

There's no seam and no shared file, so both can start at once.

## 6. Overlaps and landing order

- **The issue #544 contract** (`2026-09-30-issue-544-refine-diet-contract.md`; branch `fix/issue-544-refine-diet`, live in the `state-check-cb0ff6` worktree, no PR yet). It edits `api/routes/recipes_ai.py` (the refine route), `test_recipes_ai_routes.py` and the refine suites. **This PR edits neither file**: the cook 404s come free from `get_recipe`, and its route tests are new files. There's no conflict and either order works.
- **PR #607** (open, idle since 2026-09-23, *fix(chat): restore pending pantry proposal on navigate-away-and-back*, issue #444). It persists pending proposals across navigation and edits `hooks/useChat.ts`, which this PR also edits (`updateProposalActions`, both failure branches of `approveProposal`, `startNewChat`, the new `proposalFailedNames` state and its return).
  - **An issue PR #607 must handle before it merges.** It restores a card that partially failed with the **original full action list** as pending, and the card starts `pending`. So after a reload, **Approve re-applies the rows that already succeeded** (the eggs are used twice).
  - §2(a)'s filter can't stop that: it only narrows edits against the pending set, and PR #607's restored pending set is the full list.
  - PR #607 must persist the partial-failure state: the narrowed pending actions plus `proposalFailedNames`, and the `failed` state or an equivalent. The coordinator is commenting on PR #607.
  - **This PR doesn't wait for it.** On main nothing is restored after a reload, so this PR introduces no new re-apply. Whichever lands second rebases on `useChat.ts`.
- **PR #617** (open, *fix(cook): amended mid-cook ingredients survive a page reload*, issue #490) is a **stale draft that conflicts with `main`**. It overlaps this PR only on the file `app/chat/page.tsx` (this PR adds one prop at 1315-1320; it edits elsewhere), with no behavioural interaction.
- **The mount behaviour (§4).** Any PR that restores state on mount does it once per navigation instead of twice after this PR, which is strictly safer. PR #607 should re-run its navigate-away-and-back verify after rebasing.
- **PR #595** (open, *fix(bubbles): key daily_visit/cook_confirm/rescue on one exact local date*, issue #550). It edits the Next.js cook confirm proxy and bubbles routes. There's no overlap.
- **PR #674** (merged) supplies the skipped-deductions notice this PR relies on, unchanged.
- **`meals_ai.py`, `prompts/pantry.py` and `PantryProposalCard.tsx`** aren't in any open PR's file list, or in the issue #544 branch, which edits `prompts/recipe.py`, not `pantry.py`.
- **One prompt edit** (`prompts/pantry.py`, §2), and no classifier edit, so there's no fixture re-capture.

## 7. Gates

`cd ai-service && pytest && ruff check bubbly_chef/ && ./scripts/mypy_gate.sh`, and `cd nextjs && npx tsc --noEmit && npx eslint src && npx jest`.

`.limit(1)` keeps `result.data` typed as the list `_as_rows` already takes, so mypy gets no new baseline entries. Each **(fails on main)** test must be seen red on base `main` (`1e8223c`) first, and the PR body says so.

## 8. `verify` (375×812; screenshots as absolute `blob/<sha>/…?raw=true` URLs)

Gemini is over its spending cap. **[model]** marks a step that needs a live model; with none, the step is skipped and the PR body names the unit test standing in for it. Run each reproduction on `main` first where it's cheap.

1. **#679** (no model: the request count is the evidence, and the reply may be an error bubble).
   - Open `/recipes`, tap a saved recipe (a client navigation), and tap **Make it a meal**.
   - `read_network_requests` shows **1** request to `/v1/chat/stream` and **1** to `/health/ai`, the chat page's `checkAIHealth` mount call (`chat/page.tsx:187-191`). On main: 2 and 2. The health call is the mount count for any page, seeded or not.
   - Repeat from `/` via the Plan card (`?plan=dinner`), the tip card (`?tip=`) and an expiring item's cook link (`?use=`): 1 and 1 each.
   - Load `/chat?meal=<id>&title=…` directly: 1 and 1.
   - Screenshot the seeded chat after the navigation.
   - **Scroll position:** open `/pantry`, scroll well down, then tap **Chat** in the bottom nav. `/chat` lands at the top (`window.scrollY === 0` before the thread's own auto-scroll moves the message list). The old exit wrapper held the page for 200 ms, and this checks that dropping it didn't change where the new page lands. Screenshot it, and do the same on main for comparison.
   - Tap between bottom-nav tabs: the page fades in once, with no fade-out of the incoming page.
2. **#677** (no model: it goes through the apply proxy, as the chat's Approve does).
   - Add "Eggs, 1 dozen" in the pantry UI, and read its row (`GET /api/pantry/<id>`): `quantity_base 12`.
   - From the console: `fetch('/api/ai/workflows/apply', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({request_id: crypto.randomUUID(), intent:'pantry_update', proposal:{actions:[{action:'use', name:'eggs', quantity:2, unit:'item', category:'dairy'}]}})})`.
   - Re-read the row: `quantity ≈ 0.8333`, `quantity_base 10`, `unit_base count`. **On main the row is gone.** Screenshot the pantry card.
   - Add "Flour, 500 g", send `{action:'update', name:'flour', quantity:1, unit:'kg', category:'dry_goods'}`, and re-read: `quantity_base 1000`. On main it stays 500.
   - **A real mismatch, proxy (no model):** add "Spinach, 200 g". The proxy call with `{action:'use', name:'spinach', quantity:1, unit:'handful'}` returns `failed_count 1` and the error "Units don't match (handful vs g), edit the unit for: spinach", and the row is unchanged.
   - **A real mismatch, card ([model]):** with "Eggs, 1 dozen" and "Spinach, 200 g" in the pantry, in chat, "I used 2 eggs and a handful of spinach", then Approve.
     - The card turns failed with the spinach message. **Only the spinach row shows the inline editor** (Quantity / "Unit for spinach", prefilled `1` / `handful`), and the eggs row is read-only.
     - The eggs row now reads 0.8333 dozen (base 10), applied once.
     - Edit spinach to `30` / `g` and tap **Try again**. `read_network_requests` on `/api/ai/workflows/apply` shows the retry body carrying **only spinach**. Spinach reads 170 g, and **eggs still read 0.8333 dozen (base 10), not 0.6667**.
     - On main, spinach has no editor, so **Try again** loops. The double-apply can still be shown on main with an `item`-unit row that has an editor.
     - Screenshot the failed card with the editor open, and both pantry rows after.
   - **2b [model], the owed prompt check.** Each is phrased in chat against the rows noted, then checked on the proposal card before approving:
     - "I used 2 eggs" (with a "1 dozen" row) gives `use`, and after Approve the row reads 0.8333 dozen with base 10. On main it can come back as `remove` and delete the dozen;
     - "I used all the eggs" gives `remove`;
     - "I finished the milk" (with a milk row) gives `remove`.

     Without a model, the PR body says §2's prompt change is unverified.
3. **#676, single recipe** (no model if every ingredient matches deterministically).
   - Seed "Garlic butter toast" (bread 2 slice, garlic 1 clove, butter 10 g) and pantry rows for all three.
   - Open the recipe, **Cook**, and reach the review.
   - In a second tab, delete **Garlic** (the middle deduction) from the pantry. Back in the first tab, confirm.
   - The modal shows "Couldn't update 1 item: Garlic…". Bread and butter are reduced, and `times_cooked` went up by 1. **On main: "Cook confirm failed" (500).** Screenshot both.
4. **#676, meal** (no model if the dishes' ingredients match deterministically; otherwise **[model]**).
   - Take a saved two-dish meal, open **Start cooking**, and reach the review.
   - Delete a pantry row the **main** dish uses, not the last deduction, and confirm.
   - The notice lists it, and the `meals` row's `last_cook_status` is `applied` (Supabase table view). **On main: 500 and `claimed`.** Screenshot the notice.
5. **#676, 404** (no model). From the console on the recipe page, call the cook proxy (`/api/ai/recipes/cook`) with a random UUID `recipe_id`: 404 "Recipe not found". On main: 500.

## 9. Reversible product calls (log each in the sprint doc)

1. **#676, `.limit(1)`.**
   - *Rejected:* `.maybe_single()`. In 2.31.0 it returns `None` itself on zero rows, a shape no other read in the file has, behind an unbounded `>=2.0` pin with no lockfile.
   - *Rejected:* catching PGRST116 around `.single()`. It keeps exceptions as control flow, and `fixed_main` shows that needs string matching.
2. **#676, fix all three reads, not just `deduct_pantry_item`.** It's the same bug in the same file two methods away, and it turns the cook routes' documented 404 from a 500 into a real 404. *Rejected:* the deduction only, which leaves a vanished dish recipe able to strand a meal claim.
3. **#676, keep "a raise leaves the claim `'claimed'`".** *Rejected:* releasing it on exception, because a retry would re-deduct the rows that already landed. *Rejected:* a compensating rollback, since PostgREST gives no transaction here; that's a larger design.
4. **#677, `use` in a different unit subtracts in the base and scales the display amount**, keeping the row's unit (1 dozen − 2 eggs = 0.8333 dozen). *Rejected:* rewriting the row as 10 count, which changes what the user entered. *Rejected:* today's raw subtraction, which deletes a dozen eggs for "used 2".
4a. **#677, in a different unit, the row's base is derived from the displayed amount first**, falling back to the stored base only when the display can't be converted. The old `use` path left stored bases stale, and the display amount is what the user sees. *Rejected:* trusting the stored base first, which would carry old drift into every new subtraction. **The cost:** a stored base that was supplied separately and deliberately differs from what the display derives to is discarded on the next different-unit `use`. An example is a receipt-ingest `quantity_base` that `add` honours at 443-444, such as a pack weight. Both the written base and the scaled display then follow the display-derived base. That's accepted: the display amount is what the user can see and correct.
5. **#677, when no base can be worked out, the default unit falls back and a real unit is refused** (option (a), plus a clear retryable refusal for real mismatches).
   - **With a default or count-like unit** (`normalize_unit(unit) in {"item", "count"}`: `item`, `piece(s)`, `each`, `""`, size adjectives), it does today's display-unit subtraction, now with a current base.
   - **With a real unit that can't convert** (`handful` vs `g`), it refuses: the error names the mismatch and says to edit the unit, and the row is untouched. That matches `deduct_pantry_item`'s refusal.
   - Retry stays enabled, and a failed card now always shows the inline editor (`forceEditor={isFailed}`, §2), so the user can change the unit before retrying. A bare retry fails again with no write.
   - *Rejected:* refusing every unconvertible pair, since chat's default "item" would make that the common case.
   - *Rejected:* a "not retryable" flag, which needs a new `ApplyResponse` field and frontend work for a retry that is already harmless.
   - *Rejected:* subtracting raw numbers across real units (today).
   - **Behaviour change for the PR body:** "A chat 'use' in a unit that can't be converted to the pantry row's (e.g. 'a handful' of spinach stored in grams) is no longer applied as a raw number. It's refused with 'Units don't match (handful vs g), edit the unit for: spinach', and the row is unchanged. A 'use' with no unit named, or in pieces/each, still subtracts as before. A failed pantry card now opens the amount and unit editor on the rows that failed (the rows that applied stay read-only), so the unit can be fixed before Try again. This also fixes a double-apply that already existed on main: editing a row after a partial failure used to re-send the rows that had already applied, so Try again applied them a second time. A retry now sends only the rows that failed."
6. **#677, an underivable base writes `null`**, as PR #678 did for issue #669. *Rejected:* keeping the old base, which is stale.
7. **#679, remove the exit animation and keep the enter fade.**
   - *Rejected:* a "FrozenRouter" that pins `LayoutRouterContext`. It imports Next's internal `next/dist/shared/lib/app-router-context…` and breaks on upgrades.
   - *Rejected:* a module-level "seed already sent" guard. It hides the remount, every page's mount effects would still run twice, and a real second visit to the same URL must send.
   - *Rejected:* aborting the stream on unmount in `useChat`. StrictMode's dev cleanup would abort the one real seed send, and the server-side model call may continue regardless.
8. **#677, the pantry parse prompt reserves `remove` for items that are gone** (`prompts/pantry.py:18-19`, §2). It closes the same user-visible bug ("I used 2 eggs" deleting the dozen) through its other door, and it's a three-line edit with no fixture behind it.
   - *Rejected:* a follow-up issue. It would ship a fix whose headline example can still fail.
   - *Rejected:* a server-side guard that turns a `remove` with a small quantity into a `use`. Chat always sends a quantity (default 1), so "threw out the milk" can't be told from "used 1".
   - **The live-model check is owed** (§8 step 2b), and the PR body says so if it can't run.
9. **#677, the editor stays open (disabled) while a retry is approving**, keyed off the persisted `failedNames` rather than a ref. *Rejected:* accepting the collapse-and-reopen flicker for the in-flight request. *Rejected:* a `hasFailed` ref in the card, which would duplicate state the hook already holds.
10. **#677, after a partial failure, rows that already applied are read-only** on the card. *Rejected:* leaving them editable, since an edit to them would be dropped silently by §2(a).

## 10. Out of scope (file as follow-ups)

- **The Next.js `update().select().single()` routes** (`pantry/[id]` PUT, `pantry/[id]/slot`, `profile/[id]` PUT, `recipes/[id]` PUT) return **500 instead of 404** for a missing row, and their `if (!data) notFound` is dead. Nothing is half-written. It's one issue for a follow-up.
- **The `add` merge branch** (`supabase_repo.py:380-402`) adds `action.quantity` to `existing.quantity` without converting units, and normalises with the action's unit. "Add 1 dozen eggs" onto "6 item" gives 7. It's a separate issue.
- **`fixed_main._is_zero_rows_error`** stays as dead-but-harmless defence. Removing it is a cleanup, not this fix.
- **An orphaned stream from an unmount** (any cause) still runs to completion on the server. Nothing mounts twice after §4.
- **An unknown `use` unit** such as `"eggs"` (the model echoing the noun) is refused under §2, because it isn't the default `"item"`. Teaching `normalize_unit` noun-units is a normaliser change.
- **`remove` deletes the row whatever the quantity** (`supabase_repo.py:484-492`). That's right for "finished" or "threw out". The prompt change in §2 stops "used 2" from reaching it, but a model that still emits `remove` for a partial use deletes the row. A quantity-aware `remove` is rejected in §9.8; any further guard is a follow-up if step 2b shows the model still misroutes.

- **Two rows with the same name on one card** (e.g. "use 2 eggs" and "add 12 eggs") share one key. That was already true on main: `applyPantryProposal`'s `failedActions` matches by name (`lib/api/chat.ts:336-338`), so a failure on one re-sends both. The card's reconcile effect also matches by name (`PantryProposalCard.tsx:217-225`). §2 inherits this and doesn't fix it. The PR body names it as an issue that already exists on main, and a follow-up should key actions by index or id.

## 11. Needs the human

None. All three fixes are reversible, within v1 scope and cost nothing beyond the **[model]** verify steps. The visible behaviour changes are:
- page navigation losing its (broken) exit fade (§9.7);
- real unit mismatches on a chat `use` becoming a clear refusal (§9.5);
- the parse prompt reserving `remove` for items that are gone (§9.8, a prompt change owing a live-model check).

The two follow-up issues in §10 are for the coordinator to file.

## Revision R1 (fresh review, all findings accepted)

| # | Where | Change |
|---|---|---|
| 1 | §0, §1, §5 | `update_recipe_cooked` returns `bool` (`False` on a miss). `meals_ai.py:383-402` builds `recipes_marked_cooked` from the truthy returns only, and `meals_ai.py` joins backend's files. New meal-route test: a side's recipe row missing gives 200, only the main is marked, and the claim closes |
| 2 | §2 | The different-unit branch derives the row's base from the displayed amount first, and uses the stored base only when that can't be derived (§9.4a). New test: the stale row (0.5 dozen, stored base 12) with "used 2 eggs" gives base 4 and display 0.3333 |
| 3 | §2, §8 step 2, §9.5 | Chosen: (a) the default `"item"` falls back to today's display subtraction (with a current base) when no base can be worked out, plus a clear, retryable refusal for real mismatches (the name stays last, so `failedActions` narrows to it, and the card's inline edit makes the retry meaningful). A "not retryable" flag was rejected. There's a behaviour-change line for the PR body, a parser guard test and a verify step for the refusal message |
| 4 | §2, §6, §8 step 2b, §9.8, §10 | `remove` deletes whatever the quantity. **Included here:** `prompts/pantry.py:18-19` reserves `remove` for items that are gone and makes `use` carry the amount used. It's logged as a prompt change with no fixture behind it, the live-model check is owed (step 2b), and there's a text-pin test. The residual `remove` risk is in §10 |
| 5 | §0, §1 | `deduct_pantry_item` returns `bool` of its update's rows, so a row deleted between read and write is skipped. New test |
| 7 | §8 step 1 | `verify` counts `/health/ai` (the chat page's `checkAIHealth` mount call) alongside `/v1/chat/stream`: 2 and 2 on main, 1 and 1 fixed. New step: from a scrolled `/pantry` into `/chat`, the page lands at the top |
| 8 | §4 | The #679 test isn't wrapped in `StrictMode`, and it says why (dev double effects would blur the mount count; StrictMode is already ruled out by the existing suites) |

## Revision R2 (fresh re-review, all findings accepted)

| # | Where | Change |
|---|---|---|
| 1 | §2, §5, §8 step 2, §9.5 | **Blocker.** A refused action had no editor on the card: `needsQtyEdit` fires only for a missing quantity or `"item"`, and it's frozen at mount. Frontend adds `forceEditor={isFailed}` on `ActionRow` (`showEditor = wasEverEditable \|\| needsQtyEdit(action) \|\| forceEditor`). Jest: a failed card with 1 handful spinach renders "Unit for spinach". The verify step edits in that editor and retries |
| 2 | §1 | **Blocker.** `test_issue_654_meal_cook.py:845` changes `update_recipe_cooked.return_value` from `None` to `True`, listed with the harness-only edits (otherwise 904 breaks). `test_cook_routes.py:181,242` returning `None` are harmless, because the single route ignores the return |
| 3 | §2, §9.5 | The fallback test is `normalize_unit(unit) in {"item", "count"}` (`item`, `items`, `piece(s)`, `each`, `""` and size adjectives). New test: "used 2 pieces" of carrots stored in grams takes the fallback (498 g), not a refusal |
| 4 | §2, §8 step 2b | The prompt's remove clause adds "or the user used all of it, the rest, or the last of it". Step 2b adds "I used all the eggs" → `remove` and "I finished the milk" → `remove`, marked [model] |
| 5 | §1 | The harness note is fixed: `deduct_pantry_item` reads its update result, so `test_pantry_deduction`'s `execute` returning `[row]` keeps `True`. `_PostgrestLikeClient`'s `update(...).execute()` returns the matched rows as `data` |
| 6 | §2 tests | The matcha 30 g test is reworded: the row's base derives, and it's the **used** amount (`item` to g) that can't |
| 7 | §9.4a | Notes that preferring the display amount discards a stored base that was supplied separately (e.g. a receipt-ingest pack weight) |

## Revision R3 (third review, all findings accepted)

| # | Where | Change |
|---|---|---|
| 1 | §2, §5, §6, §8 step 2, §9.5, §9.10 | **Blocker, already on main.** After a partial failure the card still renders every row and sends the full list on an edit, and `updateProposalActions` replaced the pending set with it, so Try again re-applied the rows that had already succeeded. The fix: (a) `updateProposalActions` keeps only names already pending; (b) `useChat` exposes `proposalFailedNames`, the page passes `failedNames`, and rows get `forceEditor={(isFailed \|\| isApproving) && failedSet.has(name)}` plus read-only for rows that already applied. The new hook test proves the retry carries only spinach. The §8 card step uses eggs + spinach and checks the eggs are used once. The PR-body line names the existing double-apply. `useChat.ts`/`chat/page.tsx` now overlap PR #607 / PR #617 (the second to land rebases) |
| 2 | §2 prompt | "as the user said it" is dropped. The `use` clause points to rule 3 ("item" when the user just counts), and the text test pins the new wording and rule 3 |
| 3 | §2 jest | The card test walks pending → failed ("Unit for spinach" = `handful`) → approving (still shown, disabled) → approved (gone) |
| 4 | §2, §9.9 | The editor stays open while a retry is approving, keyed off the persisted `failedNames` rather than a ref; the flicker was rejected |
| 5 | §1 | `test_cook_routes.py:271` is listed with 181 and 242 as harmless `None` returns |

## Revision R4 (fourth review, no blockers, all findings accepted)

| # | Where | Change |
|---|---|---|
| 1 | §6 | The PR #607 claim is corrected. It restores a partial-failed card with the original full action list as pending, so Approve after a reload re-applies the eggs, and filter (a) can't stop it. It's named as an issue PR #607 must handle before merging (persist partial failures). PR #617 is a stale draft that conflicts with `main`, overlapping on the file only |
| 2 | §2 | A thrown `applyPantryProposal` (the `catch`) sets `proposalFailedNames` to every pending key. The card treats `failedNames === undefined` as every row retryable (`retryable = k => !failedNames \|\| failedSet.has(k)`) |
| 3 | §2 | One key, `action.item.name.trim().toLowerCase()`, via a shared `proposalActionKey` helper, for the card, filter (a) and the failed-names write. The test fixtures use "Spinach", capitalised |
| 4 | §2 | `startNewChat` also clears `proposalFailedNames` |
| 5 | §10, PR body | Duplicate-name rows are out of scope, and named in the PR body as an issue that already exists on main |
| 6 | §2 jest | Hook tests: a thrown apply keeps every row retryable, and `startNewChat` clears the state. Card test: a failed card with `failedNames` undefined leaves every row editable |
