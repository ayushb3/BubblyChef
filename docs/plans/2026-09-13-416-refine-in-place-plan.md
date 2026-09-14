# Wire recipe-card follow-ups to refine-in-place (#416 AC1 / #266)

## Context

Testing the spaghetti flow surfaced that the **core acceptance criterion of #416
was never wired up**. #416 AC1: *"Picking a recipe then sending 'make it spicier' /
'add a fig glaze?' refines that recipe in place; it does not restart brainstorm."*
The #274 design (Q4) specifies the mechanism explicitly: *"Reuses `/v1/recipes/refine`
as the engine; new work is wiring chat to call it."*

What actually shipped on `feat/issue-416-classifier-primary-routing`: the classifier-primary
routing + confirm band + the #408 downgrade fix + pin-by-id + recipe-card render/reload
persistence. What did **not** ship: the refine-in-place engine wiring. This is Spec 0
/ #416, **not** Spec A (Spec A is the cook-flow amendment card, PR #360 — different surface).

**Ground truth (AI log, 2026-09-13):** a "something with tomato flavor instead maybe"
follow-up on a pinned recipe was classified `recipe_card, confidence=0.98` (correct — a
modification), then dispatched to `research_recipe → generate_grounded_recipe`, which builds
a **brand-new standalone recipe** from `selected_recipe_name or input_text` and **never reads
the pinned recipe**. Result: an unrelated dish, not a refinement.

Two distinct bugs, both hitting the same symptom the user saw:

1. **`recipe_card` follow-up generates new instead of refining** (#416 AC1 core). The
   dispatch graph routes `recipe_card` to `generate_grounded_recipe` (from-scratch), and the
   pinned recipe (`session.pinned_recipe_id`, `session.metadata.cooking_recipe`) is stored
   but never consulted by any generation node. There is no refine path in the chat graph.
2. **`preferred_ingredients` never reaches the LLM** (generation-nonsense). The user's
   requested flavor ("tomato") is extracted into `RecipeConstraints.preferred_ingredients`
   (`recipe/nodes.py:578-614`) but is used **only** to score pantry items (+5, `nodes.py:421,
   464-465`); it is absent from both the brainstorm builder (`nodes.py:804-837`) and the
   grounded `.format()` (`nodes.py:954-961`). So pantry-grounding dominates → buttered rice
   "mimicking" tomato.

**Outcome:** a modify follow-up on a pinned recipe refines *that* recipe in place (same
identity, updated card), reusing the existing `/v1/recipes/refine` engine; and an explicit
ingredient request ("tomato") actually reaches the generation prompt.

## Approach

The refine engine already exists and is battle-tested — `services/recipe_generator.py:382`
`generate_recipe(previous_recipe: RecipeCard)`, which switches to `RECIPE_FOLLOWUP_PROMPT`
(`:136-188`) and injects the prior recipe via `format_recipe_for_context` (`:255-279`,
emits title/description/ingredients-with-quantities/numbered-instructions). `/v1/recipes/refine`
(`api/routes/recipes_ai.py:126`) already calls it — but only the recipe-library modal hits
that endpoint; **chat never does.**

The engine needs a **full `RecipeCard`** (ingredients + instructions). The session today
pins only a partial `CookingRecipeSnapshot` (title + flat ingredient lines, no instructions).
Per the approved decision, **carry the full picked recipe in session** so the refine node
has it. `pinned_recipe_id` for an unsaved explored recipe is a session-local uuid that
`repo.get_recipe` won't find, so DB reload is not an option — the recipe must live in session.

### 1. Store the full picked recipe in session — `models/session.py`

Add a full-recipe field to `SessionContext` (line 57-68), alongside the existing partial
`cooking_recipe` snapshot (leave that — COOKING mode + prompt nodes still use it):

```python
class SessionContext(BaseModel):
    ...
    picked_recipe: RecipeCard | None = None   # full card for refine-in-place (#416 AC1)
```

`RecipeCard` round-trips as JSON in the `metadata` column (already how `SessionContext`
persists via `supabase_repo.py`). Verify `RecipeCard` serializes cleanly inside
`SessionContext.model_dump(mode="json")` (UUID + Ingredient nested models — should be fine).

### 2. Populate it at pin-time — `workflows/router.py:948-987`

In the `RECIPE_CARD` proposal-pin block in `update_session_node`, alongside the existing
`cooking_recipe` snapshot write, store the full recipe object:

```python
if recipe_obj is not None:
    session.metadata.picked_recipe = (
        recipe_obj if isinstance(recipe_obj, RecipeCard)
        else RecipeCard.model_validate(recipe_obj)
    )
```

(`recipe_obj = getattr(proposal, "recipe", None)` is already extracted at `:955`.)

### 3. Add a refine branch on the `recipe_card` follow-up — `workflows/router.py` + `recipe/nodes.py`

The decision "is this a refinement of a pinned recipe vs. a first pick from brainstorm" is:
**`intent == recipe_card` AND `session.metadata.picked_recipe` is set**. First pick (no prior
pinned recipe) keeps the current `research_recipe → generate_grounded_recipe` path; a refine
(pinned recipe present) routes to a **new refine node**.

- In `route_by_intent` (`router.py:662`, the `RECIPE_CARD` arm at `:696-698`): return
  `"refine_recipe"` when a `picked_recipe` exists in session, else keep `"research_recipe"`.
  (Read session the same way nodes do: `state["session"]["metadata"]["picked_recipe"]`.)
- New node `refine_recipe_node` in `recipe/nodes.py` (near `generate_grounded_recipe`):
  loads `picked_recipe` from session, calls the **existing** `generate_recipe(prompt=input_text,
  pantry_items=…, ai_manager=…, previous_recipe=picked_recipe)` — do not reimplement the
  prompt. Wraps the result into the same `RecipeCardProposal` envelope
  `generate_grounded_recipe` emits, preserving the recipe **id** so identity is stable
  (in-place replacement, Q4). Set an "updated" marker in metadata for the UI (Q4 lightweight
  indicator) — check what the frontend reads; if nothing yet, emit `metadata.refined = true`
  and leave the UI marker as a noted follow-up rather than expanding scope.
- Register the node + edge in the graph builder (`router.py:1213+`, `_route_map` at `:1224`,
  edges at `:1275-1286`): `refine_recipe → END` (it produces a terminal card like grounded).

### 4. Feed `preferred_ingredients` into the generation prompts — `recipe/nodes.py`

Bug 2, independent of the refine wiring:
- **Grounded** (`nodes.py:954-961` + template `:180-225`): add a `preferred_ingredients`
  kwarg to the `.format()` call and a placeholder line in `GROUNDED_RECIPE_SYSTEM_PROMPT`
  (e.g. `Preferred flavors/ingredients (include if sensible): {preferred_ingredients}`).
  Source from `constraints.preferred_ingredients`.
- **Brainstorm** (`nodes.py:804-837`): add `preferred_ingredients` to the `constraints_str`
  builder so brainstorm ideas honor the requested flavor.
- The refine path (§3) sends `input_text` straight to `RECIPE_FOLLOWUP_PROMPT` as the change
  prompt, so "tomato" reaches the LLM verbatim there regardless — but fixing the grounded/
  brainstorm builders repairs the first-pick and new-generation cases too.

## Out of scope

- The lightweight "updated" UI indicator (Q4) beyond an envelope flag — note it, don't build
  the frontend marker in this pass unless the render branch already supports it trivially.
- Cross-session refine (pinned recipe is session-local by design, #415).
- COOKING-mode amendments (`_detect_amendment`, #279) and the `CookingAmendmentCard` — that's
  Spec A PR #360, a different surface.
- Persisting `picked_recipe` to `conversation_history` per-message (reload persistence already
  shipped for the render; refine after a cold reload of an unsaved recipe is a known gap).

## Verification

Backend (primary checkout has the env — this is `ai-service/`):

```bash
cd ai-service && ./scripts/mypy_gate.sh          # 0 new
cd ai-service && ruff check bubbly_chef/
cd ai-service && pytest tests/ -k "classify_intent_416 or constraint_inheritance or brainstorm_followup or chat_router"
```

New tests:
- `test_classify_intent_416.py` — extend the pinned-session fixture (`:607-627`) with
  `metadata.picked_recipe` set; assert a `recipe_card` follow-up routes to `refine_recipe`,
  and a `recipe_card` first-pick (no picked_recipe) still routes to `research_recipe`.
- `test_constraint_inheritance.py`-style node test — `refine_recipe_node` with a stubbed
  `generate_recipe`, assert it passes `previous_recipe` and preserves the recipe id.
- A `preferred_ingredients` test: constraints carry `["tomato"]`, assert the string reaches
  the grounded/brainstorm prompt (patch/inspect the prompt passed to the LLM stub).

End-to-end (the actual gate — needs backend restart):

1. Ask "recipe for creamy garlic spaghetti" → recipe card renders and is pinned.
2. Send "something with tomato flavor instead" → **Expect:** the SAME dish, refined toward
   tomato (recognizably a modification of the spaghetti, tomato present), NOT a new unrelated
   dish. Card replaces in place, same identity.
3. Send "make it spicier" → refines again in place.
4. Ask a fresh "give me a pad thai recipe" (recipe_generation) → still a single new recipe
   (didn't regress #408).
5. Confirm `tail -f ai_service.log` shows the `recipe_card` follow-up hitting the refine node,
   not `generate_grounded_recipe`.

## Branch / PR

Rides `feat/issue-416-classifier-primary-routing` (PR #436) — this completes #416's AC1, the
ticket the branch is for. Backend-only + tests; gate before pushing. Human owns the merge.
