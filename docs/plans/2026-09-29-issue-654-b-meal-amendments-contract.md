# Issue #654, PR B: mid-cook amendments per dish, the contract

PR B of two for issue #654, *Finish a meal: per-dish mid-cook amendments, one combined deduction sheet, one cook + meal bonus*. This PR adds the mid-cook amendments: Ask Bubbles on the Now card, pinned to that card's dish, with an applied amendment stored per dish in the meal cook session. The PR body says **`Fixes #654`**: with PR A (the combined deduction and finish flow, `Related to #654`) already merged, this closes the issue.

**PR B only writes into a slot PR A already reads.** PR A's deduction reads each dish's amendment through `readDishAmendment`. This PR adds the writer (`withDishAmendment`), the UI that produces an amendment, and the two backend router changes that make the model detect one. Nothing about the deduction, the confirm, the proxies or bubbles changes here.

The slices:
- **backend:** ai-service;
- **frontend:** Next.js `app/` pages, `lib/`, `types/`;
- **ui-ux:** `components/`.

The parent spec is issue #647, *Spec: Dinner, planned — the meal engine (Goal 1)*: its "Chat and meal UI" section (Ask Bubbles mid-cook). Where this doc is silent, the issue's rules apply, then the spec's. Wire fields are snake_case. Everything was checked against `main` at `abf7629`, plus PR A's contract for what PR A adds.

**Starts after PR A has merged** (S7). It's built in the shared worktree on a fresh branch off `main` at or after PR A's merge commit (`feat/issue-654-b-meal-amendments`; see §5 for why not a separate worktree). Re-check §0's "from PR A" facts there. When the PR is built, copy this file to `docs/plans/2026-09-29-issue-654-b-meal-amendments-contract.md` in the PR.

## 0. What already exists (don't rebuild)

### From PR A (on `main` once it merges; verify by symbol before building)

- `types/meals.ts` has the meal cook mirrors, including `MealCookIngredient` (§2d restates them).
- `lib/meal-cook-session.ts`:
  - `MealCookSession.cook_id?: string`.
  - `ingredient_amendments: Record<string /* dish_id */, unknown>`, still guarded only as "an object".
  - `DishAmendment { ingredients: MealCookIngredient[]; servings: number; change_summary: string | null; applied_at_ms: number }`, where `servings` is the scale the list is expressed at.
  - `readDishAmendment(session, dishId): DishAmendment | null`, which validates. **There's no writer.**
- `lib/meal-cook-deduction.ts`:
  - `recipeServingsFor(dish, mealServings)` returns `recipe.servings > 0 ? recipe.servings : mealServings`.
  - `cookedIngredientsForDish(dish, mealServings, session)` already uses a valid amendment, rescaling its objects by `mealServings / amendment.servings`.
  - `buildMealCookRequest` sends it.
- `POST /v1/meals/cook` uses a supplied list verbatim for objects (strings are parsed and scaled by `string_scale`). So once a dish has an amendment, the deduction uses it with no further change.
- The cook page (`app/meals/[id]/cook/page.tsx`) persists every session change through `updateSession` → `saveMealCookProgress`, which is a no-op once the meal is ended (`lib/meal-cook-session.ts`:199–202 at `abf7629`). So an ended cook can't be amended.

### On `main` at `abf7629`

- **The backend amendment path exists but is unreachable from the overlay:**
  - `RecipeAmendmentProposal` (`models/proposals.py`:258) carries `amended_ingredients: list[RecipeIngredientAmendment]` (min 1; the **full** replacement list; the model is at :225, with defaults `quantity=1.0`, `unit="item"`), `change_summary`, `recipe_id` and `recipe_title`. `from_detection` (:296) returns `None` for a non-amendment. It's in `ProposalUnion` (:330) and `AnyProposal` (:345).
  - `_detect_amendment(state, ai_manager, prose_reply)` (`workflows/chat/nodes.py`:569) runs against `get_cooking_recipe(state)`, which reads **`context.cooking_recipe` first** and the session snapshot second (:135–150). It returns `None` without a model call when there's no pin or the pin has no ingredients (:581–588). It catches only `ValueError`, `TypeError` and `ValidationError` (:612), so a provider outage **raises**.
  - `_build_amendment_proposal(state, amendment)` (:617) turns a detection into the proposal, with `recipe_id` from the normalized pin.
  - **Only the graph nodes call them** (`nodes.py`:658–659, single-shot; :866–867, ReAct).
- **The streaming path never detects:** `run_chat_workflow_streaming` (`workflows/router.py`:2077; there is no function named `run_chat_stream`) streams `general_chat`/`cooking_help` itself (streamable set :2142).
  - After the stream it calls `update_session_node` (:2279) and builds `create_general_chat_envelope(...)` (:2286), which is a `ProposalEnvelope[None]` with `proposal=None`, `requires_review=False` and `next_action=NONE` (`workflows/shared_state.py`:355–378).
  - Then it yields `done` (:2297), then the envelope through `_envelope_then_follow_ups`. That helper suppresses follow-up chips when `envelope.proposal` isn't `None` (`_wants_follow_ups`, router.py:2026–2033), and serializes with `model_dump(mode="json")` (:2055).
  - `stream_failed` (:2252) marks a canned failure reply.
- **The non-streaming route streams internally:** `POST /v1/chat` (`chat_non_streaming`, `api/routes/chat.py`:168) also runs `run_chat_workflow_streaming` (:196–199) and keeps the envelope event. So **router change 2 reaches `/v1/chat` too**, and a pinned `cooking_help` turn there gets the proposal as well. The envelope that drops a `cooking_help` proposal, `_build_envelope_from_state`'s fallback branch (:1990–1997), is only reached through `run_chat_workflow` (:1632), whose one caller is the legacy `run_chat_ingest` (:2317). No UI path uses it (§8).
- **The overlay streams:** `AskBubblesOverlay` is a private component in `components/recipes/GuidedCookFlow.tsx` (:206–406, props :210–215; its `ChatBubble` helper is :408–425).
  - It calls `streamChatMessage` (:268) → `aiFetch('/v1/chat/stream')` (`lib/api/chat.ts`:82) with `conversation_id: null`, no `context`, and `follow_up_chips: false` (:268–274).
  - It frames the message as `While cooking "<recipeTitle>", on step <stepN> ("<stepText>"), I have a question: <text>` (:264–266).
  - Its comment claiming the backend "does not read a structured `context` field" (:257–263) is **stale**: `ChatRequest.context` exists (`models/requests.py`:95) and the stream route passes it through.
  - GuidedCookFlow mounts it at :829–834 with `stepN={step.n}`, `stepText={step.text}`, `recipeTitle={recipe.title}`.
- **Sessions and modes:**
  - `load_session` (`router.py`:207) returns `session_mode: None` with no `conversation_id` (:214–216), else the stored mode.
  - The COOKING gate (:540–553) turns brainstorm/generation into `cooking_help`, and the cooking bias prompt (:737–738) applies only in COOKING mode. So a *first* overlay turn is classified with neither.
  - The pin happens only at the end of a turn (`update_session_node`, :1017–1031), only with a `conversation_id` (:983–985).
  - `_resolve_cook_context` (:935–974) treats `context.cooking_recipe` as a full pin when it has a non-empty stripped `title` or truthy `ingredients` (:958–960). An id-only dict or `cooking_recipe_id` is resolved from the DB.
  - `/chat?cooking=<id>`'s first message sends the id-only `{ cooking_recipe_id }` (`lib/chat-seed.ts`:31–36).
- **Frontend chat types:** `ChatResponse.proposal` (`types/chat.ts`:182) has no amendment member. The existing guards (`isMealProposal`, :166–172) are the pattern. PR #360 (*render 'Update what I'm cooking' block*) was closed unmerged, so the frontend has **no amendment consumer at all**.
- **The Now card:** `MealNowCard` (`components/meal/MealNowCard.tsx`) takes `{ card, clockLabel, onDone, onExtend, onSkip, onStartEarly }` (:29–36). It renders `waiting`, `upcoming` and `active` (:86, :102, :144) and nothing on `finished` (:75). A `StreamStep` has `dish_id` (= recipe id), `dish_title`, `step_index`, `label` and `text` (`lib/meal-cook-stream.ts`:29–44).
- **PR #617, *fix(cook): amended mid-cook ingredients survive a page reload*** (open; fixes issue #490, *Spec A.2 — An applied amendment is lost on page reload mid-cook*). It adds single-recipe amendment persistence in `lib/cook-session.ts`, `app/chat/page.tsx` and `components/recipes/RecipeBook.tsx`, and tests in `cook-session-resume.test.tsx` and `cook-session-teardown.test.tsx`. **It doesn't overlap** this PR's files or storage keys: meal amendments live in the meal cook session. Either can merge first.
- **Issue #651, *Predictive pills and meal entry points*** (open; being built in the shared worktree on `feat/issue-651-a-predictive-pills`, no PR yet). Its edits touch `router.py` (`classify_intent`, `run_chat_workflow`, `_build_envelope_from_state`), `types/chat.ts` (`ChatRequest` and new starter types) and `lib/chat-seed.ts`. There's no semantic overlap with `load_session` or the streaming path, but **line numbers here are at `abf7629`**, so re-locate by symbol.

## 1. The shape of the change

1. The overlay moves to its own file and gains a **pinned mode**. It sends `context.cooking_recipe` with the dish's current list and a stable `conversation_id`, and renders an amendment card.
2. The backend **detects amendments on the streaming path** when the request carries a readable cook pin (router change 2, B1), and runs a **pinned first turn as COOKING** (router change 1, S4).
3. The cook page opens the overlay from a **"💬 Ask Bubbles" pill** on the Now card and writes an applied amendment into the session with `withDishAmendment`. PR A's deduction then picks it up.

**The saved recipe is never written.** An amendment lives only in the meal cook session.

## 2. Wire shapes

### 2a. The overlay's request (pinned mode)

```jsonc
POST /v1/chat/stream
{
  "message": "While cooking \"Creamy pasta\", on step 3 (\"Stir in the cream\"), I have a question: can I use yoghurt instead of cream?",
  "conversation_id": "<uuid minted once per overlay mount>",
  "follow_up_chips": false,
  "context": {
    "cooking_recipe": {
      "id": "<dish recipe id>",
      "title": "Creamy pasta",
      "ingredients": ["200 g pasta", { "name": "cream", "quantity": 150, "unit": "ml" }]   // AT RECIPE SCALE, current list
    }
  }
}
```

- Without `pinned`, the request is **byte-identical to today's**: `conversation_id: null`, no `context`, `follow_up_chips: false`, the same framed message.
- **The list is at recipe scale** (the dish as its recipe is written, or its current amendment brought back to recipe scale). The model sees quantities that match the recipe the cook is reading, and returns the amendment at that scale. `DishAmendment.servings` records that scale, and PR A's `cookedIngredientsForDish` rescales to the meal.

### 2b. The envelope back (the backend's existing `RecipeAmendmentProposal`, unchanged)

```jsonc
{ "intent": "cooking_help", "requires_review": true, "next_action": "review_proposal",
  "workflow_status": "awaiting_review",
  "proposal": { "proposal_type": "recipe_amendment", "is_amendment": true,
    "amended_ingredients": [ { "name": "greek yoghurt", "quantity": 150, "unit": "ml", "optional": false, "notes": null }, "..." ],
    "change_summary": "Swapped the cream for Greek yoghurt.",
    "recipe_id": "<the pinned id>", "recipe_title": "Creamy pasta" },
  "metadata": { "follow_ups_pending": false, "...": "..." } }
```

### 2c. Backend: two router changes (`workflows/router.py`)

**A readable cook pin (S4)** is `context["cooking_recipe"]` when it's a dict with a non-empty stripped `title` **or** truthy `ingredients`. That's exactly `_resolve_cook_context`'s full-dict test (:958–960). Extract it as `_request_cook_pin(context: dict[str, Any] | None) -> dict[str, Any] | None` and have `_resolve_cook_context` call it. A `cooking_recipe_id`, or an id-only `cooking_recipe` dict, is **not** a readable pin for either change below. So `/chat?cooking=` (id-only, `lib/chat-seed.ts`:35) is unchanged.

**Router change 1: a pinned first turn runs as COOKING (S4).** In `load_session` (:207), when `_request_cook_pin(state["context"])` is non-null and there's no session (no `conversation_id`, or the load failed) or the stored mode is `default` (after the stale reset), the returned state has `session_mode = "cooking"`. Nothing is persisted: `update_session_node` still pins at the end of the turn, as today.
- Why: today the *first* overlay question is classified with no cooking bias and no COOKING gate (:540–553), so "use yoghurt instead of cream" can miss `cooking_help` and never reach amendment detection.
- A stored non-default mode (for example `recipe_exploring`) is left alone.
- *Rejected:* also counting `cooking_recipe_id` / id-only pins. That would change the `/chat?cooking=` handoff's first turn, which isn't this ticket's to change.
- *Rejected:* a meal-only context flag, which would give one pin two meanings.

**Router change 2: stream-path amendment detection (B1).** In `run_chat_workflow_streaming`'s streamable branch, after the stream completes and `update_session_node` runs (:2279), and before `yield {"type": "done"}` (:2297):

```python
proposal: RecipeAmendmentProposal | None = None
if (
    intent == Intent.COOKING_HELP.value
    and not stream_failed
    and _request_cook_pin(classified_state.get("context")) is not None
):
    try:
        amendment = await _detect_amendment(stream_final_state, ai_manager, collected_text)
        proposal = _build_amendment_proposal(stream_final_state, amendment)
    except Exception as e:  # _detect_amendment re-raises provider errors; never break the stream
        logger.warning(f"Stream amendment detection failed (prose only): {e}")
        proposal = None
```

- **Imports (S8):**
  - Add `_detect_amendment` and `_build_amendment_proposal` to router.py's existing `from bubbly_chef.workflows.chat.nodes import (...)` (:59). Don't duplicate them.
  - Add `RecipeAmendmentProposal` to the `from bubbly_chef.models.proposals import HandoffKind` line (:42).
  - `ProposalEnvelope` is already imported from `models.base` (:32–37).
- **Attach before `done`.** When `proposal` is set, the envelope is a `ProposalEnvelope[RecipeAmendmentProposal]`, not the `ProposalEnvelope[None]` that `create_general_chat_envelope` returns (which would serialize with a warning and fail mypy). Add `create_cooking_help_envelope(assistant_message, proposal, request_id, workflow_id, conversation_id) -> ProposalEnvelope[RecipeAmendmentProposal]` to `workflows/shared_state.py`, returning `proposal=proposal`, `requires_review=True`, `next_action=NextAction.REVIEW_PROPOSAL`, `workflow_status=WorkflowStatus.AWAITING_REVIEW` and `intent=Intent.COOKING_HELP`.
- **The variable is declared once, before the branch (S8),** so mypy accepts both assignments:
  ```python
  envelope: ProposalEnvelope[RecipeAmendmentProposal] | ProposalEnvelope[None]
  if proposal is not None:
      envelope = create_cooking_help_envelope(collected_text, proposal, ...)
  else:
      envelope = create_general_chat_envelope(...)   # exactly today's call (:2286)
  envelope.suggested_mode = suggested_mode
  ```
- `_envelope_then_follow_ups` then sees `proposal is not None` and skips follow-ups (`follow_ups_pending: false`) with no change to it.
- **No extra model call without a readable request-context pin.** A session-snapshot pin alone (a later `/chat?cooking=` turn) doesn't trigger detection on the stream path. That path has no amendment consumer, and the cost would be one structured model call per turn.
- The event order is unchanged: tokens, `done`, `envelope`, then (never, here) `follow_ups`.
- *Rejected:* detecting on every `cooking_help` turn with any pin (the snapshot included), for the cost reason above.
- *Rejected:* routing pinned turns through the graph instead of streaming. It loses token streaming in the overlay, and `_build_envelope_from_state` drops the proposal anyway (:1990–1997).

### 2d. The TypeScript mirrors

**New in this PR (`types/chat.ts`, frontend, build step 0; written out verbatim):**

```ts
/** One ingredient of a mid-cook amendment (backend RecipeIngredientAmendment). */
export interface RecipeIngredientAmendment {
  name: string
  quantity: number
  unit: string
  optional: boolean
  notes: string | null
}

/**
 * A mid-cook amendment to the pinned recipe's ingredients (backend
 * RecipeAmendmentProposal, models/proposals.py). `amended_ingredients` is the FULL
 * replacement list, at the scale of the list the request pinned.
 */
export interface RecipeAmendmentProposal {
  proposal_type: 'recipe_amendment'
  is_amendment: boolean
  amended_ingredients: RecipeIngredientAmendment[]
  change_summary: string | null
  recipe_id: string | null
  recipe_title: string | null
}

export function isRecipeAmendmentProposal(proposal: unknown): proposal is RecipeAmendmentProposal {
  return (
    !!proposal &&
    typeof proposal === 'object' &&
    (proposal as { proposal_type?: unknown }).proposal_type === 'recipe_amendment' &&
    Array.isArray((proposal as { amended_ingredients?: unknown }).amended_ingredients) &&
    (proposal as { amended_ingredients: unknown[] }).amended_ingredients.length > 0
  )
}
```

- `ChatResponse.proposal` (:182) gains `| RecipeAmendmentProposal`. Any existing code that narrows `proposal` by shape instead of by guard has to keep compiling. `npx tsc --noEmit` is the check, and a fix is a guard, never a cast.

**Already on `main` from PR A (`types/meals.ts`), restated so this doc stands alone. Don't redeclare them:**

```ts
export interface MealCookIngredient {
  name: string
  quantity?: number | null
  unit?: string | null
  optional?: boolean
  notes?: string | null
}

export interface MealCookDishRequest {
  recipe_id: string
  ingredients: (string | MealCookIngredient)[] | null
  string_scale: number
}

export interface MealCookRequest {
  meal_id: string
  servings: number
  dishes: MealCookDishRequest[]
}

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
  missing_sources: Record<string, string[]>
  missing_notes: Record<string, string>
  unit_conflicts: Array<{ ingredient: string; recipe_unit: string; pantry_unit: string; recipe_id: string }>
  compound_suggestions: CompoundSuggestion[]
  expired_items: ExpiredMatchedItem[]
}

export interface MealCookConfirmRequest {
  meal_id: string
  cook_ref: string
  recipe_ids: string[]
  deductions: DeductionItem[]
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
  cooked_on: string
}

export type MealCookErrorKind = 'dish_mismatch' | 'confirm_incomplete'

export interface MealCookError {
  message: string
  kind?: MealCookErrorKind
}
```

**Already in `lib/meal-cook-session.ts` from PR A**, which imports `MealCookIngredient` from `@/types/meals`:

```ts
export interface DishAmendment {
  ingredients: MealCookIngredient[]
  servings: number
  change_summary: string | null
  applied_at_ms: number
}
```

- **Build step 0:** frontend commits the `types/chat.ts` block above (the two interfaces, the guard, and the `ChatResponse.proposal` union member) as the branch's first commit. ui-ux starts from that commit.

## 3. The session, the pin, and the page (frontend)

### `lib/meal-cook-session.ts`

- **`withDishAmendment(session, dishId, amendment: DishAmendment): MealCookSession`** (new, pure): returns a copy whose `ingredient_amendments[dishId]` is `amendment`, keeping every other dish's entry.
  - **One slot per dish; amendments stack.** Each amendment is the model's full list, derived from the list the previous one produced (§3 pin), so the latest replaces the slot outright.
  - *Rejected:* an edit log. It adds shape for nothing, because the model already returns the full stacked list.
  - It doesn't touch `cook_id` or the steps. The page persists it through `updateSession` → `saveMealCookProgress`, which is a no-op for an ended meal.
- The doc comment at :17–19 ("reserved … always `{}` here") is updated to say PR B writes the slot.

### `lib/meal-cook-deduction.ts`

- **`pinnedIngredientsForDish(dish: MealDishFull, mealServings: number, session): (string | MealCookIngredient)[]`** (new, pure). It returns the dish's current list **at recipe scale**:
  - **With `readDishAmendment` non-null:** its objects. When `amendment.servings` differs from `recipeServingsFor(dish, mealServings)`, each numeric `quantity` is scaled by `recipeServingsFor / amendment.servings`, rounded to 2 dp. In the ordinary case they're equal, and the list passes through.
  - **Otherwise:** `dish.recipe.ingredients` as stored. Strings stay strings. Objects are mapped to `{ name, quantity, unit, optional }` (dropping `preparation`), and a blank name is dropped.
- **Accepted asymmetry: a recipe with no servings (Nit 7).** When `recipe.servings` is null or 0, `recipeServingsFor` falls back to the meal's servings *at the time of the call*. So:
  - an **unamended** dish's factor is always `mealServings / mealServings = 1`, and it never scales;
  - an **amended** dish records `servings` = the meal's servings when the amendment was applied. If the meal's servings then change mid-cook (from the meal screen in another tab; the cook page has no servings control), its factor becomes `new / old`, and it **does** scale.
  - Both follow the meal screen's existing fallback rule. The amended dish is the more correct of the two, since its list was written against a known headcount. Fixing the unamended side would need a servings value the recipe doesn't have, so this is documented and not changed.

### The overlay's pin (N5)

- **The pin's dish is captured when the overlay opens.** The page stores `askPin = { dishId, dishTitle, stepN, stepText }` from the Now card's step at the tap:
  - `dishId = step.dish_id`;
  - `dishTitle = step.dish_title`;
  - `stepN = step.step_index + 1` (1-based within that dish);
  - `stepText = step.text.trim() || step.label`.
  - The Now card advancing while the overlay is open (a timer completing) doesn't re-pin.
  - *Rejected:* following the Now card, which would move a conversation about the sauce onto the salad mid-thread.
- **The pin's ingredients are re-derived live.** The page passes `pinned = { recipe_id: askPin.dishId, title: askPin.dishTitle, ingredients: pinnedIngredientsForDish(dish, meal.servings, session) }` on every render. The overlay reads the current prop at send time, so the turn after an applied amendment carries the amended list, and the next amendment is detected against it (stacking, with **no apply endpoint**).
  - *Rejected:* issue #489's server-side snapshot update (*Spec A.1 — Applied amendment must reach the deduction and the pinned recipe*, open). It's the right fix for single-recipe chat, but the meal path already holds the list.
- The overlay is rendered with `stepN={askPin.stepN}`, `stepText={askPin.stepText}` and `recipeTitle={askPin.dishTitle}`, so the framed message names the dish and step the question was asked from.

### The cook page (`app/meals/[id]/cook/page.tsx`)

- `MealNowCard` gets `onAskBubbles={() => setAskPin(pinFrom(stream.now.step))}` on `active` and `upcoming` cards.
- The overlay mounts in an `AnimatePresence`, like GuidedCookFlow's (:820–836), while `askPin` is set and the session isn't finished. ✕ in the overlay clears `askPin`.
- **`onApplyAmendment(a)`:**
  - It ignores `a` when `a.recipe_id !== askPin.dishId`, or when the dish isn't in the meal any more.
  - Otherwise: `updateSession(withDishAmendment(session, a.recipe_id, { ingredients: a.ingredients, servings: recipeServingsFor(dish, meal.servings), change_summary: a.change_summary, applied_at_ms: Date.now() }))`.
- **The saved recipe is never written.** No request other than the chat stream leaves the page.

## 4. The overlay and the Now card (ui-ux)

### `components/cook/AskBubblesOverlay.tsx` (extracted)

- Move `AskBubblesOverlay` (`GuidedCookFlow.tsx`:206–406) and its `ChatBubble` helper (:408–425) to `components/cook/AskBubblesOverlay.tsx` (a new directory), as a default export.
- GuidedCookFlow imports it and **behaves exactly as today**. Its mount at :829–834 is unchanged, and `guided-cook-flow.test.tsx` passes unmodified.
- Replace the stale comment at :257–263 with one saying the backend does read `context`, and that the unpinned mode deliberately sends none.

```ts
export interface AskBubblesPin {
  recipe_id: string
  title: string
  /** The dish's current list at recipe scale (pinnedIngredientsForDish). Read at send time. */
  ingredients: (string | MealCookIngredient)[]
}

export interface AskBubblesAmendment {
  recipe_id: string
  ingredients: MealCookIngredient[]
  change_summary: string | null
}

export interface AskBubblesOverlayProps {
  stepN: number
  stepText: string
  recipeTitle: string
  onClose: () => void
  pinned?: AskBubblesPin
  onApplyAmendment?: (a: AskBubblesAmendment) => void
}
```

**With `pinned` set:**
- It mints a `conversation_id` with `crypto.randomUUID()` once per mount (a ref) and sends it on every turn.
- Every turn carries `context: { cooking_recipe: { id: pinned.recipe_id, title: pinned.title, ingredients: pinned.ingredients } }`, read from the **current** prop.
- The header reads "Asking about ‹pinned.title›".
- **The amendment card:** when an `onDone` response passes `isRecipeAmendmentProposal(response.proposal)` **and** `response.proposal.recipe_id === pinned.recipe_id`, the assistant turn renders a card under its text:
  - the change summary, or "Bubbles suggests changing the ingredients";
  - **Use this change** and **Keep original**.
  - **Use this change** calls `onApplyAmendment({ recipe_id, ingredients: amended_ingredients.map(({ name, quantity, unit, optional, notes }) => ({ name, quantity, unit, optional, notes })), change_summary })`. The card then reads "Updated ‹pinned.title›. Your pantry update will use this."
  - **Keep original** collapses the card to "Kept the original ingredients." and calls nothing.
  - **Only the latest card is actionable.** A newer amendment card makes older ones inert (their buttons are removed, and their resolved text stays).
  - A proposal with a different `recipe_id`, or any non-amendment proposal, renders no card.

**Without `pinned`:** the request is byte-identical to today's, and no card is ever rendered.

### `MealNowCard` (`components/meal/MealNowCard.tsx`)

- Gains `onAskBubbles?: () => void`, rendered as a "💬 Ask Bubbles" pill (44px minimum hit area, the existing pill styling) on `active` and `upcoming` cards.
- It's absent on `waiting`, which has no single dish, and absent whenever the prop is omitted, so every existing render is unchanged.

## 5. Ownership

| Role | Owns |
|---|---|
| **backend** | `workflows/router.py` (`_request_cook_pin`, `load_session`'s pinned-turn mode, the streaming branch's detection); `workflows/shared_state.py` (`create_cooking_help_envelope`); the ai-service tests |
| **frontend** | `types/chat.ts` (§2d, build step 0); `lib/meal-cook-session.ts` (`withDishAmendment`, the doc comment); `lib/meal-cook-deduction.ts` (`pinnedIngredientsForDish`); `app/meals/[id]/cook/page.tsx` (the pin, the overlay mount, `onApplyAmendment`); the Next.js lib and page tests; the `verify` run |
| **ui-ux** | `components/cook/AskBubblesOverlay.tsx` (extracted, with the pinned mode; `GuidedCookFlow` switched over); `components/meal/MealNowCard.tsx` (`onAskBubbles`); the component tests |

**Where it's built (S7):** after PR A has merged, in the **shared worktree** (`.claude/worktrees/state-check-cb0ff6`) on a **fresh branch off `main`**: `feat/issue-654-b-meal-amendments`. A separate worktree isn't possible, because the desktop app blocks writes to other worktrees. So PR B waits for PR A's branch to be off the worktree, not run beside it.

Build order:
0. **Frontend commits the `types/chat.ts` block (§2d) first.** ui-ux branches its work from that commit.
1. Backend, and ui-ux in parallel.
2. Frontend: lib helpers, then page wiring.
3. `verify` (no migration in this PR).

## 6. Acceptance criteria and tests

**Backend** (`ai-service/tests/test_issue_654_meal_amendments.py`; `pytest`, `ruff check bubbly_chef/`, and `./scripts/mypy_gate.sh` with 0 new errors):
- **The harness (S9).** Router-change-2 tests reuse `tests/test_issue_498_follow_up_chips.py`'s streaming harness (:236–245). It uses `patch.object(router_mod, …)` on `get_chat_dispatch_graph`, `initialize_state`, `load_session`, `classify_intent` (returning `intent: "cooking_help"`), `get_ai_manager` (a manager whose `stream_complete` yields tokens), `get_repository` and `update_session_node`, then collects the JSON events from `router_mod.run_chat_workflow_streaming(...)`.
  - **Patch `bubbly_chef.workflows.router._detect_amendment`** (`patch.object(router_mod, "_detect_amendment", AsyncMock(...))`), **not** `bubbly_chef.workflows.chat.nodes._detect_amendment`. The router binds its own name at import, so patching the nodes copy would never be seen.
  - **Router-change-1 tests leave `load_session` unpatched.** They call it directly (or through the stream with `classify_intent` patched), with `router_mod.get_repository` patched to an `AsyncMock` returning a fake repo whose `get_or_create_session` returns a scripted `ConversationSession`, and whose `update_session` is an `AsyncMock` (asserted not awaited by `load_session`).
- **Router change 2 (B1)**, on that harness:
  - **With a readable pin** in `context.cooking_recipe` and `_detect_amendment` stubbed to return an amendment: the envelope event has `proposal.proposal_type == "recipe_amendment"`, `proposal.recipe_id` equal to the pin's id, `requires_review is True`, `next_action == "review_proposal"` and `metadata.follow_ups_pending is False`. The events arrive in the order tokens, `done`, `envelope`.
  - **Without a pin**, `_detect_amendment` (patched with an `AsyncMock`) is **not awaited**.
  - **With an id-only pin** (`cooking_recipe_id`, or `{ "id": … }`), `_detect_amendment` is not awaited.
  - A `general_chat` intent with a pin: not awaited.
  - `_detect_amendment` raising (a `RuntimeError`, standing in for a provider outage): the envelope has `proposal is None`, and the stream completes.
  - `stream_failed`: not awaited.
  - The envelope serializes with no Pydantic serialization warning (`pytest.warns` not triggered, or `warnings` filtered to error).
- **Router change 1 (S4):**
  - A first turn with a readable pin and a new session runs with `session_mode == "cooking"`, and a brainstorm classification becomes `cooking_help`.
  - The same with no `conversation_id`.
  - **An id-only first turn keeps `session_mode == "default"`.**
  - A turn with no pin is unchanged.
  - A stored `recipe_exploring` session with a pin keeps `recipe_exploring`.
  - Nothing is written to the session by `load_session`.
- `_resolve_cook_context`'s behaviour is unchanged (the existing cook-handoff tests).
- These stay green unmodified: `test_chat_router.py`, `test_cooking_companion.py` and `test_issue_302_cooking_amendment.py`.

**Frontend** (`npx tsc --noEmit`; vitest):
- `isRecipeAmendmentProposal`: true for a backend-shaped proposal; false for `meal`, `meal_options`, `null`, and an empty `amended_ingredients`.
- `meal-cook-session.test.ts`:
  - **an amendment survives a reload** (`withDishAmendment` → `saveMealCookProgress` → a fresh `getActiveMealCookSession` → `readDishAmendment` returns it);
  - a second amendment for the same dish replaces the first, and another dish's is kept;
  - an ended meal ignores an amendment save.
- `meal-cook-deduction.test.ts`:
  - `pinnedIngredientsForDish` returns the raw recipe list (strings kept) with no amendment, and the amendment's list at recipe scale with one;
  - an amendment written at recipe servings 2 feeds `cookedIngredientsForDish` at meal servings 4 as doubled quantities (PR A's reader, exercised through PR B's writer).
- `meal-cook-page.test.tsx`:
  - the Ask Bubbles pill on an `active` card opens the overlay pinned to that card's dish;
  - the first turn sends `context.cooking_recipe.id` equal to the dish, `title`, and the current list at recipe scale, and later turns reuse the same `conversation_id`;
  - applying an amendment then asking again sends the **amended** list;
  - an applied amendment survives a remount and reaches the next `requestMealCookProposal` call, scaled to the meal;
  - an amendment whose `recipe_id` is another dish's is ignored;
  - the Now card advancing while the overlay is open doesn't change the pin;
  - no request other than the chat stream is made on apply (the saved recipe is untouched).

**ui-ux:**
- `ask-bubbles-overlay.test.tsx`:
  - the pinned mode sends `context.cooking_recipe` and a stable `conversation_id` across turns, reading the latest `pinned.ingredients` prop;
  - the header reads "Asking about ‹title›";
  - an amendment card renders for a matching `recipe_id`, **Use this change** calls `onApplyAmendment` with the mapped list, and **Keep original** doesn't;
  - only the latest card is actionable;
  - a mismatched `recipe_id` renders no card;
  - **the unpinned request is unchanged** (`conversation_id: null`, no `context`, `follow_up_chips: false`, the same framed message).
- `meal-now-card.test.tsx`: Ask Bubbles on active and upcoming, absent on waiting, and absent when `onAskBubbles` is omitted.
- `guided-cook-flow.test.tsx` passes **unmodified**.

**`verify` (frontend; screenshots in the PR body as absolute `blob/<sha>/…?raw=true` URLs):**
1. Start a meal cook on **a meal whose two dishes share an ingredient** (S10). On a Now card, tap **💬 Ask Bubbles**: the overlay reads "Asking about ‹dish›".
2. Ask for a substitution ("can I use yoghurt instead of cream?"). The amendment card appears; tap **Use this change**.
3. Ask for a second change in the same overlay. The new card is based on the first change's list (they stack); apply it.
4. Reload the cook page. The amendment is still there: reopen Ask Bubbles and show that the request's `cooking_recipe.ingredients` (network panel) carries the amended list.
5. Finish the cook and open the combined sheet. Show **the summed shared line with its source note** next to **the amended ingredient**, and the original isn't there (S10).
6. Confirm. Show the pantry deducted per the amended list, **both recipes' and the meal's `times_cooked`/`last_cooked_at`**, and **the "+N" pop** (S10).
7. Open the dish's saved recipe: its ingredients are unchanged.
8. Open a single-recipe guided cook's Ask Bubbles: it works as before, with no "Asking about" header and no amendment card.

## 7. Reversible product calls (log each in the sprint doc)

1. **Stacking by resending the current list in `context.cooking_recipe`.** Rejected: issue #489's server-side snapshot apply endpoint.
2. **Stream-path detection only for a readable request-context pin** (B1). Rejected: detecting on every `cooking_help` turn with any pin, which costs one structured model call per single-recipe `/chat` turn with no consumer; and routing pinned turns through the graph, which loses streaming and whose envelope builder drops the proposal. The change covers `/v1/chat` too, since that route streams internally.
3. **A pinned first turn runs as COOKING, and only a full-dict pin counts** (S4). Rejected: counting id-only pins, which would change `/chat?cooking=`; and a meal-only flag.
4. **The overlay pins the list at recipe scale; `DishAmendment.servings` is the recipe's effective servings; the deduction rescales** (S3). Rejected: pinning a meal-scale list. Strings can't be scaled on the client, so a meal-scale pin would mix scaled objects with unscaled strings, and the model would return an inconsistent list.
5. **One amendment slot per dish; the latest full list wins.** Rejected: an edit log.
6. **The pin's dish is captured at overlay open; its ingredients are live** (N5). Rejected: following the Now card as it advances.
7. **Extract `AskBubblesOverlay` to `components/cook/`.** Rejected: exporting it from inside `GuidedCookFlow`.
8. **The pill only on `active` and `upcoming` cards.** Rejected: on `waiting`, which has no single dish to pin.
9. **The saved recipe is never written.** Rejected: "save this change to the recipe" now; it's a follow-up if wanted.

## 8. Out of scope

- **The combined deduction, the confirm, the idempotency claim, the proxies, bubbles and the finish flow.** PR A shipped them, and nothing here changes them.
- **Single-recipe amendments.** Issue #489 (*Spec A.1 — Applied amendment must reach the deduction and the pinned recipe*, open) stays open. Issue #490 (*Spec A.2 — An applied amendment is lost on page reload mid-cook*, open) is PR #617's. This PR meets their semantics for meals only.
- **`run_chat_workflow`'s graph envelope dropping a `cooking_help` proposal** (`_build_envelope_from_state`, router.py:1990–1997). `/v1/chat` doesn't reach it: that route runs `run_chat_workflow_streaming` (`api/routes/chat.py`:196–199), so router change 2 covers it. The only caller is the legacy `run_chat_ingest` (:2317), so it's a follow-up issue if wanted.
- **"Save this change to the recipe"** from an amendment. The saved recipe is never written, which is what the ACs require.
- **The model's defaults on amended lines.** `RecipeIngredientAmendment` defaults a missing quantity to `1.0 item`, so an unquantified line ("salt to taste") can come back as "1 item salt" and show as `imprecise` or `unit_conflict` on the sheet. That's the existing detection prompt's behaviour, and the sheet lets the user type a quantity.
- **Overlay conversations are persisted as chat history** (the stream route saves messages whenever there's a `conversation_id`). Nothing in the UI lists `/v1/chat/sessions` today (`fetchChatSessions` in `lib/api/chat.ts`:237 has no caller), so they're invisible. A cleanup is a follow-up issue if they ever surface.
- **The final visual design** (Goal 3) and a Playwright e2e.

## 9. Needs the human

None. Nothing here changes v1 scope or costs money. The one added model call per pinned `cooking_help` turn is the existing detection pass, already paid on the graph path, and it only runs from the meal overlay.

## §R Review 1 resolutions

| Finding | Where applied | Decision |
|---|---|---|
| B1 | §0, §2c router change 2, §6, §7.2 | Detection runs in `run_chat_workflow_streaming` (router.py:2077; the review's "`run_chat_stream`" doesn't exist) after the stream and before `done`, only for `cooking_help` with a readable request-context pin and no `stream_failed`. The result is attached via a typed `ProposalEnvelope[RecipeAmendmentProposal]` (`requires_review=True`, `next_action="review_proposal"`). There's no model call without a pin. Tests for the pin and no-pin cases added. Added: wrapped in `try/except Exception`, because `_detect_amendment` re-raises provider errors. |
| S1 | §2d, §5 build step 0 | `RecipeAmendmentProposal` + `isRecipeAmendmentProposal` written out verbatim, plus PR A's meal mirrors and `DishAmendment` restated. `types/chat.ts` committed first; ui-ux starts from it. |
| S2 | Not in this PR | The columns-based claim, `cooked_on` and the award keying are PR A's. |
| S3 | §2a, §3, §7.4 | The overlay sends the pinned list at recipe scale; `DishAmendment.servings` is the recipe's effective servings; PR A's `cookedIngredientsForDish` rescales by `mealServings / amendment.servings`. |
| S4 | §0, §2c router change 1, §6, §7.3 | A readable cook pin is `context.cooking_recipe` as a dict with a non-empty `title` or `ingredients`; id-only pins don't change the mode, so `/chat?cooking=` is unchanged. The "also gives the existing /chat?cooking= handoff" sentence and the product call's "also affects" clause are gone. The id-only first-turn test is added. |
| S5 | Not in this PR | The Start-cooking confirm is PR A's. |
| S6 | Not in this PR | `MealCookError` and `errorKind` are PR A's (the type is restated in §2d). |
| S7 | Not in this PR | The meal confirm proxy is PR A's. |
| S8 | Not in this PR | PR #595 and `lib/cook-awards.ts` are PR A's. |
| S9 | Not in this PR | Skip semantics are PR A's. |
| N1 | Not in this PR | `get_meal_with_dishes` is PR A's. |
| N2 | §2d | `MealCookIngredient` restated with the corrected comment (PR A owns it). |
| N3 | Not in this PR | The merge rules are PR A's. |
| N4 | Not in this PR | The rescue exclusion is PR A's. |
| N5 | §3 the overlay's pin | The pin's dish is captured at open; ingredients are re-derived live; amendments stack. `stepN = step_index + 1`, `stepText = text.trim() || label`, `recipeTitle = dish_title`. The legacy cook id is PR A's. |
| N6 | Not in this PR | The invalidations, timer dismissal and draft rule are PR A's. |
| N7 | Not in this PR | The CookModal re-exports are PR A's. This PR keeps `guided-cook-flow.test.tsx` unmodified. |
| N8 | Not in this PR | The single-slot replay limitation is PR A's. |
| N9 | §0 | PR #617 named, with its files. No overlap. |
| N10 | Not in this PR | The alias-cache test is PR A's. |
| Drift | §0 | `run_chat_stream` → `run_chat_workflow_streaming` (:2077); overlay span `:206–406` plus `ChatBubble` `:408–425`; `_detect_amendment`'s narrow `except` (:612); the graph envelope drop (:1990–1997); the stale GuidedCookFlow comment (:257–263); issue #651's in-flight router/types edits noted. |

## §R2 Review 2 resolutions

| Finding | Where applied | Decision |
|---|---|---|
| S7 | Header, §5 | Built after PR A merges, in the shared worktree, on a fresh `feat/issue-654-b-meal-amendments` off `main`. A separate worktree isn't possible: the desktop app blocks writes to other worktrees. |
| S8 | §2c router change 2 | `envelope: ProposalEnvelope[RecipeAmendmentProposal] \| ProposalEnvelope[None]` declared before the branch; `RecipeAmendmentProposal` added to router.py's `models.proposals` import (`ProposalEnvelope` is already imported, :35). |
| S9 | §6 backend | Patch `bubbly_chef.workflows.router._detect_amendment`, not the `chat.nodes` copy. Router-change-2 tests use the `test_issue_498_follow_up_chips.py` harness (`patch.object(router_mod, "load_session"/"classify_intent", …)`); router-change-1 tests leave `load_session` unpatched and mock `get_repository`. |
| S10 | §6 verify 1, 5, 6 | A meal whose two dishes share an ingredient; the summed shared line with its source note beside the amended ingredient; both recipes' and the meal's `times_cooked`/`last_cooked_at` and the "+N" pop. |
| Nit 3 | §0, §7.2, §8 | `/v1/chat` runs `run_chat_workflow_streaming` (`api/routes/chat.py`:196–199), so router change 2 reaches it. The out-of-scope bullet now names only `run_chat_workflow` (legacy `run_chat_ingest`). |
| Nit 7 | §3 `lib/meal-cook-deduction.ts` | Accepted and documented: with a null `recipe.servings`, an amended dish scales with a later servings change while the same dish unamended doesn't. |
| S1–S6, Nits 1, 2, 4, 5, 6, PR #595 order | Not in this PR | PR A's findings (error detail, in-progress replay, the replay membership skip, repo tests, sanitising, the `onBackToMeal` shim, merge and scaling nits, auto-open timing, the #595 order). |
