# Issue #544: chat refine keeps the diet, the contract

One backend PR. Its body carries **`Fixes #544`** on its own line.

- **Issue #544**, *Chat refine: tweaking a picked recipe ignores the user's stored dietary preferences* (open, v1, priority med). "Make it spicier" on a vegetarian's pinned recipe can bring meat back, because the refine path never passes the diet to the model.

**Branch:** `fix/issue-544-refine-diet`, off `main`. It was split out of the meal/chat polish contract (`2026-09-30-meal-chat-polish-contract.md`, R3). **Either order works with the polish PR; whichever lands second rebases** (§6). Copy this file to `docs/plans/2026-09-30-issue-544-refine-diet-contract.md` in the PR.

It's backend only (`ai-service/`), with no frontend change and no migration. Checked on `origin/main` at `94c0a84`.

**The design in one line (R4):** a refine **remembers** the diet decision the first turn already made, instead of re-guessing it from ingredient names.

## 0. What exists

- **The refine paths:**
  - `workflows/recipe/nodes.py:1449` `refine_recipe_node` calls `_generate_recipe_followup` (the alias of `generate_recipe`, 48) at 1496-1503 with **no `constraints`**. The refined card is `result.recipe.model_copy(update={"id": previous_recipe.id})` (1535).
  - `api/routes/recipes_ai.py:127-160` `POST /v1/recipes/refine` (the library's `RecipeRefinementModal`) builds `RecipeCard(**request.recipe)` and passes no constraints either.
- **The generator.** `services/recipe_generator.py:279` `generate_recipe`.
  - Its follow-up branch (316-322) formats `RECIPE_FOLLOWUP_PROMPT` with no diet.
  - `AIRecipeOutput` (31-51) has **no `dietary_tags`**, and the card is built from it at 386-399. **A refined card therefore always loses its tags**, so anything tag-based would protect only the first refine (review 4, blocker 1).
- **The prompt.** `prompts/recipe.py:248` `RECIPE_FOLLOWUP_PROMPT` has no dietary slot. "Modify the recipe according to the user's request." is at 261, and "Example of what to return:" (a chicken stir-fry) at 270. No test or recorded fixture reads this prompt's text.
- **The first-turn decision (#394).**
  - `extract_recipe_constraints` (890-905) combines stored preferences with this turn's through `_combine_dietary_preferences` (787-825). Its loop (~804-812) drops a stored label when `_dietary_contradicted(label, haystack)` (766) finds a term from `_DIETARY_FORBIDDEN_INGREDIENTS` (728) in the message plus its extracted ingredients.
  - `research_recipe` (1146) runs on **every** card path: extract → score → research → generate on the direct path (`router.py:1646-1659`), and research → generate on the brainstorm pick.
    - Its stored-diet fallback (**1173-1180**, a second caller of `get_stored_dietary_preferences`) re-applies the stored preferences whenever `dietary` is empty.
    - **That's a first-turn bug.** On the direct path, "chicken curry" with stored Vegetarian: extract sets Vegetarian aside, leaving `dietary == []`, and then research puts it straight back. The card is generated **under** Vegetarian.
    - **The pick path has the same bug.** A "chicken ideas" brainstorm persists `dietary == []` (`router.py:1153-1155`), and on a "Chicken Tikka" pick research re-applies Vegetarian.
    - **Why a pick can't just trust the session.** The #394 design (d5966623; `router.py:1145-1152, 1213-1216`) is that a set-aside diet **reasserts itself** once a message stops contradicting it. Rehydrated constraints can also be stale, or written by research or cooking-help (`router.py:1217-1221, 1424-1426`). So a pick re-checks the diet itself (§3).
  - `generate_grounded_recipe` (1192) builds the card at 1335-1350, with `dietary_tags` from the model.
- **Every card path that can reach refine is covered.** Only the RECIPE_CARD branch sets `picked_recipe` (`router.py:1208`), and refine reads only `picked_recipe`, so every refinable card came through `research_recipe`. The other pins never reach refine, so their default `[]` is safe:
  - meal dish cards;
  - saved-recipe pins (`pinned_recipe_id` only, 1393);
  - cook pins (`cooking_recipe`, 1110).
- **Serialisation of a card:**
  - `SessionContext.picked_recipe: RecipeCard | None` (`models/session.py:93, 110`), set at `router.py:1208`. The session is stored as JSON, so a new field with a default round-trips, and an old session still validates.
  - `RecipeCard` (`models/recipe.py:242`) has no `extra="forbid"`.
  - The frontend's card types ignore unknown keys: no runtime validation, no zod.
  - Both save paths whitelist columns (`app/api/recipes/route.ts:140-166`, `supabase_repo.py:505+`), so a new field is never written to the `recipes` table.
- **Persistence:** `update_session_node` saves `state["recipe_constraints"]` on a recipe-card turn (`router.py:1217-1221`).
- **Test patching:** `services/dietary_preferences.py:26` `get_stored_dietary_preferences` reaches its own `get_repository`. These tests don't patch it: `test_refine_recipe_node.py` (87, 121), `test_issue_514_recipe_error_kind.py:79` and `test_recipes_ai_routes.py:96-114`.

## 1. The rule

**`labels`** is the stored preferences followed by `prior["dietary"]` (the conversation's), de-duplicated case-insensitively.

**Chat refine.** Keep every label **except**:
1. **(i)** labels in `previous_recipe.diets_set_aside`, which the first turn (or an earlier tweak) already set aside;
2. **(ii)** labels the tweak text **adds** a forbidden food for (§2).

The refined card carries `diets_set_aside = previous_recipe.diets_set_aside ∪ (ii)`, so the decision survives every later tweak.

**Library refine** (`/v1/recipes/refine`: no session, no carried field). Keep every stored label **except**:
- (ii), on the tweak text;
- labels whose forbidden food appears in the saved recipe's **`ingredients[].name`** (not the title), checked with the existing `_dietary_contradicted`. That's the same matcher production already runs on request text.

  **Unless** a `tags` or `dietary_tags` entry on the row names the label (case-insensitive, `re.sub(r"[\s_]+", "-", …)` on both sides). A tag keeps the label, which covers the matcher's misfires on tagged rows.

**No previous recipe** (`recipe: {}`): every stored label is kept except (ii).

## 2. "The tweak adds a forbidden food" (ii)

- **The matcher is the existing `_dietary_contradicted`**, with `_DIETARY_FORBIDDEN_INGREDIENTS` unchanged. There's no widened table, stem helper, modifier list or exception list.
- **What changes is the text it sees.** It runs on the tweak with the negated spans removed, by a small pure helper `added_text(tweak: str) -> str` in `workflows/recipe/refine_diet.py`, the only content of that new module.
- **`added_text`:**
  - Strip every `\w+[- ]?free` span first ("dairy free", "meat-free", "gluten-free").
  - Split into clauses at `.,;!?` and the word "but".
  - Within a clause, a negation removes the rest of the clause. The negation words: `no`, `without`, `remove`, `don't`, `avoid`, `leave out`, `skip`, `hold`, `take out`, `drop`, `lose`, `minus`, `less`, `fewer`, `cut`.
  - `instead of` removes only up to the next `use`, `add`, `try` or `with`, or the clause end. So "use chicken instead of tofu" and "instead of tofu use chicken" both keep "chicken", and "tofu instead of chicken" drops it.
  - `(swap|replace) X (with|for) Y`: X is removed and Y is kept (X out, Y in).
  - `(substitute|\bsub\b) … for …` removes the phrase up to the next `and`, `then` or the clause end, so neither side counts as an add. The direction of "substitute" is ambiguous in everyday speech. `sub` matches only as a whole word, never inside "submarine" or "subtle".
- **A label the tweak names is never set aside.** Compare the normalised label (§3) against the normalised tweak: "make it dairy free" keeps Dairy-free, whatever else it matches. This also overrides (i): "make it vegetarian" after a chicken first turn sends Vegetarian for that reply even though the card still carries it in `diets_set_aside` (approved by the coordinator; the card's carried list is unchanged, so a later tweak that doesn't name the diet is back to setting it aside).
- **Exclusions use the same text.** `excluded` starts from `prior["excluded_ingredients"]`. An entry is dropped when `\b<entry>\b` (case-insensitive) is in `added_text(tweak)`, or in the previous recipe's ingredient names (so an item added on an earlier tweak isn't taken out on the next one). On the library path there's no `prior`, so no exclusions.

## 3. The changes

- **`models/recipe.py`:** `RecipeCard.diets_set_aside: list[str] = Field(default_factory=list, description="Stored diets this card was made without (issue #544); internal, never saved to the recipes table")`.
- **`workflows/recipe/nodes.py`:**
  - **The first turn records its decision, with one definition in one place.** At the **end of `research_recipe`**, on every path, after its constraints are final:
    - `diets_set_aside` = the stored labels not covered by the final `constraints["dietary"]`;
    - compared through `_norm(s) = re.sub(r"[\s_-]+", "-", s.strip().lower())`, so case, spaces and hyphens don't matter;
    - a stored label also counts as covered when a final label subsumes it (`_DIETARY_SUBSUMES`: a final Vegan covers a stored Vegetarian);
    - it's written to `state["dietary_set_aside"]`. Nothing overwrites it with `[]`.
  - **`extract_recipe_constraints`** sets a marker `state["constraints_extracted"] = True`. It's per-turn state and never persisted. It changes nothing else, and `_combine_dietary_preferences` is untouched (no `_set_aside_labels` refactor; it isn't needed).
  - **`research_recipe`'s stored-diet fallback** (1173-1180) is replaced by two cases:
    - **`constraints_extracted` is set (the direct path):** research leaves `dietary` alone, because extract already combined the stored diet with this turn's message.
    - **Not set (a pick turn, or the defensive case):** research runs `dietary = _combine_dietary_preferences(stored, rehydrated_dietary, {}, recipe_name)`.
      - The picked name (`selected_recipe_name`, else `input_text`) is the **only** text checked.
      - It passes `{}` rather than the constraints, so a stored `must_use_ingredients` of chicken from the brainstorm turn doesn't count as the pick naming chicken.
      - `_combine_dietary_preferences` itself is unchanged.
    - **Results:**
      - a "Chicken Tikka" pick sets Vegetarian aside;
      - "gluten-free chicken ideas" then a chicken pick gives `["Gluten-free"]`, with Vegetarian set aside;
      - the defensive case (nothing rehydrated, a non-contradicting name) applies Vegetarian, as today;
      - a "Tofu Stir-Fry" pick after a "chicken or tofu ideas" brainstorm gets Vegetarian back (the #394 reassertion).
    - **This is a first-turn behaviour fix, stated in the PR body.** A Vegetarian set aside for "chicken curry" (direct) or a "Chicken Tikka" pick is no longer re-applied, so neither card is generated under Vegetarian.
    - The stored preferences are read on **every** `research_recipe` call, once, for both the diet and the definition. §4 lists the suites that gain the patch because of this.
  - `generate_grounded_recipe` stamps `diets_set_aside=state.get("dietary_set_aside") or []` on the card (1335).
  - **`workflows/state.py`** gains `dietary_set_aside: list[str]` and `constraints_extracted: bool`.
  - **Examples of the one definition:**
    - "vegan mac and cheese" with stored Vegan: extract sets the stored label aside (it names cheese), but the turn's own `["Vegan"]` stays in `dietary`, so it's covered and `diets_set_aside == []`.
    - "gluten-free chicken ideas" with stored Vegetarian, then a chicken pick: the pick's combine sets Vegetarian aside, the final diet is `["Gluten-free"]`, and the card has `diets_set_aside == ["Vegetarian"]`.
  - **New public `async def refine_dietary_constraints(user_id, input_text, prior, previous_recipe, *, library: bool = False) -> tuple[dict[str, Any], list[str]]`.**
    - It returns the constraints for the generator (`{"dietary": kept, "excluded_ingredients": excluded}`, omitting empty keys) and the labels set aside this turn.
    - It stays in this module, so the **single patch target** is `bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences`. That target also covers `research_recipe`'s call at 1174.
  - **`refine_recipe_node`:**
    - passes the constraints to the generator;
    - builds the refined card with `model_copy(update={"id": previous_recipe.id, "diets_set_aside": previous_recipe.diets_set_aside ∪ set_aside_now})`, de-duplicated case-insensitively;
    - **must not write `state["recipe_constraints"]`** (`router.py:1217-1221` would persist a one-reply set-aside), and returns it exactly as it came in.
- **`services/recipe_generator.py`:**
  - new `format_followup_dietary(constraints) -> str`: `""` when there's neither list; otherwise `"\n## Dietary Requirements\n- Dietary requirements: {dietary}\n- Never use: {excluded}\nThe modified recipe must still meet these, even if the request doesn't mention them.\n"`, with each line only when its list is non-empty;
  - the follow-up branch passes `dietary_requirements=format_followup_dietary(constraints)`.
- **`prompts/recipe.py`, `RECIPE_FOLLOWUP_PROMPT`:**
  - `{dietary_requirements}` goes right after "Modify the recipe according to the user's request." (261);
  - "Example of what to return:" (270) becomes "Example of the output format only (not a recipe to copy):".
- **`api/routes/recipes_ai.py` refine:**
  - It calls `refine_dietary_constraints(user_id, request.prompt, None, previous_recipe, library=True)` and passes the constraints on.
  - Before building the card, it maps `tags` (strings only) to `dietary_tags` when `dietary_tags` is absent or empty, as `recipe_card_from_row` does (`workflows/meal/fixed_main.py:141, 171`). The tag check reads `dietary_tags`.
  - The route returns no `diets_set_aside`: the library has no session to carry it.

## 4. Tests

The only patch target is `bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences`. A set-aside diet is asserted as `"dietary" not in constraints`.

**First-turn tests run the real node order.** Either:
- extract → score_pantry → research_recipe → generate_grounded_recipe, each fed the previous node's returned state;
- or the compiled graph.

`search_recipe` and the model are stubbed. The generator stub records the `constraints` it was called with, so "not generated under Vegetarian" is an assertion on that call.

**`tests/test_issue_544_refine_dietary.py`** (new):
- **Two chat turns keep the diet:**
  - a vegetarian card (tagged, and again untagged) with stored Vegetarian, then "make it spicier" and "make it heartier": both refines send `dietary == ["Vegetarian"]` **(fails on main: no `constraints` kwarg)**;
  - the second refine uses the first refine's returned card, whose `dietary_tags` are empty, which proves the fix doesn't depend on tags.
- **The first turn's set-aside carries:**
  - "chicken curry" through the full order with stored Vegetarian: the generator is called **without** Vegetarian **(fails on main: research re-applies it)**, and the card has `diets_set_aside == ["Vegetarian"]`;
  - then "make it spicier" gives `"dietary" not in constraints`;
  - the refined card still carries it, and the next tweak ("make it quicker") too.
- **The one definition, via the full order:**
  - "vegan mac and cheese" with stored Vegan, the constraint-extraction model stubbed to return `dietary: ["Vegan"]`: extract sets the stored label aside, the turn's `["Vegan"]` stays in the final diet, `diets_set_aside == []` (covered by the final diet, not by "nothing dropped"), and a following "make it creamier" refine sends `dietary == ["Vegan"]`;
  - "gluten-free chicken ideas" with stored Vegetarian, then a "Gluten-Free Chicken Stir-Fry" pick (research → generate from the persisted session): the final diet is `["Gluten-free"]`, and the card has `diets_set_aside == ["Vegetarian"]`;
  - session `dietary == []`, stored Vegetarian, a "Chicken Tikka" pick: the generator is called without Vegetarian **(fails on main)**, and `diets_set_aside == ["Vegetarian"]`;
  - session `dietary == []`, stored Vegetarian, a "Tofu Stir-Fry" pick: the generator **is** called with Vegetarian (the #394 reassertion);
  - session `dietary == ["Gluten-free"]`, stored Vegan, a non-contradicting pick ("Rice Noodle Salad"): the final diet holds both, and `diets_set_aside == []`. Assert it as a set, or as `["Vegan", "Gluten-free"]`: `_combine_dietary_preferences` puts the surviving stored labels first;
  - a session whose `must_use_ingredients` is `["chicken"]`, stored Vegetarian, a "Tofu Stir-Fry" pick: Vegetarian is kept (the `{}` argument);
  - no session constraints and no extract (the defensive case): the stored Vegetarian is applied, and `diets_set_aside == []`.
- **(ii):**
  - "add bacon" on a vegetarian card sets it aside, and the refined card's `diets_set_aside` includes it;
  - "substitute tofu for the chicken" keeps Vegetarian;
  - "swap the chicken for tofu" keeps it, and "swap the tofu for chicken" sets it aside;
  - "no more cheese please" keeps Vegan;
  - "use chicken instead of tofu" sets Vegetarian aside, and "tofu instead of chicken" keeps it;
  - "skip the chicken" on a vegetarian card keeps Vegetarian;
  - "make it dairy free" with stored Dairy-free keeps it (named by the tweak, and the `-free` span is stripped).
- **`added_text`** (pure) covers each rule above, plus:
  - clause scope: "no chicken, but add bacon" keeps "add bacon";
  - each new negation word (skip, hold, take out, drop, lose, minus, less, fewer, cut);
  - "substitute tofu for chicken and add bacon" keeps "add bacon";
  - "add a submarine roll" isn't treated as `sub`.
- **Exclusions:**
  - excluded "peanuts" with "add peanuts": dropped;
  - "no peanuts please": kept;
  - a previous recipe containing "peanuts": dropped;
  - "make it spicier" on a peanut-free card: kept.
- **Not persisted:** after a refine that sets Vegetarian aside, `recipe_constraints` is returned unchanged. Through `update_session_node`, the session's `recipe_constraints.dietary` still reads `["Vegetarian"]`.
- **Round trip:** a session holding a `picked_recipe` with `diets_set_aside` survives `model_dump(mode="json")` and `model_validate`. A session without the field validates with `[]`.
- **Library route:**
  - `recipe: {}` with stored Vegetarian: the prompt contains "Dietary requirements: Vegetarian" **(fails on main)**;
  - a saved chicken recipe with "make it quicker": `"dietary" not in constraints`;
  - a saved tofu recipe: kept;
  - a row tagged "vegetarian" whose ingredients include "tempeh bacon" (the existing matcher misfires on `bacon`): kept, via the tag.
- **Generator:** `generate_recipe(previous_recipe=…, constraints={"dietary": ["Vegan"], "excluded_ingredients": ["peanuts"]})` builds a prompt with "Dietary requirements: Vegan" and "Never use: peanuts" after "Modify the recipe according to the user's request." **(fails on main)**. With no constraints, the prompt has no "Dietary Requirements".

**Existing tests** gain the patch `AsyncMock(return_value=[])`. Their assertions are unchanged, and the PR body names the change:
- `test_refine_recipe_node.py`;
- `test_issue_514_recipe_error_kind.py`;
- `test_recipes_ai_routes.py:96-114`;
- because `research_recipe` now reads the stored diet on every call, these gain it too, for hermeticity (without it they'd reach `get_repository`):
  - `test_constraint_inheritance.py`;
  - `test_issue_336_recipe_card_expiry_coherence.py`;
  - `test_classify_intent_416.py`;
  - `test_issue_650_meal_from_chat.py`.

**Guards that must pass unmodified:**
- `test_dietary_preferences.py` (#394). `_combine_dietary_preferences` is untouched. The only research change a test there could see is a pick whose name contradicts the stored diet: that's the behaviour this PR fixes, so update any such test and name it in the PR body;
- `test_issue_651_meal_pills.py` and `test_issue_651_make_it_a_meal.py`;
- `test_session_round_trip.py`.

`test_constraint_inheritance.py` moved to the patched list above. Its assertions must still pass unmodified.

**Gates:** `cd ai-service && pytest && ruff check bubbly_chef/ && ./scripts/mypy_gate.sh`. Each **(fails on main)** test must be seen red on the base `main` first.

## 5. `verify` (every step needs a live model)

Gemini is over its spending cap and there's no local Ollama. If no model is available, the PR body says so and points to §4.

1. Set the profile to Vegetarian. Ask for a vegetarian dish in chat, then "make it spicier", then "make it heartier": no meat in either refine. Then "add bacon": bacon is allowed, and the next tweak keeps it allowed.
2. Ask for a chicken curry (the first turn sets Vegetarian aside): the first card is a real chicken curry, not a vegetarian version (the first-turn fix). Then "make it spicier": still chicken.
3. In the recipe book, refine a saved tofu recipe with "add more protein": no meat.

## 6. Overlaps

| File | Other work | Rule |
|---|---|---|
| `workflows/recipe/nodes.py` | The polish PR deletes `_default_meal_type` and its fills (issue #408, ~658-665, 878-881, 982-988) | Separate hunks. The `extract_recipe_constraints` marker is at ~905, below the polish PR's 878-881 hunk; the `research_recipe` edit is at 1146-1190. The second to land rebases |
| `prompts/recipe.py` | The polish PR edits both brainstorm prompts (59-60, 84-85) | Separate from `RECIPE_FOLLOWUP_PROMPT` (248+) |
| `models/recipe.py`, `workflows/state.py` | PR C (issue #651 PR C) adds two `state.py` fields after 172 | Additive |
| `test_recipes_ai_routes.py`, the refine suites | Nothing else in flight | — |

There's no classifier prompt change, so no fixture re-capture.

## 7. Reversible product calls (log each in the sprint doc)

1. **Remember, don't re-guess** (R4, the coordinator's call). The first turn's #394 decision is carried on the card as `diets_set_aside`, and a refine changes it only when the tweak adds a forbidden food. *Rejected:* tag-first plus an ingredient regex, which took four review rounds and still misfired on common vegetarian food (cauliflower steak, oyster mushrooms, butter beans, flax egg, tempeh bacon, "Jackfruit Pulled Pork").
2. **The existing matcher is reused unchanged**, with only a small clause-scoped negation pre-pass. *Rejected:* a refine-only widened table with stems and modifier lists (R3), for the same reason.
3. **"Substitute … for …" counts as neither side added.** *Rejected:* guessing its direction, which people use both ways.
4. **The library route checks ingredient names, not the title, and a tag keeps the label.** *Rejected:* keeping every stored diet there, which would force Vegetarian onto a saved chicken recipe on every library refine.
5. **Prompt:** the dietary block sits right after "Modify the recipe…", and the example is labelled format-only. *Rejected:* after the pantry block, where it reads as context.
6. **Research re-checks the diet on a pick instead of blindly re-applying it** (R6, a first-turn change). On the direct path it trusts extract; on a pick it runs `_combine_dietary_preferences(stored, rehydrated, {}, picked name)`, so a set-aside diet comes back once the pick stops contradicting it (the #394 design). *Rejected:*
   - the fallback on every empty `dietary`, which generates a chicken curry under Vegetarian;
   - skipping the fallback whenever session constraints were rehydrated (R5), which drops diets unsafely: a set-aside Vegetarian never reasserts on a tofu pick, and stale or research/cooking-help-written constraints would decide the diet.
7. **`diets_set_aside` has one definition, computed at the end of `research_recipe`** (stored labels not covered by the final diet). *Rejected:* recording the #394 loop's drops in extract (R4), which disagreed with the final diet ("vegan mac and cheese") and missed the pick path.
8. **Stored and conversational diets both apply to the refine.** Refine never persists `recipe_constraints`, so a diet set aside for a refine isn't saved into the session. *Rejected:* stored only, which would drop a "make it vegan" said two turns ago.

## 8. Out of scope

- **Re-adding a diet automatically.** After "add bacon" or a chicken first turn, a later "swap the chicken back for tofu" doesn't restore Vegetarian. The user can say "make it vegetarian".
- **A diet asked for during a refine** ("make it vegan") shapes that reply but isn't persisted into `recipe_constraints`, because refine never writes it. It isn't added to the card either.
- **Library misfires:** the existing matcher's known misses, such as "tempeh bacon", "veggie sausage", "coconut milk" (vegan) and "peanut butter" (dairy-free), drop a diet on some untagged saved recipes. The refine modal has a Save step, so the user sees the result before keeping it. (The reviewer's "oyster mushroom" isn't in the existing table, so it doesn't misfire.)
- **Cards without `diets_set_aside`** (an older session, or a card pinned from elsewhere) behave as `[]`: every stored diet is kept unless the tweak adds a forbidden food.
- **Carrying `dietary_tags` onto refined cards** (`AIRecipeOutput` has none). Not needed by this design.
- **Plurals in exclusions** ("peanut" versus "peanuts"): exact word match only.
- **Allergies** (issue #500).

## 9. Needs the human

None. It's a reversible v1 bug fix with no cost beyond the verify steps' model calls.

## Revision R4

| Item | Change |
|---|---|
| Design | Rewritten to "remember, don't re-guess". `RecipeCard.diets_set_aside` records the first turn's #394 set-aside (via `_set_aside_labels`, extracted from `_combine_dietary_preferences` with byte-identical behaviour) and carries across refines. Refine keeps every label except those, plus labels the tweak adds a forbidden food for |
| Blocker 1 | Tags are lost on refined cards (`AIRecipeOutput`); the chat path no longer depends on tags |
| Blocker 2 | Rule (c)'s ingredient regex is gone from chat. The library route uses the existing matcher on ingredient names, a tag keeps the label, and the misses are listed in §8 |
| Removed | The widened table, the stem helper, the modifier and exception lists and the implies map. `refine_diet.py` now holds only `added_text` |
| Kept | No write-back (§7.6 narrowed; §8 lists refine-time asks), exclusions (same simple matcher), prompt placement, the `recipe: {}` path, the single patch target (it also covers `research_recipe`:1174) |
| Tests | Two-turn keep, carried set-aside, "add bacon", "substitute tofu for the chicken", "no more cheese please", the three library cases, and the session round trip |
| Verify | Step 1 matches the new rule; step 2 is the chicken first-turn carry |
| Serialisation | Checked: the session round-trips the new field, old sessions default it, the frontend ignores unknown keys, and both save paths whitelist columns |

## Revision R5

| Item | Change |
|---|---|
| 1-3 (blockers) | `diets_set_aside` has one definition, computed at the end of `research_recipe` on every path: stored labels not covered by the final `constraints["dietary"]` (case, space and hyphen-insensitive; a subsuming Vegan covers Vegetarian). `_set_aside_labels` is dropped. The fallback change is stated as a first-turn fix (§3, §7.6-7). The fallback gate itself was replaced in R6 |
| Disagreement (superseded by R6) | R5 widened the gate to skip rehydrated constraints, because a "chicken ideas" pick would re-apply Vegetarian. Review 6 showed that drops diets unsafely; R6 re-checks the pick name instead |
| 4 | `added_text` strips `\w+[- ]?free`, and adds skip, hold, take out, drop, lose, minus, less, fewer and cut. A label the tweak names is never set aside |
| 5 | First-turn tests run the real node order or the compiled graph. Added: "vegan mac and cheese", the gluten-free pick, the "chicken ideas" pick, the defensive fallback, "make it dairy free", "skip the chicken", and the full-order chicken curry, which isn't generated under Vegetarian |
| 6 | `substitute … for …` ends at and/then; `\bsub\b` is a whole word; SessionMetadata becomes SessionContext |
| 7 | §0 states card-path coverage: only the RECIPE_CARD branch (1208) sets `picked_recipe`; meal dish cards, saved pins (1393) and cook pins (1110) never reach refine |
| Verify | Step 2 now checks that the first card is a real chicken curry |

## Revision R6

| Item | Change |
|---|---|
| 1 | R5's widened gate is withdrawn. Without `constraints_extracted` (a pick), research runs `_combine_dietary_preferences(stored, rehydrated_dietary, {}, recipe_name)`: the picked name is the only text checked, with `{}` so a stored must_use of chicken doesn't count. A Chicken Tikka pick sets Vegetarian aside, a Tofu Stir-Fry pick gets it back, and the defensive case applies it. §0, §3, §7.6 and the R5 row are updated |
| 2 | Tests added: `[]` session plus a Tofu Stir-Fry pick → generated with Vegetarian; `["Gluten-free"]` session, stored Vegan, a non-contradicting pick → both kept and `diets_set_aside == []`; the stored must_use chicken case |
| Note on 2(b) | `_combine_dietary_preferences` puts surviving stored labels first, so the list is `["Vegan", "Gluten-free"]`, not `["Gluten-free", "Vegan"]`. The test asserts a set, or that order |
| 3 | The "vegan mac and cheese" test states its extraction stub (`dietary: ["Vegan"]`), so it tests "covered by the final diet" |
| 4 | `research_recipe` reads the stored diet on every call. `test_constraint_inheritance.py`, `test_issue_336_recipe_card_expiry_coherence.py`, `test_classify_intent_416.py` and `test_issue_650_meal_from_chat.py` gain the patch target, with assertions unchanged |

## Revision R7 (code-review fix round)

| Item | Change |
|---|---|
| Negations | `added_text` also treats `not`, `never`, `dont`, `do not`, `exclude`, `omit`, `get rid of` and `take away` as negations |
| Plant-based (product call, §7.9) | `added_text` strips plant-based phrases before matching: `(coconut\|oat\|almond\|soy\|cashew\|rice\|hemp\|pea\|plant-based\|vegan\|dairy-free\|non-dairy)` + `(milk\|cream\|butter\|cheese\|yogurt\|yoghurt\|mayo\|mayonnaise)` (before the `-free` strip), and `(vegan\|veggie\|vegetarian\|plant-based\|meatless\|mock\|faux\|tofu\|tempeh\|seitan)` + the next word (per clause, after the swap/substitute/instead-of/negation rules so "substitute tofu for chicken" still parses). Refine-only: `_DIETARY_FORBIDDEN_INGREDIENTS`, `_dietary_contradicted` and the #394 first-turn path are unchanged |
| Library tags | The refined card gets the saved recipe's `dietary_tags` when the generator returns none (minus tags the tweak set aside or contradicts), so a second library refine still finds the tag. The route's response excludes `diets_set_aside` |
| Tag rescue | A stricter tag keeps the looser labels it subsumes (`_DIETARY_SUBSUMES`): a "vegan" tag keeps a stored Vegetarian |
| Names the label | The "tweak names the label" check is a whole-word match and ignores a preceding `non-`, `non `, `not ` or `no longer `: "make it non-vegetarian, add chicken" sets Vegetarian aside |
| Prompt | The follow-up template is `request.{dietary_requirements}`, so an empty block renders the pre-#544 prompt exactly |

### §7.9 Tweak set-asides are carried on the card (product call)

An explicit "add bacon" sticks: the card carries Vegetarian in `diets_set_aside`, so later tweaks don't push the diet back onto a dish the user deliberately made off-diet. Plant-based phrases ("oat milk", "tempeh bacon") don't count as adding the food they imitate. *Rejected:* not carrying tweak set-asides, where a later tweak would force the diet back onto a dish the user deliberately made off-diet.
