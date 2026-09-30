# Issue #651, PR B: make it a meal, the contract

The contract for **PR B** of issue #651, *Predictive pills and meal entry points*. It's shared by three roles working in parallel: backend (`ai-service/**`), ui-ux (`nextjs/src/components/**`) and frontend (`nextjs/src/app/**`, `nextjs/src/lib/**`, `nextjs/src/types/chat.ts`, `CONTEXT.md`). The parent spec is issue #647 ("Chat and meal UI", the "Make it a meal" bullet under "AI microservice", and user stories 3–4). The earlier meal contracts are `2026-09-29-issue-650-meal-contract.md`, `2026-09-29-issue-652-meal-screen-contract.md` and PR A's `2026-09-29-issue-651-a-pills-contract.md`. Where this doc is silent, the issue rules, then the spec. Wire fields are snake_case. File:line references are against main at `93edfe5` (after PR #666, PR A).

The ticket ships as three PRs: **A: pills** (merged, PR #666), **B: make it a meal** (this doc), **C: the meal-again lookup**. PR B's body says `Related to #651`, never a closing keyword.

When the ticket is built, copy this file to `docs/plans/2026-09-30-issue-651-b-make-it-a-meal-contract.md` in the PR.

**What PR B does, in one paragraph.** Every single-dish recipe card (the chat recipe card, the saved-recipe lookup card, the recipe page) gets a **"🍽️ Make it a meal"** button. It starts the meal flow with that dish as the **fixed main**: a saved recipe is referenced by id, and an in-chat recipe is sent as a payload. The option stage returns up to three options that all have that main and differ only in their sides. The pick stage **does not regenerate the main**: a saved main carries its own recipe id through to `POST /api/meals`, which links it without copying, so the meal references the same recipe the user started from.

## 0. What already exists (don't rebuild)

- **The meal flow (issues #650 and #651 PR A):** `ai-service/bubbly_chef/workflows/meal/nodes.py`:
  - `_retained_meal_plan_state` (205-217);
  - `_normalize_option_dishes` (394-431), which coerces the model's dishes into one main plus 1–2 sides;
  - `_compute_coverage_and_rescues` (457-504), the deterministic synonym-table coverage;
  - `meal_options_stage` (647-814). It contains the `meal_followup` inheritance branch (663-696), the servings rule (704-710), the cuisine hint (712), the prompt assembly (732-740), the options loop (761-783) and the return (802-814).
  - `_expand_dish_result` (829-907). Its `other_dishes` line (853-858) already names the rest of the meal to each dish call.
  - `meal_pick_stage` (929-1043). It has the `asyncio.gather` (976-990) with `with_follow_ups=(position == 0)` at 986, the pill read at 1008-1011 (keyed on `position == 0`), and the reply text at 1025-1031.
- **Models:** `models/meal.py`: `MealOptionsProposal` (88-94), `MealDish` (102-107, **no recipe id today**), `MealProposal` (110-123) and `MealPlanSessionState` (131-141, which holds options, servings and constraints and is retained at `session.metadata.meal_plan`, `models/session.py:105`).
- **Prompts:** `prompts/meal.py`. `MEAL_OPTIONS_SYSTEM_PROMPT` (16-48) says the three options must have **different mains** (33-34); PR B overrides that rule in a block. The other constants are `MEAL_OPTIONS_FOLLOW_UPS_RULES` (196-202), `MEAL_READY_FOLLOW_UPS_RULES` (207-214), `MEAL_FOLLOW_UPS_NO_PANTRY_RULE` (219-222) and `MEAL_OPTIONS_PREVIOUS_BLOCK` (227-231).
- **Routing:** `workflows/router.py`:
  - the `classify_intent` docstring priority list (264-285);
  - the `meal_option_id` shortcut (336-345);
  - the `meal_followup` shortcut (356-364), which is the model for PR B's shortcut;
  - `route_by_intent`'s meal branch (799-805): `meal_option_id` means the pick, otherwise the option stage;
  - `update_session_node`'s meal branch (1334-1344), which writes `meal_plan_session_state` to `session.metadata.meal_plan` only when the option stage set it;
  - the envelope builders (1811-1838 and 1980-2008), which serialise the proposal as-is, so new optional fields ride along with no builder change.
- **The request:** `models/requests.py:95-111` documents the recognised `ChatRequest.context` keys (`dict[str, Any]`, with **no size limit** anywhere on the request).
- **Ownership-scoped recipe read:** `repository/supabase_repo.py:737-756` `get_recipe(user_id, recipe_id)` filters `.eq("user_id", user_id)`. The service-role client bypasses RLS, so that `eq` is **the only ownership check**. It uses `.single()`, which raises on zero rows rather than returning `None`. The recipes table (`supabase/migrations/00001_initial_schema.sql:51-72`) stores dietary tags in **`tags`**, not `dietary_tags`, and it has `is_draft`, `servings`, `cuisine`, `meal_type` and a JSONB `steps` (00012).
- **The dietary helpers:** `workflows/recipe/nodes.py`: `_DIETARY_FORBIDDEN_INGREDIENTS` (728-754), `_drop_redundant_dietary` (772-784), `_combine_dietary_preferences(stored, requested, constraints, input_text)` (787-825) and `is_pantry_grounded` (649-655, where only an explicit `False` turns grounding off). `services/dietary_preferences.py:26` has `get_stored_dietary_preferences`.
- **Saving a meal:**
  - `nextjs/src/app/api/meals/route.ts:118-133`: a dish with `recipe_id` is **linked, not copied**, after a user-scoped ownership select. A miss throws "Recipe … not found", which becomes a 400 at 184.
  - `app/api/meals/[id]/route.ts:126-178`: DELETE removes only **draft** dish recipes. `meal_dishes.recipe_id` is `ON DELETE CASCADE` (00013), so deleting a saved recipe leaves a mainless meal, which is already handled (`__tests__/recipe-delete-mainless-meal.test.ts`).
  - `lib/meal-chat-helpers.ts:17-52` `buildCreateMealPayload` always sends a `recipe` payload. Its comment at 10-16 says no dish ever carries an id; PR B makes that comment stale.
- **The chat page** (`app/chat/page.tsx`):
  - the seed memo (95-98, where cooking excludes every seed);
  - `saveStates`, `savedRecipeIds` and `draftRecipeIds` (123-127);
  - the one-shot seed effect, which already forwards `seed.context` (279-291);
  - `handleChipTap` (448-454), `handlePickMealOption` (473-475) and `handlePickSavedRecipe` (603-607);
  - the `MessageRenderer` call (724-800) and `MessageRendererProps` (945-988);
  - the branches: saved lookup (1102-1133), options (1141-1171, `resolveChips` at 1163), meal ready (1172-1204), and the recipe card (1207-1243, **which renders no chip row**).
- **Send guards:** `hooks/useChat.ts:245`: `sendMessage` returns early while `isStreaming`. `sendChipMessage` (689-699) **aborts** the current stream first, so it must not be used for make-it-a-meal (§8).
- **The cards:**
  - `components/chat/ChatRecipeCard.tsx`: its props (9-33) and actions (210-271): Cook with me, the Save / Try Another row (234-257), and "I already made this". It has no `isLastSettledAssistant` gating; old cards stay live.
  - `components/chat/SavedRecipeMatches.tsx`: `SingleMatchCard` (150-245) has Open recipe then Cook this (213-241). Mini cards (97-143) only expand.
- **The recipe page:** `app/recipes/[id]/page.tsx`: the header actions, Edit with AI and Delete (207-229); the meta row (243-252); the description (254-261). It fetches `/api/recipes/${id}` ad hoc (70), which is pre-existing.
- **Seeds:** `lib/chat-seed.ts`: `ChatSeedKind = 'tip' | 'use' | 'plan'` (52, with a "PR B adds 'meal'" note); `ChatSeed.context?` (69-73); `deriveChatSeed` (170-226, checking plan, then tip, then use); the header comment (1-28).
- **The resolver:** `lib/chat-chips.ts`: `resolveStaticChips` (107-199; the `meal_options` set is at 161-184 and includes **"Make it vegetarian"**) and `resolveChips` (240-296).
- **PR A's seams for PR B:**
  - the `classify_intent` block;
  - the inheritance branch ("`fixed_main` is inherited here too");
  - the `deriveChatSeed` precedence slot (cooking > meal > plan > tip > use);
  - `ChatSeed.context`;
  - "move `with_follow_ups` to side 1 when the main is fixed".
- **Known neighbours:**
  - Issue #662 (open, *Saved lookup and cuisine hint include draft recipes*): the saved lookup can return draft rows, which is why the backend has to handle a draft id (§6).
  - The meal-cook deduction (issue #654, in flight) works on dish recipe ids, and a linked main is an ordinary dish recipe to it.

## 1. Shared types and wire shapes (the seam)

### 1a. Request context key (frontend sends, backend reads)

```jsonc
// Saved recipe, referenced by id (the saved-lookup card, the recipe page seed,
// a chat card whose recipe the user saved to the library this session)
{ "meal_fixed_main": { "recipe_id": "0b6e…-uuid" } }

// In-chat recipe, sent as a payload (a chat card that isn't saved, or whose row is a draft)
{ "meal_fixed_main": { "recipe": { /* MealFixedMainRecipe, §1c */ } } }
```

- **Routing trigger:** the value must be a JSON **object**. A string, list, `null` or number is ignored entirely, and the turn is classified as if the key were absent (the same "exact type" rule as `meal_followup is True`).
- **Valid shape:** exactly one of `recipe_id` (a string) or `recipe` (an object). Both, neither, or a wrong inner type means **invalid**. That still routes to `meal_plan`, and the option stage refuses with the friendly "couldn't read" reply (§6). The object check alone decides routing, so a buggy client gets a predictable refusal, never an unpredictable classification of the canned text.
- **`recipe_id`:** must parse as a UUID; otherwise it's invalid. It's canonicalised with `str(uuid.UUID(value))` before any read, log or retention, so upper-case or braced forms resolve to the same row and retain one spelling. It's resolved with `repo.get_recipe(user_id, recipe_id)`, which is **scoped to the caller**. Another user's id, a deleted id and a missing id are indistinguishable, and all get the "not found" reply (§6). Logs name the recipe id and user id, never payload content.
- **`recipe` (the payload) limits,** checked in this order:
  1. `len(json.dumps(raw_value)) ≤ 32_768` characters. Over that, it's refused as invalid, **before** any model validation.
  2. It validates as `MealFixedMainRecipePayload` (§1b). Extra keys are ignored, so `ingredient_availability`, `id` and the like are dropped.
  3. The title is non-blank after trimming.
- **Precedence against other context keys:**
  - `meal_option_id` present means **a pick**, and `meal_fixed_main` is ignored (the pick reads the fixed main from the session). The client never sends both.
  - `meal_fixed_main` present means a **fresh fixed-main option turn**, even if `meal_followup` is also `true`. It never inherits a retained meal.
  - `forced_intent` stays priority 1 (the client never sends it with this key).
- **Never persisted client-side:** the key is built per tap from the card or seed. It's never stamped on a pill and never stored in `useChat`.

### 1b. Backend shapes

```python
# models/meal.py — new

class MealFixedMainIngredient(Ingredient):
    """Ingredient with payload limits. An over-long name, a negative quantity, or NaN/inf
    rejects the payload (invalid)."""
    name: str = Field(max_length=200)
    quantity: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    # MealFixedMainRecipePayload has a mode="before" validator on `ingredients` that drops
    # dict entries whose name is missing or blank after trimming, before this model runs.

class MealFixedMainRecipePayload(BaseModel):
    """An in-chat recipe sent as `context.meal_fixed_main.recipe` (issue #651 PR B).
    The size gate (32 KB serialised) runs before this model."""
    model_config = ConfigDict(extra="ignore")
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    ingredients: list[MealFixedMainIngredient] = Field(default_factory=list, max_length=60)
    instructions: list[Annotated[str, StringConstraints(max_length=2000)]] = Field(
        default_factory=list, max_length=60)
    steps: list[dict[str, Any]] | None = None
    # The card's steps are REBUILT with build_structured_steps(payload.steps,
    # payload.instructions): text always comes from instructions, a count mismatch or any
    # invalid step gives None (not structured), never a rejected payload.
    prep_time_minutes: int | None = Field(default=None, ge=0, le=1440)
    cook_time_minutes: int | None = Field(default=None, ge=0, le=1440)
    total_time_minutes: int | None = Field(default=None, ge=0, le=1440)
    servings: int | None = Field(default=None, ge=1, le=100)
    cuisine: str | None = Field(default=None, max_length=60)
    meal_type: str | None = Field(default=None, max_length=30)
    difficulty: str | None = Field(default=None, max_length=30)
    dietary_tags: list[Annotated[str, StringConstraints(max_length=40)]] = Field(
        default_factory=list, max_length=20)

class MealFixedMain(BaseModel):
    """The fixed main of a make-it-a-meal flow, retained in MealPlanSessionState."""
    source: Literal["saved", "chat"]
    recipe_id: str | None = None   # set iff source == "saved": a NON-draft row the user owns
    title: str
    recipe: RecipeCard | None = None   # set iff source == "chat": the payload (or a draft
                                       # row's contents) as a RecipeCard with a FRESH id

    @model_validator(mode="after")
    def _source_matches_fields(self) -> "MealFixedMain":
        # recipe_id iff saved, recipe iff chat -- a retained state that breaks this
        # fails validation, and _retained_meal_plan_state already treats that as absent.
        if (self.source == "saved") != (self.recipe_id is not None):
            raise ValueError("recipe_id must be set exactly when source == 'saved'")
        if (self.source == "chat") != (self.recipe is not None):
            raise ValueError("recipe must be set exactly when source == 'chat'")
        return self

class MealFixedMainEcho(BaseModel):
    """Wire echo on the option-stage proposal, so the client can adapt its fixed pills."""
    recipe_id: str | None = None
    title: str

# Changed, all additive with defaults (so an old retained session still validates):
class MealOptionsProposal(BaseModel):   # 88-94
    ...
    fixed_main: MealFixedMainEcho | None = None

class MealDish(BaseModel):              # 102-107
    ...
    recipe_id: str | None = None   # set ONLY on a fixed saved main; `recipe` is then filled
                                   # from that saved row, never regenerated

class MealPlanSessionState(BaseModel):  # 131-141
    ...
    fixed_main: MealFixedMain | None = None
```

```python
# workflows/meal/fixed_main.py — new module (imported by router.py and meal/nodes.py;
# it imports only models, repository and services, so no cycle)

MEAL_FIXED_MAIN_KEY = "meal_fixed_main"
MAX_FIXED_MAIN_PAYLOAD_CHARS = 32_768
INHERITABLE_DIETS = frozenset(
    {"vegetarian", "vegan", "pescatarian", "dairy-free", "nut-free", "gluten-free"})

class FixedMainRefusal(BaseModel):
    kind: Literal["invalid", "not_found"]

def has_fixed_main(context: dict[str, Any] | None) -> bool:
    """True iff context["meal_fixed_main"] is a dict. The routing trigger only."""

@dataclass(frozen=True)
class ResolvedFixedMain:
    fixed: MealFixedMain          # what gets retained in MealPlanSessionState
    card: RecipeCard              # the main, ready for the prompt, the outline and the pick
    linked_recipe_id: str | None  # the canonical id to link, or None (a chat payload or a draft copy)

async def resolve_fixed_main(user_id: str, raw: object) -> ResolvedFixedMain | FixedMainRefusal:
    """Deep validation of context["meal_fixed_main"] for a FRESH fixed-main turn (§1a),
    returning the card too, so the row is read ONCE on that turn. A draft row by id comes
    back as source "chat" with a fresh-id card and linked_recipe_id None. Never raises."""

async def load_fixed_main_card(
    user_id: str, fixed: MealFixedMain
) -> ResolvedFixedMain | FixedMainRefusal:
    """For a RETAINED fixed main (a meal_followup option turn, or the pick).
    source "saved": re-reads the row. Gone -> not_found; now a draft -> a fresh-id card and
    linked_recipe_id None, i.e. a copy. source "chat": fixed.recipe as is. Never raises."""

async def fixed_main_constraints(state: WorkflowState, card: RecipeCard) -> dict[str, Any]:
    """The fresh fixed-main turn's recipe_constraints (§5), with no model call.
    Never raises: a failed stored-preference read counts as no stored diet."""

def recipe_card_from_row(row: dict[str, Any]) -> RecipeCard:
    """A recipes row as a RecipeCard: id = UUID(row["id"]); dietary_tags = row["tags"]
    (strings only); ingredients from str or dict entries (blank names dropped, invalid
    entries skipped); steps = [StructuredStep.model_validate(s)] only when it's a list with
    the same length as instructions, else None (a ValidationError also gives None); tips = []."""

def fixed_main_outline(card: RecipeCard) -> MealDishOutline:
    """role "main", name = " ".join(card.title.split())[:200].
    key_ingredients = every non-blank ingredient name, each whitespace-collapsed and capped
    at 80 characters, deduped case-insensitively.
    est_total_minutes = total_time_minutes, else prep + cook when either is set,
    else the sum of the step durations when there are steps, else None.
    est_hands_on_minutes = the sum of the hands-on step durations when there are steps,
    else prep_time_minutes, else None."""
```

`workflows/state.py` gains nothing: the fixed main travels inside `meal_plan_session_state`.

### 1c. Frontend shapes (frontend owns them; they land in the seam commit, §11)

```ts
// types/chat.ts

/** The in-chat recipe fields sent as `context.meal_fixed_main.recipe` (issue #651 PR B).
 *  Built by `fixedMainPayload`, never the raw proposal: no `ingredient_availability`, no `id`. */
export interface MealFixedMainRecipe {
  title: string
  description?: string | null
  ingredients: Array<{ name: string; quantity?: number | null; unit?: string | null
                       preparation?: string | null; optional?: boolean }>
  instructions: string[]
  steps?: Step[] | null
  prep_time_minutes?: number | null
  cook_time_minutes?: number | null
  total_time_minutes?: number | null
  servings?: number | null
  cuisine?: string | null
  meal_type?: string | null
  difficulty?: string | null
  dietary_tags?: string[]
}
export type MealFixedMainContext = { recipe_id: string } | { recipe: MealFixedMainRecipe }

export interface MealOptionsProposal { /* … */ fixed_main?: { recipe_id: string | null; title: string } | null }
export interface MealProposalDish   { /* … */ recipe_id?: string | null }
// ChatRequest.context JSDoc (215-227): add `meal_fixed_main` — see §1a.

// lib/chat-seed.ts
export type ChatSeedKind = 'tip' | 'use' | 'plan' | 'meal'
/** "Make {title} into a meal"; a blank or absent title gives "Make a meal around your recipe". */
export function makeMealMessage(title?: string | null): string
/** Recipe page → `/chat?meal=<id>&title=<title>` (URLSearchParams-encoded). */
export function makeMealHref(recipeId: string, title?: string | null): string

// lib/meal-chat-helpers.ts
export function fixedMainPayload(recipe: ChatRecipeData): MealFixedMainRecipe
/** `{ recipe_id }` when `savedId` is a non-empty string, else `{ recipe: fixedMainPayload(recipe) }`. */
export function fixedMainForCard(recipe: ChatRecipeData, savedId?: string | null): MealFixedMainContext
// buildCreateMealPayload (17-52): a dish with `recipe_id` is sent as `{ role, position, recipe_id }`.
```

**`fixedMainPayload`** copies only the fields listed in §1c:
- The title is `recipe.title?.trim() || 'Untitled recipe'`.
- `ingredients` keeps each entry's `name`, `quantity`, `unit`, `preparation` and `optional` when present, and drops entries with a blank name.
- **The read type is widened, not the payload narrowed** (review 1 nit): `ChatRecipeData.ingredients` (`types/chat.ts:68-72`) gains `preparation?: string | null` and `optional?: boolean`. The wire already carries both (`RecipeCard`'s `Ingredient`), and dropping them would lose "diced" and optional flags on the saved meal. It's additive, so no existing reader changes.
- A missing `ingredients` or `instructions` becomes `[]`.

### 1d. Component props (ui-ux; the seam commit adds them as accepted but unused props)

```ts
// components/chat/ChatRecipeCard.tsx, added to ChatRecipeCardProps (9-33)
/** Shows the "Make it a meal" button when set. The page omits it while a cook is pinned
 *  in chat or this card's cook has started. */
onMakeMeal?: () => void
/** Disables that button (the page passes `isStreaming`). */
makeMealDisabled?: boolean

// components/chat/SavedRecipeMatches.tsx, added to SavedRecipeMatchesProps (9-20)
/** Shows "Make it a meal" on the single card and on the expanded card only (never on mini
 *  cards). Disabled by the existing `disabled` flag. */
onMakeMeal?: (match: SavedRecipeMatch) => void
```

## 2. Deterministic routing (`workflows/router.py`, backend)

A new block goes in `classify_intent` **right after the `meal_option_id` shortcut (345) and before the `meal_followup` one (347)**:

```python
# ── Priority 2a: make it a meal (#651 PR B) — deterministic, no LLM call ──
if has_fixed_main(context):
    logger.info("classify_intent: meal_fixed_main present — meal_plan fixed-main shortcut")
    return {**state, "intent": Intent.MEAL_PLAN.value, "intent_confidence": 1.0,
            "intent_reasoning": "Make it a meal — context.meal_fixed_main present",
            "detected_entities": []}
```

- There's no LLM call. It sits ahead of the mode-aware routing, the exit phrases, the brainstorm re-pick and the picked-recipe bias, exactly like `meal_followup`.
- **Why it can't hijack other turns:**
  - It fires only on a dict-valued `meal_fixed_main`, which only two client code paths ever set: a make-it-a-meal button tap and the `meal` seed's one auto-send.
  - No pill, chip, confirm band, seed of another kind, or stored state carries it.
  - A typed message never carries it, even straight after a make-it-a-meal turn.
- **Priority list** in the docstring (264-285): add "2a. context.meal_fixed_main — deterministic meal_plan make-it-a-meal shortcut (#651 PR B), no LLM call. meal_option_id, checked just above, wins. Beats meal_followup when both are present."
- **`route_by_intent`** (799-805) is **unchanged**: with no `meal_option_id`, the turn goes to `meal_options_stage`.
- **`ChatRequest.context` docs** (`models/requests.py:95-111`): add `"meal_fixed_main"`, documenting the `{recipe_id}` or `{recipe}` object, the 32 KB payload cap, the ownership scoping and the precedence (§1a). Frontend mirrors this in the `types/chat.ts` JSDoc.

## 3. The option stage (`meal_options_stage`, 647-814, backend)

### 3a. Which fixed main, if any

At the top of the stage:

| Turn | `fixed` |
|---|---|
| `context.meal_fixed_main` present (a fresh fixed-main turn) | `await resolve_fixed_main(user_id, context["meal_fixed_main"])`. The `meal_followup` inheritance is **skipped** on this turn even if `meal_followup` is also set. |
| No `meal_fixed_main`, `meal_followup is True`, and a valid retained state | `retained_state.fixed_main` (possibly `None`). This is PR A's seam: pills and "Different ideas" keep the main. |
| Anything else (a typed or classified meal ask) | `None`: an ordinary meal. The session's old `fixed_main` is overwritten with `None` when this stage writes its new state. |

On a fresh turn, `resolve_fixed_main` already returns the card, so the row is read **once**. On a `meal_followup` turn, `resolved = await load_fixed_main_card(user_id, retained_state.fixed_main)` re-reads it. A `FixedMainRefusal` at either step returns `_fixed_main_refused_state(state, kind)` (§6) **before** any constraint extraction or model call **in the stage**. The refusal is a `general_chat` reply with no proposal, so the router's usual follow-up pass (`_FOLLOW_UP_INTENTS`, `router.py:2055`) still runs one `suggest_follow_ups` call for its pills. That's accepted.

### 3b. Constraints

- **A fresh fixed-main turn does not call `extract_recipe_constraints`.** The message is client-canned ("Make Lemon Butter Pasta into a meal"), and extraction over it would turn the dish title into `must_use_ingredients`, forcing pasta into every side. The constraints come from §5 instead.
- **A `meal_followup` turn with a retained fixed main** runs PR A's inheritance path. The pill text is a real ask, and the retained constraints already carry §5's inherited values. There's one addition (review 1 S1), after `_finish_meal_followup_constraints`:
  - `haystack = f"{card.title} {' '.join(i.name for i in card.ingredients)}".lower()`.
  - Drop every `dietary` label where `_dietary_contradicted(label, haystack)` is true, **unless** it's in `card.dietary_tags` (case-insensitively).
  - That's needed because `_finish_meal_followup_constraints` re-runs `_combine_dietary_preferences` against the **pill text** only. Without the extra pass, a stored "vegetarian" that §5 set aside for a chicken main would come back on the first "Something quicker" tap.
- **Everything after** (`kitchen_limits`, `is_pantry_grounded`, `score_pantry_ingredients` on `{**state, "recipe_constraints": constraints}`, and the servings block) is unchanged. §5 sets `constraints["servings"]`, so the existing "explicit servings" branch picks it up.

### 3c. The prompt

When a fixed main is set:
- `cuisine_hint` is **skipped** (`""`). The main has already decided the cuisine. This is the one exception to PR A's "recent-cuisine weighting reaches the option prompt" AC, and the PR body says so.
- `MEAL_OPTIONS_FIXED_MAIN_BLOCK.format(...)` is inserted after `previous_block`. Its `{title}` is `outline.name` (§1b) with `"` replaced by `'`, so a title can't close the prompt's quotes.
- The pill rules, in this exact order (review 1 S6):
  ```python
  follow_ups_rules = (
      MEAL_OPTIONS_FOLLOW_UPS_RULES
      + (MEAL_OPTIONS_FIXED_MAIN_FOLLOW_UPS_RULE if fixed else "")
      + ("" if pantry_grounded else MEAL_FOLLOW_UPS_NO_PANTRY_RULE)
  )
  ```
- **The final line** (review 1 S4):
  - On a **fresh** fixed-main turn, it's built server-side from the card: `f"\n\nUser: Make {title} into a meal\n\nPropose 3 meal options:"`, with the same sanitised `title`. It's **never** built from `input_text`, because the deep link's `?title=` controls the message text, and a crafted title would otherwise reach the prompt.
  - On a `meal_followup` turn, it keeps `input_text` (the pill's text) as today.

Otherwise the prompt is byte-identical to today.

| Constant (`prompts/meal.py`) | Must say |
|---|---|
| `MEAL_OPTIONS_FIXED_MAIN_BLOCK` | `"\nThe main dish is fixed: \"{title}\"{cuisine_part}. Its ingredients: {ingredients}. Every option must use exactly this main, unchanged, as its one main dish, named \"{title}\". The options differ ONLY in their sides: give each option 1-2 sides that complement this main (don't repeat its main ingredient or its starch), and make each option's sides genuinely different from the other options' sides. This overrides the rule about different mains. The constraints above apply to the sides; never change the main."`. `{cuisine_part}` is `" ({cuisine})"` or `""`. `{ingredients}` is the first 20 names joined by `", "`, or `"not listed"` when there are none. |
| `MEAL_OPTIONS_FIXED_MAIN_FOLLOW_UPS_RULE` | `" The main is fixed, so follow_ups may only change the sides or the whole meal's timing, e.g. \"Make the sides lighter\", \"Something green on the side\" — never ask to change or replace the main."` |
| module docstring | Add the #651 PR B note, like PR A's. Prompt edits are CODEOWNERS-visible. |

### 3d. The server overwrite: every option keeps the given main

For each raw option, **instead of** `_normalize_option_dishes`, call `_fixed_main_option_dishes(raw.dishes, outline)`:

1. `same(a, b)` means the names are equal after `" ".join(x.split()).casefold()`.
2. `sides` = every raw dish with `role == "side"` and `not same(name, outline.name)`, in order, capped at 2. The model's own `main`, whatever it's called, is always discarded.
3. If `sides` is empty, the option is **dropped** (logged, like today's "no valid side").
4. Otherwise it returns `[outline, *sides]`, where `outline = fixed_main_outline(card)` (§1b).
5. **Retitle an option built around a discarded main** (review 1 S2). If the raw option had a `main`-role dish that isn't `same()` as `outline.name`, then:
   - `title = f"{outline.name} with {' & '.join(s.name for s in sides)}"`;
   - `blurb = None`.

   Otherwise the model's title and blurb are kept. This stops an option card reading "Garlic Prawn Feast" above a pasta main.

The rest of the loop is unchanged:
- Coverage and rescues come from `_compute_coverage_and_rescues(dishes, pantry_items)`, only when `pantry_grounded`. So the main's **real** ingredient names drive coverage and to-buy.
- `_meal_level_estimates` and `_apply_to_buy_cap` stay as they are. The main's to-buy count is the same in every option; if every option is over the cap, all of them are kept, as today.

If no option survives, it's the existing `_meal_generation_failed_state`.

### 3e. The return

When a fixed main is set:
- `assistant_message = f"Here's how I'd make {title} a meal — pick your sides!"`.
- `proposal.fixed_main = MealFixedMainEcho(recipe_id=<linked id or None>, title=title)`.
- `MealPlanSessionState(..., fixed_main=fixed)`:
  - for a saved source, `fixed` holds `source="saved"`, the id and the title, and **no card** (it's re-read at the pick);
  - for a chat source (or a draft copy), it holds `source="chat"` and the `RecipeCard` with a fresh id.
  - A draft row resolved by id becomes `MealFixedMain(source="chat", recipe=<card with a fresh id>)` at resolve time, so a draft is never linked.
- `meal_follow_ups` is cleaned as today.

Everything else in the return is unchanged.

## 4. The pick stage (`meal_pick_stage`, 929-1043, backend)

When `session_state.fixed_main` is set:

1. **Load the main:** `resolved = await load_fixed_main_card(user_id, session_state.fixed_main)`, then `card, linked_id = resolved.card, resolved.linked_recipe_id`.
   - A saved main is **re-read** here. If it was deleted between the option and pick turns, the result is `_fixed_main_refused_state(state, "not_found")`, with no model call.
   - If it's now a draft, it's a copy with `recipe_id=None`.
2. **Don't regenerate the main.** Only positions ≥ 1 are expanded, still concurrently in one `asyncio.gather`.
   - `with_follow_ups=True` goes on **position 1**, the first side. This is PR A's seam; the pill read at 1008-1011 is keyed on the pill-carrying position, not on `0`.
   - `_expand_dish_result` already names the main to each side through `option.dishes` (853-858), because the option's dish 0 is the fixed outline.
   - The call count is `len(option.dishes) − 1`.
3. **The main dish** is `MealDish(role="main", position=0, recipe=card, recipe_id=linked_id)`. `card.servings` is **the recipe's own servings**, not rescaled; the meal screen scales each dish to the meal's servings (`app/meals/[id]/page.tsx`, `scaledIngredients`). A card without structured steps is fine: the meal screen's `ensureSteps` (issue #652) upgrades it after save, and for a linked recipe that persists onto the user's own recipe, which is intended.
4. **Missing ingredients:** when `pantry_grounded`, `_missing_ingredients_for_recipe` also runs on the main card, so the list covers the whole meal.
5. **The reply** keeps PR A's format, with `main_title = card.title`.

When `fixed_main` is `None`, the stage is byte-identical to today (`with_follow_ups` stays on position 0).

## 5. Constraint inheritance from the recipe (backend, `fixed_main.py`)

`fixed_main_constraints(state, card) -> dict[str, Any]` builds the fresh fixed-main turn's `recipe_constraints` with **no model call**:

| Field | Value |
|---|---|
| `dietary` | `_combine_dietary_preferences(stored, inherited, {"preferred_ingredients": [i.name for i in card.ingredients]}, card.title)`, where `stored = await get_stored_dietary_preferences(user_id)` and `inherited = [t for t in card.dietary_tags if t.strip().lower() in INHERITABLE_DIETS]`. So a vegetarian main gets vegetarian sides. A stored "vegetarian" preference is set aside for a chicken main (#394's contradiction rule, with the main as the haystack), because the user picked that main. Non-diet tags ("quick", "comfort food") are never inherited. |
| `servings` | `card.servings` when it's an int from 1 to 20. Otherwise unset, so the stage falls back to `_default_servings`. |
| `meal_type` | `card.meal_type.strip().lower()` when it's `breakfast`, `lunch` or `dinner`. Otherwise unset. |
| `excluded_ingredients` | **Never dropped** (an allergy risk; review 1 B1). It's the case-insensitive union, first spelling kept, in order, of `session.metadata.recipe_constraints.excluded_ingredients` and the retained `meal_plan.constraints.recipe_constraints.excluded_ingredients`. Either may be absent. It's the same inheritance `extract_recipe_constraints` gives every other turn (`recipe/nodes.py:866-869`), and it reuses `_case_insensitive_union` (`meal/nodes.py:156-169`). The option prompt's `Exclude:` line (`_format_meal_constraints`) then carries it, and so does each side's `constraints_json` at the pick. |
| `use_pantry` | The pantry opt-out carries across: if either `session.metadata.recipe_constraints.use_pantry` or the retained `meal_plan.constraints.recipe_constraints.use_pantry` is `False`, it's **`False`**. Otherwise `True` if either is `True`. Otherwise unset. |
| everything else | Empty or unset. There are no `must_use` or `preferred` ingredients and no `kitchen_limits`. |

The dict is echoed in `MealConstraintsEcho.recipe_constraints` as usual, so a later `meal_followup` turn inherits the diet and servings through PR A's path. PR A's union rule keeps the inherited diet when "Something quicker" is tapped.

## 6. Edge cases

| Case | Behaviour |
|---|---|
| **Deleted recipe**, or **another user's** id, or a well-formed id that was never real | At the option stage, `get_recipe` raises or returns nothing, which gives `not_found`. At the pick stage, the re-read misses, which also gives `not_found`. The reply is `general_chat` with `next_action: none`, no proposal, no model call in the stage (the router's usual follow-up pill pass still runs, §3a), and `session.metadata.meal_plan` untouched. The text is **"I couldn't find that recipe in your library — it may have been deleted. Pick another recipe, or ask me to plan a meal."** Deleted **after** the meal is saved: `meal_dishes` cascades, which is the existing mainless-meal handling. Deleted **after the pick but before Save**: `POST /api/meals` returns 400, and the card shows its error state (a known gap, §16). |
| **Malformed** (`recipe_id` isn't a UUID, both or neither key, payload over 32 KB, or a payload that fails the model or has a blank title) | `invalid`, with the same state shape. The text is **"I couldn't read that recipe. Try again from the recipe card, or ask me to plan a meal."** |
| **Draft recipe** | The chat card never sends a draft's id: it sends `recipe_id` only when its own Save succeeded (§8). A draft id that still arrives (the saved lookup's draft rows under issue #662, or a recipe page opened on a draft) is used **as a payload copy**: `source="chat"`, a fresh id, `recipe_id=None`. Saving the meal then inserts a new dish recipe, and the draft is never linked, promoted or deleted by the meal. |
| **Recipe with no ingredients** | Allowed. `key_ingredients == []`, the prompt says "Its ingredients: not listed", coverage counts only the sides, and `missing_ingredients` has nothing from the main. A recipe with no instructions is also allowed: `ensureSteps` returns `[]` with no model call (`services/structured_steps.py:87-91`). |
| **In-chat recipe that's never saved** | It's sent as a payload, retained in the session as a `RecipeCard`, and used verbatim at the pick. It becomes a library row only when the meal is saved (inserted like any new dish, `is_draft` = the meal's). If the user *also* taps Save on the chat card, there are two rows: a known limitation (S12), stated in the PR. |
| **Pantry opt-out** | §5's `use_pantry` rule. The option stage then uses `MEAL_OPTIONS_SYSTEM_PROMPT_NO_PANTRY` with no pantry context, `coverage: null` and no rescues, and never reads the pantry. The pick stage never reads the pantry either, and `missing_ingredients` is `[]`. Both stages add the no-pantry pill rule. Nothing from the payload's `ingredient_availability` survives, because `fixedMainPayload` strips it and the model ignores extras. |
| **"Make it a meal" tapped twice** | *Rapid double tap on a chat card:* the first tap calls `sendMessage`, which sets `isStreaming` true. React flushes a discrete event's state updates **synchronously**, so the card re-renders with `makeMealDisabled` before the second click is dispatched, and that click lands on a disabled button. That is the real guard. `sendMessage`'s own `isStreaming` check (`useChat.ts:245`) reads the closure's value and is only a backstop for a later call. Exactly one request. *A re-tap after the options arrive:* it's allowed, sending a fresh fixed-main turn that gives new sides for the same main. Nothing is written, so that's harmless, and the latest option set wins in the session. *A saved-lookup card:* it's disabled once it's no longer the last settled message. *The recipe page:* a Link, so two taps give the same URL, and the seed sends once per mount (`seedSentRef`, key `meal:<id>`); the StrictMode double mount is already covered. |
| **A cook is pinned in chat** (`cookingRecipe`), or this card's `cookState === 'started'` | The page omits `onMakeMeal`, so there's no button. It's disabled while `cookState === 'pending'`. |
| **Old retained session** (no `fixed_main` key) | It validates with `fixed_main=None`, and the pick is unchanged. |
| **A typed follow-up after a fixed-main options reply** ("make the sides lighter", typed) | It's unstamped, so it goes to the classifier. If it's classified `meal_plan`, it's an ordinary option turn **without** the fixed main. This is a known gap, the same class as PR A's "✎-edited pills lose the stamp" (§15). |

## 7. The entry points (components, ui-ux)

It's a **button on each card, not a pill.** The recipe-card branch renders no chip row today (`page.tsx:1207-1243`), and an action pill there would duplicate the button (§15).

| Surface | File and component | What renders |
|---|---|---|
| **Chat recipe card** | `components/chat/ChatRecipeCard.tsx`, `ChatRecipeCard` | When `onMakeMeal` is set: a full-width secondary button **between** the Save / Try Another row (234-257) and "I already made this" (261-270). The label is `🍽️ Make it a meal`, with the emoji in an `aria-hidden` span. The classes are exactly Try Another's (253), with `w-full` in place of `flex-1`: `w-full py-2 px-3 rounded-full text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-muted)] hover:bg-[var(--color-bg)] disabled:opacity-60 disabled:cursor-not-allowed`. It's `disabled={makeMealDisabled \|\| cookState !== 'idle'}`, and it's a `SpringButton`. |
| **Saved-recipe lookup results** | `components/chat/SavedRecipeMatches.tsx`, `SingleMatchCard` (the one-match card and the many-match expanded card) | When `onMakeMeal` is set: a full-width secondary `<button type="button">` **below** the Open recipe / Cook this row (213-241), labelled `🍽️ Make it a meal`. It's `disabled={disabled}`, and `onClick={() => !disabled && onMakeMeal(match)}`. Mini cards are unchanged, and focus-on-expand still lands on Open recipe because the new button comes later in the markup. |
| **Recipe page** | `app/recipes/[id]/page.tsx` (frontend, per S15), `RecipeDetailPage` | A full-width `<Link href={makeMealHref(id, recipe.title)}>` styled as a secondary pill, placed **after the meta row (243-252) and before the description**. It's not in the header, where a third button would wrap at 375 px beside Edit with AI and Delete. The label is `🍽️ Make it a meal`. It renders only in the loaded state (never on the 404 or error screen). |

Out of scope: the RecipeBook sheet (`components/recipes/RecipePage.tsx`), `MealDishCard` and the brainstorm idea cards.

## 8. Chat page wiring (`app/chat/page.tsx`, frontend)

- **The handlers,** next to `handlePickMealOption` (473). Both use `sendMessage`, **never** `sendChipMessage`, which would abort a live stream and defeat the double-tap guard.
  ```ts
  const handleMakeMealFromCard = (msgId: string, recipe: ChatRecipeData) => {
    // Linked only when THIS card's own Save succeeded: that row is non-draft by construction.
    // A cook-with-me draft (draftRecipeIds) or an unknown id sends the payload (§6).
    const savedId = saveStates[msgId] === 'saved' ? savedRecipeIds[msgId] : undefined
    sendMessage(makeMealMessage(recipe.title), { meal_fixed_main: fixedMainForCard(recipe, savedId) })
  }
  const handleMakeMealFromMatch = (match: SavedRecipeMatch) => {
    sendMessage(makeMealMessage(match.title), { meal_fixed_main: { recipe_id: match.id } })
  }
  ```
- **`MessageRendererProps`** gains:
  - `onMakeMealFromRecipe: (recipe: ChatRecipeData) => void`;
  - `onMakeMealFromMatch: (match: SavedRecipeMatch) => void`;
  - `makeMealAvailable: boolean` (`!cookingRecipe`).
  - The renderer already receives `isStreaming`.
- **The recipe-card branch** (1228-1238):
  - `onMakeMeal={makeMealAvailable && cookState !== 'started' ? () => onMakeMealFromRecipe(recipe) : undefined}`;
  - `makeMealDisabled={isStreaming}`.
- **The saved-lookup branch** (1115-1119): `onMakeMeal={makeMealAvailable ? onMakeMealFromMatch : undefined}`.
- **The options branch** (1163): `resolveChips(intent, suggestions, proposal.proposal_type, { fixedMain: Boolean(proposal.fixed_main) })`.
- **Save and Open of a meal** are unchanged in the page. `buildCreateMealPayload` does the linking (§10).

### 8a. The resolver (`lib/chat-chips.ts`, frontend)

- `opts` becomes `{ mealSaved?: boolean; fixedMain?: boolean }` on both `resolveStaticChips` and `resolveChips`.
- Under `meal_plan` + `meal_options` (or absent) **with `fixedMain`**, two pills are replaced **in place**, both stamped `meal_followup`:
  - "Something quicker" becomes **Quicker sides** (send, message "Quicker sides, under 20 minutes", ⚡, fresh). The main's own time is fixed, so only the sides can get quicker.
  - "Make it vegetarian" becomes **Lighter sides** (send, message "Make the sides lighter", 🥗, accent).
- The set becomes Quicker sides · Lighter sides · Different ideas. The reserved "Different ideas" slot and every other PR A rule are unchanged.
- `fixedMain` is ignored for every other intent and for `proposalType === 'meal'`.

## 9. The `meal` seed and the recipe page link (`lib/chat-seed.ts`, frontend)

- **`deriveChatSeed`** checks `meal` **first** (the precedence is cooking > meal > plan > tip > use; cooking is already excluded at `page.tsx:95-98`):
  ```ts
  const mealId = param(params, 'meal')
  if (mealId && UUID_RE.test(mealId)) {            // UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const title = param(params, 'title')?.slice(0, 120) ?? null
    return {
      key: `meal:${mealId.toLowerCase()}`,
      kind: 'meal',
      message: makeMealMessage(title),
      context: { meal_fixed_main: { recipe_id: mealId } },
      card: { emoji: '🍽️', label: 'Make it a meal', title: 'Making it a meal',
              subtitle: title ?? 'Your saved recipe', dismissLabel: 'Dismiss make-it-a-meal context' },
    }
  }
  ```
  A `meal` value that isn't a UUID falls through to plan, tip and use, as if it were absent.
- **No fetch:** the title rides in the URL (S5), so the auto-send never waits on a request.
- **`makeMealMessage`:** a trimmed title, with the whole title kept, gives `Make ${title} into a meal`; otherwise `Make a meal around your recipe`.
- **`makeMealHref(id, title)`:** `/chat?${new URLSearchParams({ meal: id, ...(title?.trim() ? { title: title.trim() } : {}) })}`.
- **The seed effect** (279-291) already forwards `seed.context`, so there's no page change. The starter pills already hide while a seed is active.
- **The header comment** (1-28) gains `?meal=<id>&title=<title>` (issue #651 PR B), and `meal_fixed_main` joins the recognised context keys. The note that the seed lives in the message text "unless `ChatSeed.context` is set" now applies to `meal` too.

## 10. Saving a meal with a linked main (frontend)

- **`buildCreateMealPayload`** (`lib/meal-chat-helpers.ts:17-52`): a dish with a non-empty `recipe_id` is sent as `{ role, position, recipe_id }` with **no** `recipe` payload. Every other dish is unchanged.
- Replace the stale comment (10-16) with: "Every generated dish is sent as a new recipe payload. A fixed saved main (issue #651 PR B) carries `recipe_id` and is sent as a reference, which `POST /api/meals` links without copying."
- **`POST /api/meals`** is unchanged. It already links by id after a user-scoped select (118-133), and a miss is still a 400 (B2).
- **Draft cleanup** is unchanged. It already keeps non-draft dish recipes (`[id]/route.ts:126-178`), and a linked main is always non-draft (§6). A test pins it (§13).
- **Promoting a meal** (`promoteMeal` / `promoteMealDishes`) only flips *draft* dish recipes, so a linked saved main is untouched.
- **Idempotency** on `source_ref` / `meal_ref` is unchanged.

## 11. Ownership and landing order

| Role | Files |
|---|---|
| **backend** | `models/meal.py`, `workflows/meal/fixed_main.py` (new), `workflows/meal/nodes.py`, `prompts/meal.py`, `workflows/router.py` (the shortcut and docstring only), `models/requests.py` (docs), `tests/test_issue_651_make_it_a_meal.py` (new) |
| **ui-ux** | `components/chat/ChatRecipeCard.tsx`, `components/chat/SavedRecipeMatches.tsx`, their component tests |
| **frontend** | `types/chat.ts`, `lib/chat-seed.ts`, `lib/meal-chat-helpers.ts`, `lib/chat-chips.ts`, `app/chat/page.tsx`, `app/recipes/[id]/page.tsx`, `CONTEXT.md` (the **Fixed main** term: the dish a make-it-a-meal flow keeps as the main, referenced by recipe id when saved), the contract copy at `docs/plans/2026-09-30-issue-651-b-make-it-a-meal-contract.md`, their tests |

**Order:**
1. **A seam commit lands first,** made by a single agent before any parallel work. It contains:
   - §1c's types in `types/chat.ts`;
   - `ChatSeedKind` with `'meal'`, plus `makeMealMessage` and `makeMealHref` in `lib/chat-seed.ts`, implemented as specified (they're small and pure);
   - `fixedMainPayload` and `fixedMainForCard` in `lib/meal-chat-helpers.ts`, implemented;
   - §1d's props, accepted but unused, on both components.

   `npx tsc --noEmit` and jest must be green on that commit.
2. **Then, in parallel:**
   - ui-ux: the buttons;
   - frontend: the page wiring, the seed branch in `deriveChatSeed`, the resolver, the payload builder, the recipe page and the `docs/plans/` contract copy. Frontend writes `__tests__/chat-make-it-a-meal.test.tsx` **last**, once ui-ux's buttons are in the shared worktree: the page test clicks the real buttons, and against the seam's unused props it would fail for the wrong reason;
   - backend: independently, since the wire is additive, the old client is unaffected, and an old server ignores the new key.
3. **Verify** runs last, against the running app with both halves (§14).

Backend needs **no classifier fixture re-capture**: the shortcut makes no model call, and no new phrase needs to classify.

## 12. The ACs of issue #651 that PR B satisfies

- [x] **Make it a meal** works from the chat recipe card, the saved-recipe lookup results and the recipe page. The resulting options all keep the given main, and for a saved recipe the meal references the same recipe id.
- [~] **Tests:** workflow tests that make-it-a-meal keeps the main (§13), plus the `meal` seed tests. The "saved lookup returns meals" test is PR C.
- [~] **`verify`:** make-it-a-meal from a chat recipe card, plus the saved card and the recipe page (§14). "Make that pasta dinner again" is PR C.

## 13. Tests (each would fail without the change)

### Backend (`tests/test_issue_651_make_it_a_meal.py`)

Stub at the `AIManager` boundary, dispatching on `response_schema` (as PR A's suite does), and at the repository boundary (`get_repository` in `workflows.meal.fixed_main` and `workflows.meal.nodes`). Patch `get_stored_dietary_preferences` in `workflows.meal.fixed_main`.

- **Routing** (the shortcut test fails without the change; the rest are **regression guards** that pin the precedence and the exact-type rule, and would pass on a correct implementation either way):
  - `{meal_fixed_main: {recipe_id: <uuid>}}` makes `classify_intent` return `meal_plan` at confidence 1.0 with the classifier stubbed to **raise**. That holds with `session_mode` COOKING and with a `picked_recipe` in the session. *(Without the shortcut, the classifier stub raises.)*
  - `{meal_fixed_main: "x"}`, `[]` and `None` all reach the classifier.
  - `{meal_fixed_main: {...}, meal_option_id: "opt_1"}` routes to `meal_pick_stage`.
  - `{meal_fixed_main: {...}, meal_followup: True}` goes to the option stage **without** inheritance: the retained options' titles are absent from the prompt.
- **The option stage keeps the main:**
  - A saved row `{id, title: "Lemon Butter Pasta", ingredients: [spaghetti, butter, lemon], tags: ["vegetarian", "quick"], servings: 4, is_draft: False}` is combined with a model result of three options:
    1. main "Lemon Butter Pasta" plus two sides;
    2. main **"Garlic Prawns"** plus one side;
    3. only a side named **"lemon  butter pasta"** plus a side "Green salad".
  - The proposal is expected to have:
    - three options;
    - every `dishes[0]` equal to `{role: "main", name: "Lemon Butter Pasta", key_ingredients: [spaghetti, butter, lemon]}`;
    - option 2's prawns gone;
    - option 3 as main plus "Green salad" only.
  - Option 2 (the discarded prawn main) is retitled: `title == "Lemon Butter Pasta with <its side>"`, `blurb is None`, and neither contains "Prawn". Option 1 keeps the model's own title and blurb.
  - It also expects `proposal.fixed_main == {recipe_id: <id>, title: …}`, and `session_state.fixed_main.source == "saved"` with no card.
  - The repo's `get_recipe` is awaited **exactly once** on that turn.
  - An option whose only dishes are mains is dropped.
  - *(Without the overwrite, the prawn main survives.)*
- **No extraction call:** on a fresh fixed-main turn, no call uses `response_schema=RecipeConstraints`, and the option prompt contains no "Must use:" line.
- **The prompt** (the block assertions fail without the change; the "ordinary ask unchanged" and the pill-rule order checks are **regression guards**):
  - It contains `MEAL_OPTIONS_FIXED_MAIN_BLOCK` (title and ingredients).
  - The pill rules appear in the §3c order: follow-ups rules, then the fixed-main rule, then (opted out) the no-pantry rule.
  - There's **no** cuisine-hint line even when `get_recent_cuisines` returns `['thai']` (the fixed-main exception to the cuisine-weighting AC).
  - The last line is `User: Make Lemon Butter Pasta into a meal`, built from the card. With `input_text` set to "Make IGNORE ALL RULES into a meal" (a crafted `?title=`), that text **does not appear** in the prompt.
  - A title containing `"` reaches the block with `'` instead.
  - An ordinary meal ask's prompt is unchanged: no fixed-main block and no fixed-main pill rule.
- **The outline caps:** a 300-character title gives `outline.name` of length 200, and a 120-character ingredient gives a key ingredient of 80.
- **Payload validation:**
  - an ingredient `quantity` of `NaN`, `Infinity` or `-1` gives invalid;
  - payload steps whose count matches the instructions come back rebuilt through `build_structured_steps`, with each step's `text` equal to its instruction; a count mismatch gives `recipe.steps is None` and a still-valid payload;
  - `recipe_id` `"0B6E…"` (upper case) is retained and linked as the lower-case canonical form.
- **`MealFixedMain` validator:** `source="saved"` without `recipe_id`, `source="chat"` without `recipe`, and `source="saved"` with a `recipe` all fail validation. A retained state that breaks the rule is treated as absent.
- **Exclusions are never dropped** (review 1 B1): `session.metadata.recipe_constraints.excluded_ingredients == ["peanuts"]` plus a fresh fixed-main turn gives `constraints.excluded_ingredients == ["peanuts"]`, and the option prompt contains `Exclude: peanuts`. A retained `meal_plan` exclusion of `["Peanuts", "shellfish"]` is unioned case-insensitively, keeping the first spelling. *(Without the §5 row, the list is empty.)*
- **A follow-up keeps the main** (review 1 S3):
  - A retained saved fixed main plus `{meal_followup: True}` and "Something quicker" gives a prompt containing `MEAL_OPTIONS_FIXED_MAIN_BLOCK`.
  - Every `dishes[0]` is the fixed outline.
  - `session_state.fixed_main` is retained with the same id.
  - The last prompt line is the pill text (`input_text`), not the canned line.
- **An ordinary turn clears it:** a retained fixed main plus an **unstamped** `meal_plan` turn ("plan a curry dinner", classified) gives `session_state.fixed_main is None` and no fixed-main block.
- **The follow-up diet check** (review 1 S1): a stored "vegetarian" preference plus a **chicken** main, then a `meal_followup` "Something quicker" turn (with the real extraction, dispatch-stubbed as in PR A's suite), gives no "vegetarian" in `constraints.dietary`. With a vegetarian-tagged main, "vegetarian" survives.
- **Inheritance:**
  - The fixture above gives `constraints.dietary == ["vegetarian"]` (the "quick" tag isn't inherited) and `proposal.servings == 4`.
  - A row with `servings: 40` falls back to `_default_servings`.
  - A stored "vegetarian" preference plus a **chicken** main gives a `dietary` without vegetarian.
  - A retained `meal_plan` with `use_pantry: False` gives the NO_PANTRY system prompt, `coverage is None`, and `get_all_pantry_items` never awaited.
- **The pick reuses the main:**
  - With a retained saved fixed main and `meal_option_id`, `complete` is awaited exactly `len(dishes) − 1` times, and no call's prompt says `Generate a complete recipe card for "Lemon Butter Pasta"`.
  - `dishes[0].recipe_id == <id>`, and `dishes[0].recipe` has the row's ingredients and servings 4.
  - Exactly one call uses `MealDishLLMResult`: the **position 1** side. Its pills land in `follow_up_suggestions`.
  - A chat-source fixed main gives `dishes[0].recipe_id is None`, and `dishes[0].recipe.title` equals the payload's title.
  - *(Without the change, the main is regenerated and has no id.)*
- **Ownership:** the repo stub returns a row only for `(user A, id)`. Calling as user B gives the not-found message, no proposal, `intent == general_chat`, and no model call **in the stage** (the meal AI stub is never awaited; the router's follow-up pass is stubbed out of scope). The repo was called with **B's** user id.
- **Edge cases:**
  - a deleted id at the option stage gives not-found;
  - a deleted id at the **pick** (the row existed at options time, then the stub returns nothing) gives not-found, with no model call;
  - a non-UUID `recipe_id` gives invalid;
  - both keys give invalid;
  - a 40 KB payload gives invalid, and the model isn't called;
  - a blank title gives invalid;
  - a draft row by id gives `session_state.fixed_main.source == "chat"`, a fresh `recipe.id != <draft id>` and `proposal.fixed_main.recipe_id is None`; at the pick, `dishes[0].recipe_id is None`;
  - a no-ingredients main gives a prompt saying "not listed" and `key_ingredients == []`, and the options still build;
  - an old retained state without `fixed_main` validates, and the pick is unchanged (position 0 carries the pills).
- **`recipe_card_from_row`:** `tags` maps to `dietary_tags`, string ingredients are handled, and steps whose count doesn't match the instructions give `None`.
- **The existing #650, #651 and #652 suites pass unchanged.**

### Frontend

- **`__tests__/meal-chat-helpers.test.ts`** (new):
  - `buildCreateMealPayload` with a `recipe_id` main sends `{role:'main', position:0, recipe_id}` with no `recipe`, while the sides keep their payloads;
  - with no ids, the output is identical to today's;
  - `fixedMainPayload` strips `ingredient_availability`, drops blank-named ingredients and falls back to 'Untitled recipe';
  - `fixedMainForCard(recipe, 'id')` gives `{recipe_id}`, and `(recipe, undefined)` gives `{recipe}`.
- **`__tests__/chat-seed.test.ts`** (extend):
  - `?meal=<uuid>&title=Lemon%20pasta` gives the §9 seed, with `context.meal_fixed_main.recipe_id` and the message "Make Lemon pasta into a meal";
  - with no title, the message is "Make a meal around your recipe" and the subtitle is "Your saved recipe";
  - `?meal=nope&plan=dinner` gives the plan seed;
  - `?meal=<uuid>&plan=dinner` gives the meal seed;
  - a 300-character title is capped at 120;
  - `makeMealHref` round-trips through `deriveChatSeed`.
- **`__tests__/chat-deep-links.test.tsx`** (extend): `/chat?meal=<uuid>&title=X` auto-sends exactly once under the StrictMode double mount, with `context: { meal_fixed_main: { recipe_id } }`, and the context card shows.
- **`__tests__/chat-chip-resolver.test.ts`** (extend):
  - `meal_options` with `fixedMain` swaps "Something quicker" for "Quicker sides" and "Make it vegetarian" for "Lighter sides", in place and both stamped;
  - without `fixedMain`, the set is unchanged;
  - `fixedMain` has no effect on `meal` or other intents;
  - `resolveStaticChips` equals `resolveChips` with no suggestions, for the `fixedMain` cases too.
- **`__tests__/chat-make-it-a-meal.test.tsx`** (new, page level; mock `fetchStarterContext` and the chat stream):
  - Tapping Make it a meal on a chat recipe card sends a request with `context.meal_fixed_main.recipe` (no `ingredient_availability`) and the message "Make {title} into a meal".
  - After Save succeeds on that card, the request carries `{recipe_id}` instead.
  - After Cook with me (a draft), it carries a payload.
  - **Two synchronous clicks give exactly one request.**
  - The button is absent under `?cooking=`.
  - The single saved-match card's button sends `{recipe_id: match.id}`.
  - An options reply carrying `fixed_main` renders "Quicker sides" and "Lighter sides".
  - Written **last** (§11), after ui-ux's buttons are in the worktree.
- **`__tests__/recipe-detail-make-meal.test.tsx`** (new): the loaded page has a link named "Make it a meal" to `/chat?meal=<id>&title=<title>`, and the 404 page has none.
- **`__tests__/meals-id-route.test.ts`** (extend): DELETE of a meal whose main is a linked **non-draft** recipe deletes no recipe row (the S11 "add a test anyway").
- **`__tests__/meals-route.test.ts`:** confirm an existing `recipe_id` link test covers "links without inserting into recipes". If it doesn't, add one asserting no `recipes.insert` for that dish, and a 400 for a foreign id.

### ui-ux

- **`__tests__/chat-recipe-card-render.test.tsx`** (extend):
  - No button without `onMakeMeal`.
  - With it, a button named "Make it a meal" calls `onMakeMeal` once.
  - It's disabled when `makeMealDisabled` is set, or when `cookState` is `'pending'` or `'started'`.
  - Its markup sits between Try Another and "I already made this".
- **`__tests__/saved-recipe-matches.test.tsx`** (extend):
  - The one-match card shows the button when `onMakeMeal` is set, and a click calls it with the match.
  - Many matches: no button on the mini cards. The expanded card has it, and focus-on-expand still lands on Open recipe.
  - With `disabled`, a click does nothing.

## 14. The `verify` list (running app, 375 × 812 viewport; screenshots in the PR body)

1. **Chat card:** ask "a lemon butter pasta recipe". The recipe card shows **Make it a meal** below Save / Try Another, with nothing wrapped or overflowing at 375 px. Tap it: the user bubble reads "Make Lemon Butter Pasta into a meal", and the option cards all have **Lemon Butter Pasta** as main, with different sides. The pill row shows "Quicker sides" and "Lighter sides", not "Something quicker" or "Make it vegetarian".
2. **Pick:** tap an option. The compact meal card's main is the same title, and there are pills. Open meal: the main's ingredients on the meal screen match the chat card's (it wasn't regenerated).
3. **Different ideas:** tap it under the options. New sides, same main.
4. **Saved recipe from the recipe page:** open `/recipes/<id>` and tap **Make it a meal** (the button is under the meta row, and the header isn't wrapped). The chat opens with the 🍽️ "Making it a meal" card and sends exactly one message. Pick, then **Save meal**. In Supabase, the new meal's position-0 `meal_dishes.recipe_id` is **the same id**, and the `recipes` row count went up only by the side count. Screenshot the SQL result.
5. **Saved lookup:** "show me my saved lemon butter pasta". The single card shows Open recipe / Cook this, then **Make it a meal**. Tap it, and the request carries `recipe_id` (network panel).
6. **Double tap:** tap the chat card's button twice quickly. There's one user bubble and one request.
7. **Pantry opt-out:** say "don't use my pantry for this", get a recipe card, and make it a meal. The option cards show no "uses N of your items" chip or rescue flag.
8. **Deleted recipe:** open `/chat?meal=<a deleted recipe's id>&title=Gone`. The friendly not-found reply shows, with no cards.
9. **Malformed id:** open `/chat?meal=not-a-uuid`. It's a plain empty chat with starter pills and no seed card.
10. **Pinned cook:** under `?cooking=<id>`, a recipe card in the thread shows **no** Make it a meal button.
11. **Delete the meal** from item 4 (it's saved, so delete it from the meal screen). The original saved recipe still opens at `/recipes/<id>`.

## 15. Reversible product calls (for the sprint doc)

| Call | Rejected alternative |
|---|---|
| Make it a meal is a **button** on each card, not a pill. | An action pill: the recipe-card branch has no chip row, so it would need a new row just to duplicate the button, and pills belong under replies, not on library cards. |
| The recipe-page button is a full-width link **under the meta row**. | A third header button beside Edit with AI and Delete, which wraps at 375 px. |
| A fresh fixed-main turn builds its constraints **deterministically** from the recipe (§5), with no extraction call. | Running `extract_recipe_constraints` over the canned "Make X into a meal", which turns the dish title into must-use ingredients for every side and costs a model call. |
| Meal servings come from **the recipe's servings** (1–20). Otherwise the default rule applies, and an explicit number on a later pill still wins. This revises S11. | The default rule only (S11), which plans sides for 2 around a saved dinner for 4 and makes the meal screen rescale the main on first open. |
| Only **diet** tags (a six-item allow-list) are inherited. A stored diet that the main contradicts is set aside (#394). | Inheriting every tag (for example "quick" or "comfort food" as dietary), or forcing a stored "vegetarian" onto sides for a chicken main. |
| The pantry opt-out: **False wins** across the session's recipe constraints and the retained meal. | The most recent source wins, which is unknowable because neither is timestamped, and a wrong guess reads the pantry after an opt-out. |
| The recent-cuisine hint is **skipped** under a fixed main. | Keeping it, which pulls sides toward, say, Thai for an Italian main. |
| The model's own main is **always discarded** server-side, and so is a side that repeats the main's name. | Trusting the model to keep the main, which PR B's AC can't rely on. |
| An option left with no side is **dropped**, as today. | Padding it with a generated side. |
| A saved main is **re-read at every stage**, so a deletion between turns is caught before any model call. | Caching the row in the session, which could link to a deleted id. |
| A draft id becomes a **payload copy** on the backend too (B3, defence in depth for issue #662). | Linking a draft, which the meal's DELETE would then remove, and Save would silently promote. |
| The chat card links by id only after **its own Save succeeded** (`saveState === 'saved'`). | Trusting `savedRecipeIds` alone, which after Cook with me holds a draft id. |
| A re-tap after the options arrive is **allowed** (new sides, nothing written); only a concurrent re-tap is blocked. | A one-shot latch per card, which leaves no retry after a model failure. |
| Under a fixed main, **"Lighter sides"** replaces "Make it vegetarian" in the option-stage fixed set. | Keeping "Make it vegetarian", which asks for vegetarian sides beside a meat main. |
| Under a fixed main, **"Quicker sides"** ("Quicker sides, under 20 minutes") replaces "Something quicker" (review 1 nit). | "Something quicker, under 30 minutes", which promises a total the fixed main may already exceed. |
| An option built around a discarded model main is **retitled** "{main} with {sides}", and its blurb dropped (review 1 S2). | Keeping the model's title and blurb, which describe a main the card no longer has. |
| A fresh fixed-main prompt's `User:` line is **built from the card** (review 1 S4). | Using `input_text`, which the deep link's `?title=` controls. |
| Exclusions are **inherited, never dropped**, on a fresh fixed-main turn (review 1 B1). | Starting a fixed-main turn from empty constraints, which loses a stated allergy. |
| On a follow-up, a diet the fixed main contradicts is dropped again unless the main carries that tag (review 1 S1). | Letting `_finish_meal_followup_constraints` re-add it from the stored preference against the pill text alone. |
| `ChatRecipeData.ingredients` is **widened** with `preparation` and `optional` (review 1 nit, my choice). | Dropping both from the payload, which loses prep notes and optional flags on the saved meal. |
| `meal_fixed_main` beats `meal_followup` and never inherits. | Merging the two, where a new main could inherit an old meal's constraints. |
| A malformed dict still routes to `meal_plan` and gets a friendly refusal. | Ignoring it and sending the canned text through the classifier, which gives an unpredictable intent. |
| No-ingredient mains are **allowed** (the title-only prompt). | Refusing them, which blocks meals around sparse URL imports. |
| The option reply reads "Here's how I'd make {title} a meal — pick your sides!" | "Here are three meal ideas!", which reads wrong when every card has the same main. |

## 16. Not in PR B

- **PR C, the meal-again lookup:** `search_saved_meals`, `metadata.saved_meal_matches`, `SavedMealMatchCard`, and the "make that pasta dinner again" classifier fixtures. PR C's body carries `Fixes #651`.
- **Other surfaces:** Make it a meal from the RecipeBook sheet (`components/recipes/RecipePage.tsx`), from `MealDishCard` on the meal screen, from brainstorm idea cards, or from the dashboard suggestion.
- **Typed requests:** a *typed* "make lemon pasta into a meal" (no context). It goes through the classifier as today, and PR B adds no classifier fixture or prompt change.
- **Keeping the main on typed follow-ups** after a fixed-main options reply (§6, the last row). Pills and "Different ideas" keep it.
- **Swapping the main** on the meal screen (the meal screen swaps sides only, per issue #652).
- **Known gaps, stated in the PR:**
  - The payload main and a separate card Save give two rows (S12).
  - A saved main deleted between the pick and Save makes Save fail with the card's error state, not a silent copy.
  - `savedRecipeIds` isn't persisted, so after a reload a saved chat card sends a payload (a copy).
  - **The `handleSaveRecipe` draft-id window** (`page.tsx:386-390`). `saveStates[msgId]` flips to `'saved'` at 386, but `savedRecipeIds[msgId]` is only overwritten after `res.json()` resolves (388-390). A Make it a meal tap inside that window, after an earlier Cook with me, reads `saveState === 'saved'` alongside the **old draft** id. The backend's draft-to-copy rule (§6) covers it: the draft is copied, never linked. The page isn't changed for it.
- **Out of scope:** the final visual design of the button (Goal 3). Any change to `POST /api/meals`, the meal DELETE rules, `suggest_follow_ups`, or non-meal chip sets. The draft-lookup bug itself (issue #662).

## 17. Where this departs from the original contract and review 1

- **§3 of the original contract** named `existing_recipe_id`. **B2** already replaced it with the existing `CreateMealDish.recipe_id`, and PR B follows B2.
- **S11:**
  - Kept: drop sides that repeat the main's name, overwrite the main, full ingredient names as key ingredients, the hands-on time rule, coverage only when grounded, `fixed_main` in `MealPlanSessionState`, re-reading at the pick, uuid validation, and catching repository errors.
  - **Revised:** meal servings come from the recipe's servings first (§15).
  - **Tightened:** the model's main is always discarded. Only `side`-role dishes are ever kept.
- **B3** is kept on the client, and PR B adds the backend's draft-to-copy conversion for ids that reach it from the saved lookup (issue #662) or the recipe page.
- **S5:** the `meal` seed takes its title from the URL, with no fetch, as S5 decided. The seed key lower-cases the id.
- **S16** is kept: no button while a cook is pinned or started, and only the single or expanded saved card has one. PR B adds "disabled while streaming".
- **New in PR B, not in either earlier doc:**
  - deterministic constraints on the fresh turn (§5);
  - the 32 KB payload cap and field limits (§1a, §1b);
  - `MealOptionsProposal.fixed_main` and the "Lighter sides" swap (§8a);
  - skipping the cuisine hint under a fixed main;
  - the pantry opt-out's False-wins rule.

## §R. Review 1 resolutions

Review 1's verdict was **ready to delegate after amendments**. Every amendment is applied in place. One nit was checked and left as it was (the last row).

| Item | Resolution | Where |
|---|---|---|
| **B1** A fresh fixed-main turn dropped the session's `excluded_ingredients` (an allergy risk) | Applied. `excluded_ingredients` is the case-insensitive union of the session's and the retained meal's lists, and it's never dropped. The test covers `["peanuts"]` reaching the constraints and the prompt's `Exclude:` line. | §5 table, §13 |
| **S1** A stored diet the main contradicts came back on a follow-up | Applied. After `_finish_meal_followup_constraints`, labels that `_dietary_contradicted` flags against the card's title and ingredients are dropped, unless the card carries that tag. The test covers vegetarian plus chicken, then "Something quicker". | §3b, §13 |
| **S2** The model's discarded main left its title and blurb on the card | Applied. §3d step 5 retitles such an option "{main} with {sides}" with `blurb = None`. The fixture's option 2 has no "Prawn". | §3d, §13, §15 |
| **S3** Tests for follow-up inheritance and for clearing | Applied: a follow-up keeps the block, the outline and `fixed_main`; an unstamped `meal_plan` turn gives `fixed_main is None`. | §13 |
| **S4** The prompt's `User:` line was built from `input_text`, which the deep link's `?title=` controls | Applied. A fresh turn builds it from the card, and follow-ups keep `input_text`. There's an injection test. | §3c, §13, §15 |
| **S5** No caps or quoting on the title and ingredients | Applied: `name = " ".join(title.split())[:200]`, key ingredients at most 80 characters, and `"` becomes `'` in the prompt `{title}`. | §1b, §3c, §13 |
| **S6** The pill-rule ordering contradiction | Applied, with the exact `follow_ups_rules` expression and an order assertion. | §3c, §13 |
| **S7** Test ordering and ownership of the contract copy | Applied. `chat-make-it-a-meal.test.tsx` is written last, after ui-ux's buttons land. Frontend owns the `docs/plans/` copy. | §11, §13 |
| **S8** `fixed_main_constraints` wasn't declared | Applied: `async def fixed_main_constraints(state: WorkflowState, card: RecipeCard) -> dict[str, Any]`, which never raises. | §1b |
| Nit: canonicalise the id | Applied: `str(uuid.UUID(value))`, with an upper-case id test. | §1a, §13 |
| Nit: rebuild payload steps | Applied: `build_structured_steps(payload.steps, payload.instructions)`, where a mismatch gives `None`. | §1b, §13 |
| Nit: `allow_inf_nan=False` on quantities | Applied on `MealFixedMainIngredient.quantity`, also with `ge=0`. | §1b, §13 |
| Nit: read the row once | Applied. `resolve_fixed_main` returns a `ResolvedFixedMain` holding the card, and `get_recipe` is awaited once on a fresh turn. | §1b, §3a, §13 |
| Nit: `MealFixedMain` validator | Applied: `recipe_id` if and only if saved, `recipe` if and only if chat. An invalid retained state counts as absent. | §1b, §13 |
| Nit: the §6 double-tap wording | Applied. The guard is the synchronous re-render disabling the button, and `sendMessage`'s check is only a backstop. | §6 |
| Nit: the `handleSaveRecipe` draft-id window | Applied: it's listed as a known window (`page.tsx:386-390`), and the backend's draft-to-copy rule covers it. | §16 |
| Nit: `fixedMainPayload` read type | **Widened**: `ChatRecipeData.ingredients` gains `preparation` and `optional`. Dropping them would lose prep notes on the saved meal. | §1c, §15 |
| Nit: Try Another's exact classes | Applied: `text-[var(--color-muted)]`, with `w-full` in place of `flex-1`. | §7 |
| Nit: "Quicker sides" | Applied under a fixed main, with the message "Quicker sides, under 20 minutes", and logged as a product call. | §8a, §13, §14, §15 |
| Nit: label regression guards | Applied to the routing precedence and exact-type tests, and to the unchanged-prompt and rule-order checks. | §13 |
| Nit: scope "no model call" | Applied. It's scoped to the stage, and the `general_chat` refusal still gets the router's follow-up pass (`router.py:2055`). | §3a, §6, §13 |
| Nit: the cuisine-hint exception | Applied. It's noted as the fixed-main exception to the cuisine-weighting AC, and the PR body says so. | §3c, §13 |
| Nit: the `models/session.py` cite | **Checked and kept at 105.** `git show origin/main:ai-service/bubbly_chef/models/session.py` puts `meal_plan: MealPlanSessionState \| None = None` on line 105; line 104 is `last_recipe_title`. | §0 |
