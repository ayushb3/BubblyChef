# Issue #651, PR A: predictive pills and Plan dinner, the contract

The contract for **PR A** of issue #651, *Predictive pills and meal entry points*. It's shared by three roles working in parallel: backend (`ai-service/**`), ui-ux (`nextjs/src/components/**`) and frontend (`nextjs/src/app/**`, `nextjs/src/lib/**`, plus `nextjs/src/hooks/useChat.ts` and `nextjs/src/types/chat.ts`). The parent spec is issue #647 ("Prediction and pills"; "Chat and meal UI" for the entry points). The earlier meal contracts are `2026-09-29-issue-650-meal-contract.md` and `2026-09-29-issue-652-meal-screen-contract.md`. Where this doc is silent, the issue rules, then the spec. Wire fields are snake_case. File:line references are against main at `abf7629` (after PR #661).

The ticket ships as three PRs: **A: pills** (this doc), **B: make it a meal**, **C: the meal-again lookup**. PR A's body says `Related to #651`, never a closing keyword.

## 0. What already exists (don't rebuild)

- **Follow-up chips (issue #498, closed):**
  - `ai-service/bubbly_chef/workflows/chat/nodes.py:57` `suggest_follow_ups()` is a separate LLM pass. `workflows/router.py:2023` `_FOLLOW_UP_INTENTS` already excludes `meal_plan`, so meal replies never get that pass and ship `metadata.follow_ups_pending: false`. **This stays unchanged.**
  - `nextjs/src/lib/chat-chips.ts`: `sanitiseFollowUps` (66), `resolveStaticChips` (88), `resolveChips` (143), `MAX_FOLLOW_UP_CHIPS = 3` (37).
  - `components/chat/PostMessageChips.tsx:6-48` holds `ChipConfig` and renders the row, calling `onChipTap(message: string)`.
- **The chat empty state:** `SUGGESTIONS[]` and `SUGGESTION_TONES` (`app/chat/page.tsx:63-76`), rendered at `page.tsx:765-776`. The pinned-cooking row (`COOKING_SUGGESTIONS`) stays as it is.
- **Seeds:** `lib/chat-seed.ts`: `ChatSeedKind = 'tip' | 'use'` (43), `deriveChatSeed` (148). The one-shot auto-send effect is `page.tsx:274-280`.
- **The meal flow (issue #650):** `workflows/meal/nodes.py`: `meal_options_stage` (477), `_expand_dish` (598), `meal_pick_stage` (664). The chat renders the options branch at `page.tsx:1059-1085` (with chips) and the meal-ready branch at `page.tsx:1086-1108` (`CompactMealCard`, **no chips today**).
- **Light learning:** `_default_servings` (`nodes.py:120-141`) and `_recent_cuisine_hint` (`nodes.py:144-166`). The hint samples `repo.get_user_recipes(limit=5)`, which **includes drafts**.

## 1. Shared types and wire shapes (the seam)

### 1a. Pills (`components/chat/PostMessageChips.tsx`, ui-ux; the types land in the seam commit)

The types are extended in place, not forked. This block lands verbatim in the seam commit (§9). `lib/chat-chips.ts` re-exports both types with `export { type ChipConfig, type ChipAction }`. Frontend imports them from `@/lib/chat-chips` and **never redefines them locally**.

```ts
import type { ChipTone } from '@/components/ui/Chip'

/** Client-coded app actions. A closed union: model output can never name one.
 *  PR B/C extend it here, in one place. */
export type ChipAction = 'save_meal' | 'open_scan' | 'open_meal'

export interface ChipConfig {
  label: string
  /** Sent on a send-kind tap; put in the input by ✎. Unused for action-kind. */
  message: string
  suggestion?: string
  tone?: ChipTone
  emoji?: string
  /** Default 'send'. */
  kind?: 'send' | 'action'
  /** Required when kind === 'action'. Ignored otherwise. */
  action?: ChipAction
  /** Client-set request context, forwarded with a send-kind tap. Set only by
   *  the resolver (`{ meal_followup: true }`), never from model output. */
  context?: Record<string, unknown>
}

export interface PostMessageChipsProps {
  chips: ChipConfig[]
  /** Send-kind tap. Gets the whole chip, so `context` travels with it. */
  onChipTap: (chip: ChipConfig) => void
  /** ✎ tap on a send-kind chip. When absent, no ✎ renders. */
  onEditChip?: (message: string) => void
  /** Action-kind tap. When absent, action chips are not rendered. */
  onChipAction?: (action: ChipAction) => void
  /** 'bubble' (default) = today's `ml-11` mascot-gutter indent.
   *  'center' = centred, no indent (the empty chat). */
  align?: 'bubble' | 'center'
}
```

### 1b. Meal card save focus (`components/chat/CompactMealCard.tsx`, ui-ux)

It's additive to `CompactMealCardProps` (7-17). The seam commit adds it as an accepted but unused prop, and ui-ux implements it.

```ts
/** Bumped by the page when the "Save this meal" pill is tapped. On each change
 *  to a non-zero value: scroll the Save meal button into view, focus it, and
 *  highlight it (a ring) for ~2 s. A no-op while that button is disabled. */
focusSaveToken?: number
```

### 1c. Request context key (backend reads, frontend sends)

```jsonc
// ChatRequest.context on a tap of a stamped pill (see §2 for which pills are stamped)
{ "meal_followup": true }
```

- It's only honoured when the value is exactly `true`.
- It never co-occurs with `meal_option_id` from the client. If both arrive, `meal_option_id` wins, which means a pick.
- **The reply:** unchanged envelope shapes. Meal replies carry `metadata.follow_up_suggestions: string[]` (0–4 items) and `metadata.follow_ups_pending: false`.

### 1d. Frontend-only shapes (frontend owns them)

```ts
// types/chat.ts
export interface StarterExpiringItem { name: string; expiry_date: string /* YYYY-MM-DD */ }
export interface StarterRecentCook {
  recipe_id: string; title: string; last_cooked_at: string; cuisine: string | null
}
/** GET /api/chat/starter-context */
export interface StarterContext {
  expiring: StarterExpiringItem[]      // expiry_date in [server today −1, +7], soonest first, then name; ≤10
  pantry_count: number | null          // all pantry rows; null when the count query failed
  recent_cooks: StarterRecentCook[]    // ≤3 non-draft recipes with last_cooked_at, most recent first
  recent_cuisines: string[]            // 0–2, lower-cased; the §6 rule
  default_servings: number             // the §6 rule; 2 on failure
}

// lib/chat-chips.ts
export const MAX_FOLLOW_UP_CHIPS = 4     // was 3; MIN stays 2
export function resolveStaticChips(
  intent: string | undefined, proposalType?: string, opts?: { mealSaved?: boolean },
): ChipConfig[]
export function resolveChips(
  intent: string | undefined, suggestions?: unknown,
  proposalType?: string, opts?: { mealSaved?: boolean },
): ChipConfig[]

// lib/starter-pills.ts (new, pure)
export function rankStarterPills(ctx: StarterContext | null, now: Date): ChipConfig[]

// lib/api/starter-context.ts (new; same-origin CRUD client, kept out of the AI-service client lib/api/chat.ts)
export const STARTER_CONTEXT_KEY = ['pantry', 'starter-context'] as const
export async function fetchStarterContext(): Promise<StarterContext>
export function useStarterContext(enabled: boolean): UseQueryResult<StarterContext> // staleTime 5 min

// lib/chat-seed.ts
export type ChatSeedKind = 'tip' | 'use' | 'plan'     // PR B adds 'meal'
export interface ChatSeed { key: string; kind: ChatSeedKind; message: string; card: ChatSeedCard
  /** Forwarded as the auto-send's context. Unset for plan; PR B's meal seed uses it. */
  context?: Record<string, unknown> }
export const PLAN_DINNER_MESSAGE = 'Plan dinner for tonight'
export function planDinnerHref(): string   // '/chat?plan=dinner'

// hooks/useChat.ts, sendChipMessage (685-695) gains context
sendChipMessage: (text: string, context?: Record<string, unknown> | null) => void
```

`planDinnerHref` and `PLAN_DINNER_MESSAGE` land in the seam commit, and ui-ux imports `planDinnerHref` from `@/lib/chat-seed`.

**`fetchStarterContext`** throws on `!res.ok`, so the query errors and the ranker gets `null`. On success it normalises the body before returning it:
- any array field that isn't an array becomes `[]`;
- `pantry_count` must be a non-negative integer, else `null`;
- `default_servings` must be an integer from 1 to 20, else 2;
- malformed entries are dropped: an `expiring` entry without a string `name` and `expiry_date`, a `recent_cooks` entry without a string `recipe_id` and `title`, and a non-string or blank `recent_cuisines` entry.

### 1e. Backend shapes

```python
# models/meal.py: MealOptionsLLMResult (179-182) gains one field
class MealOptionsLLMResult(BaseModel):
    options: list[MealOptionLLM] = Field(default_factory=list)
    follow_ups: list[str] = Field(
        default_factory=list,
        description="2-4 short next asks in the user's voice, each under 60 characters, no emoji",
    )

# workflows/meal/nodes.py (NOT models/meal.py: shared_state.py imports models.meal,
# so models.meal importing LLMRecipeResult from workflows.shared_state is circular)
class MealDishLLMResult(LLMRecipeResult):
    """The pick stage's one pill-carrying dish call (issue #651). Internal only:
    never on RecipeCard, MealDish or the saved recipe."""
    follow_ups: list[str] = Field(default_factory=list, description="...same as above...")

MAX_MEAL_FOLLOW_UPS = 4   # the non-meal cap, chat/nodes.py:53 MAX_FOLLOW_UP_SUGGESTIONS = 3, is unchanged

def _clean_meal_follow_ups(raw: list[str], *, pantry_grounded: bool) -> list[str]: ...

async def _expand_dish_result(
    ai_manager: Any, dish: MealDishOutline, option: MealOption, servings: int,
    constraints_echo: MealConstraintsEcho, scored_items: list[dict[str, Any]],
    pantry_grounded: bool = True, *, with_follow_ups: bool = False,
) -> LLMRecipeResult: ...   # MealDishLLMResult when with_follow_ups and the model complied

async def _expand_dish(...) -> RecipeCard   # signature and behaviour unchanged; now
                                            # _recipe_card_from_llm_result(await _expand_dish_result(...))

# workflows/state.py, next to meal_plan_session_state (157)
meal_follow_ups: list[str]
```

`sides.py:352` keeps calling `_expand_dish` unchanged. `api/routes/meals_ai.py:132` calls `sides.expand_meal_dish`, which wraps it, so it's unaffected too.

## 2. The resolver (`lib/chat-chips.ts`, frontend)

**The fixed sets.** `meal_plan` (108-112) splits by `proposalType`, following the spec's sets. "Just one dish" is removed.

| `proposalType` | Fixed pills, in this order |
|---|---|
| `meal_options`, or absent | **Something quicker** (send, message "Something quicker, under 30 minutes") · **Make it vegetarian** (send, "Make it vegetarian") · **Different ideas** (send, "Show me different meal options") |
| `meal` | **Save this meal** (action `save_meal`, **omitted when `opts.mealSaved`**) · **Start cooking** (action `open_meal`) · **Different options** (send, "Show me different meal options") |

Every other intent's set is unchanged.

**`resolveChips` algorithm:**

1. `fixed = resolveStaticChips(intent, proposalType, opts)`. Split it into `actions` (kind `action`) and `sends`.
2. `model = sanitiseFollowUps(suggestions)`, mapped to send pills (the rotating tones and emoji as today). Drop any model pill whose label equals a fixed **action** label, case-insensitively: the action wins. Cap at `MAX_FOLLOW_UP_CHIPS − actions.length` — except at the **meal pick stage** (`proposalType === 'meal'`), which caps at `MAX_FOLLOW_UP_CHIPS − actions.length − sends.length` instead (see below).
3. If `model` is empty, return `fixed` as is (today's full fallback, so `cooking_help` still gets all 3 `COOKING_CHIPS`).
4. Otherwise, options stage and every other intent: `model`, then `sends` topped up, skipping label duplicates, until `model + added + actions ≥ MIN_FOLLOW_UP_CHIPS`. Then append `actions`.
5. Otherwise, meal pick stage: `model`, then `actions`, then `sends` in full — no `MIN_FOLLOW_UP_CHIPS` top-up gate. `sends` at this stage is only "Different options", and it always shows once there's at least one model pill (issue #666 code review: with the old top-up rule, a single model pill plus 2-3 actions already cleared `MIN_FOLLOW_UP_CHIPS`, so "Different options" — the only way back to other options once a meal is picked — never appeared).
6. Never empty. Never more than 4.

**The `meal_followup` stamp** (`context: { meal_followup: true }`), applied in both `resolveStaticChips` and `resolveChips`, so the two agree when there are no suggestions:
- Under `meal_plan` + `meal_options` (or absent): **every** send pill, model and fixed.
- Under `meal_plan` + `meal`: the **fixed** send pills only ("Different options"). Model pills there are cooking questions (§5b) and go through the classifier unstamped.
- Every other intent: nothing is stamped.
- A pill edited with ✎ loses its stamp. That's accepted.

**Rows that follow** (m = a model pill):

| Stage | Model pills | Row |
|---|---|---|
| options | 0 | Something quicker, Make it vegetarian, Different ideas |
| options | 1 | m1, Different ideas |
| options | 2 | m1, m2, Different ideas |
| options | 5 | m1–m3, Different ideas |
| meal, unsaved | 0 | Save this meal, Start cooking, Different options |
| meal, saved | 0 | Start cooking, Different options |
| meal, unsaved | 1 | m1, Save this meal, Start cooking, Different options |
| meal, saved | 2 | m1, m2, Start cooking, Different options |

## 3. Components (ui-ux)

- **`PostMessageChips`:**
  - **Send-kind:** the pill calls `onChipTap(chip)`. When `onEditChip` is set, a small **✎** button follows the pill:
    - It calls `onEditChip(chip.message)` and never sends.
    - Its `aria-label` is `Edit "<label>" before sending`, and the glyph is `aria-hidden`.
    - It has a hit area of at least 32×32 px.
  - **Action-kind:** calls `onChipAction(chip.action)`. It has no ✎. It isn't rendered when `onChipAction` is absent.
  - **Layout:** `align` as in §1a. The component doesn't cap or reorder chips; the resolver does.
  - **Styling:** functional styling on the existing `Chip`, with `whitespace-nowrap` on pill labels. The final look is Goal 3.
- **`CompactMealCard`:** `focusSaveToken` as in §1b. `SpringButton` doesn't forward a ref today, so pass `ref` through it (React 19 ref-as-prop, which adds `components/ui/SpringButton.tsx` to ui-ux's files) or wrap the button. Scrolling uses `behavior: 'auto'` under reduced motion.
- **`HeroHome` Plan dinner** (the grid at `components/dashboard/HeroHome.tsx:425-483`):
  - Add a 4th card **first** in the list:
    - `icon: ForkKnife` (from `@phosphor-icons/react/dist/ssr`);
    - `label: 'Plan'`, `detail: 'Dinner'`;
    - `href: planDinnerHref()`, `pending: false`;
    - its own gradient from existing tokens.
  - The Plan card's Link gets `aria-label="Plan dinner"`.
  - The grid becomes `grid-cols-2` (2×2). The hero bubble's `heroAction` link is untouched. Frontend mirrors the grid in the `app/loading.tsx` skeleton (§4).
  - Update the tour copy in `components/onboarding/steps.ts:27`: "Quick actions: plan dinner, see what to use soon, scan a receipt, or ask me anything."

## 4. Chat page wiring (`app/chat/page.tsx` + `hooks/useChat.ts`, frontend)

- **`sendChipMessage(text, context?)`:** forwards `context` to `sendMessage` (`useChat.ts:685-695`).
- **Chip taps:** keep the existing call shapes' arity, so the current `sendChipMessage` / `sendMessage` assertions in tests still hold:
  - `handleChipTap` (431) becomes `(chip) => chip.context ? sendChipMessage(chip.message, chip.context) : sendChipMessage(chip.message)`. The seam commit lands the one-argument shim, and this replaces it.
  - `onTryAnother` (725) becomes `() => sendChipMessage('Give me a different recipe')` (in the seam commit).
- **`MessageRendererProps`:**
  - `onChipTap: (chip: ChipConfig) => void` (890, in the seam commit).
  - New: `onChipAction: (action: ChipAction) => void` and `mealSaveFocusToken: number`.
  - ✎ uses the existing `onStageText` (`handleStageText`, 435).
  - Every `PostMessageChips` in the renderer (1078, 1041, 1234, and the new one) passes `onEditChip={onStageText}` and `onChipAction`.
- **The options branch** (1078-1081): `resolveChips(intent, suggestions, proposal.proposal_type)`.
- **The meal-ready branch** (1086-1108):
  - Add `PostMessageChips` under the card, on the same gate as the other branches (`isLastSettledAssistant && !isFollowUpsPending`).
  - The chips come from `resolveChips(intent, suggestions, 'meal', { mealSaved: mealSaveState === 'saving' || mealSaveState === 'saved' })`.
  - The card gets `focusSaveToken={mealSaveFocusToken}`.
- **Actions,** handled per message by the page:
  - `save_meal`: bumps `mealSaveFocus[msgId]`, where `const [mealSaveFocus, setMealSaveFocus] = useState<Record<string, number>>({})`. It's passed to the renderer as `mealSaveFocusToken={mealSaveFocus[msg.id] ?? 0}`. **Nothing is written.** The card's own Save meal button is the confirm, and it runs the existing `handleSaveMeal`.
  - `open_meal`: `handleOpenMeal(msgId, proposal)`, exactly the card's Open meal button (a draft, then `/meals/[id]`).
  - `open_scan`: `router.push('/pantry?add=scan')`.
- **The empty state** (765-776):
  - While `cookingRecipe` is set: unchanged.
  - While `activeSeed` is set: no pill row.
  - Otherwise: `<PostMessageChips chips={rankStarterPills(starter.data ?? null, mountedAt)} align="center" onChipTap={(c) => handleSuggestionClick(c.message)} onEditChip={handleStageText} onChipAction={…open_scan only…} />`.
  - `mountedAt` comes from `useState(() => new Date())`: one clock read per empty state. `handleNewChat` resets it to `new Date()`.
  - `starter = useStarterContext(!hasMessages && !isResuming && !cookingRecipeId && !seed)`.
  - The `open_scan` handler is `router.push('/pantry?add=scan')`.
  - Delete `SUGGESTIONS` and `SUGGESTION_TONES`.
- **The seed effect** (279): the same arity rule, `seed.context ? sendMessage(seed.message, seed.context) : sendMessage(seed.message)`.
- **`app/loading.tsx`:** the skeleton's action row (60) becomes `grid-cols-2` with 4 cells, matching HeroHome's new grid.

## 5. Predicted pills in both meal stages (ai-service, backend)

### 5a. The option stage (`meal_options_stage`, 477)

- **The prompt:**
  - Append `MEAL_OPTIONS_FOLLOW_UPS_RULES` after the constraint and cuisine blocks (499-512).
  - When not pantry-grounded, also append `MEAL_FOLLOW_UPS_NO_PANTRY_RULE`.
  - The schema's `follow_ups` rides the **same** `ai_manager.complete` call.
- **The pills:** `meal_follow_ups = _clean_meal_follow_ups(result.follow_ups, pantry_grounded=…)`, set on every successful return (572-583).

### 5b. The pick stage (`meal_pick_stage`, 664)

- **The calls:** the `asyncio.gather` (705-719) calls `_expand_dish_result` for every dish, with `with_follow_ups=True` on **exactly one** dish: the main (position 0). PR B moves it to side 1 when the main is fixed.
  - `with_follow_ups=True` uses `response_schema=MealDishLLMResult` and appends `MEAL_READY_FOLLOW_UPS_RULES`, plus the no-pantry rule when the pick isn't grounded.
  - The dish count and call count are unchanged.
- **The cards and pills:** cards come from `_recipe_card_from_llm_result`. `meal_follow_ups` comes from that dish's `follow_ups`, cleaned. It's `[]` when the result isn't a `MealDishLLMResult`, so old stubs and a non-complying provider degrade to no pills and still build the meal.
- **The reply names the dishes:** `assistant_message = f"Here's your {option.title}: {main} with {' and '.join(sides)}!"`, where `main` and `sides` are the expanded recipe titles. It replaces "Here's your {option.title}!" (745). This gives the meal-ready pills something concrete in the conversation history to answer against. The PR body notes that interference from a recipe pinned earlier in the session is accepted.

### 5c. The prompts (`prompts/meal.py`, constants only; update the module docstring for #651)

| Constant | Must say |
|---|---|
| `MEAL_OPTIONS_FOLLOW_UPS_RULES` | Return `follow_ups`: 2–4 short asks in the user's voice that change or re-ask **these options**, e.g. "Something with less prep", "Make the pasta one vegetarian", "Can the sides be lighter?". Under 60 characters, no emoji, no numbering. |
| `MEAL_READY_FOLLOW_UPS_RULES` | Return `follow_ups`: 2–4 short **cooking questions about this whole meal**, e.g. "Can I prep any of this ahead?", "What should I start first?". Never ask to change a single dish (the meal screen owns swaps) and never re-ask for options (a fixed pill does that). Same length and emoji rules. |
| both | Never an app action (save, open, start cooking, grocery or shopping list, scan). Never about past cooking, saved recipes or the user's preferences. |
| `MEAL_FOLLOW_UPS_NO_PANTRY_RULE` | Never mention the pantry, stock, the fridge or expiring items. |
| `MEAL_OPTIONS_PREVIOUS_BLOCK` | `"\nAlready suggested in this conversation: {options}. If the user's request refers to one of these, build on it; otherwise suggest different meals."`. `{options}` is `"; ".join(f"{o.title} ({', '.join(d.name for d in o.dishes)})" for o in retained.options)`. It's inserted after `cuisine_hint` and before `\n\nUser:` (used in §5e). |

### 5d. The server filter `_clean_meal_follow_ups`

- **Kept:** strings only, whitespace collapsed and stripped, 1–60 characters.
- **Dropped:**
  - anything matching `\b(save|saved|saving|start cooking|grocery|groceries|shopping list|open|scan)\b`, case-insensitive;
  - when `pantry_grounded` is false, anything matching `\b(pantry|fridge|in stock|on hand|expir\w*)\b`, case-insensitive. A bare "stock" is kept, so "Can I use chicken stock instead?" survives.
- **Then:** deduped case-insensitively, keeping the first; capped at `MAX_MEAL_FOLLOW_UPS`.
- Fewer than 2 survivors ship as they are, and the client tops up.

### 5e. Envelope plumbing and the `meal_followup` route

- **Both envelope builders** set `env.metadata["follow_up_suggestions"] = final_state.get("meal_follow_ups") or []` on the `MealOptionsProposal` and `MealProposal` branches:
  - `run_chat_workflow` at `router.py:1787-1810`;
  - `_build_envelope_from_state` at `router.py:1952-1977`.
  - The degraded `general_chat` fallbacks don't set it.
- **`classify_intent`:** a new block goes right after the `meal_option_id` shortcut (`router.py:332-339`):
  - `if context.get("meal_followup") is True:` it returns `meal_plan` at confidence 1.0, with `intent_reasoning` "Meal follow-up pill — context.meal_followup present".
  - There's no LLM call, and it comes ahead of the mode-aware routing and the picked-recipe bias.
  - Add it to the docstring's priority list as 2b.
  - `route_by_intent` (775-781) is unchanged: with no `meal_option_id`, the turn goes to the option stage.
- **Inheritance in `meal_options_stage`:** when `context.meal_followup is True` and `session.metadata.meal_plan` validates as `MealPlanSessionState`:
  - The prior constraints merged into the fresh extraction are the retained `constraints.recipe_constraints`, not `session.metadata.recipe_constraints`. The meal branch of `update_session_node` (1310-1320) never persists those, so the stage calls `extract_recipe_constraints` on a state copy whose `session.metadata.recipe_constraints` is the retained dict.
  - **List unions on stamped turns** (the plain `_merge_constraints` list rule is "fresh wins when non-empty", which would drop a retained diet):
    - `dietary` = the retained list plus new entries, deduped case-insensitively and kept in order, then passed through `_drop_redundant_dietary` (`recipe/nodes.py:772`).
    - `excluded_ingredients` is unioned the same way, without the redundancy pass.
    - A retained `['gluten-free']` plus "Make it vegetarian" gives both.
  - `servings` = the merged `servings` if set, else the retained `servings` (not `_default_servings`).
  - The prompt gets `MEAL_OPTIONS_PREVIOUS_BLOCK` with the retained option titles.
  - **PR B seam:** `fixed_main` is inherited here too.
- **`ChatRequest.context` docs** (`models/requests.py:95-103`): list `cooking_recipe_id`, `cooking_recipe`, `meal_option_id` and `meal_followup`. Mirror the list in the `ChatRequest.context` JSDoc at `types/chat.ts:215-222` (frontend).

## 6. Shared learning rules (both halves implement the same rule, with the same fixtures)

**Recent cuisines:**
- Take the user's **5** most recent **non-draft** recipes (`is_draft = false`, as `GET /api/recipes` filters), ordered by `coalesce(last_cooked_at, created_at)` desc.
- Drop blank or null cuisines, then trim and lower-case the rest.
- Keep the top 2 by count, with ties broken toward the most recent. That's `Counter.most_common` over the newest-first list.
- PostgREST can't order by `coalesce`, so run two limited queries (top 5 by `last_cooked_at` desc, non-null only, and top 5 by `created_at` desc), merge them in code, and take the top 5 by the coalesced key. That's exact because a recipe's `last_cooked_at ≥ created_at`.
- **Backend:** `repo.get_recent_cuisines(user_id: str, sample: int = 5) -> list[str]`. It returns `[]` on any error and never raises. `_recent_cuisine_hint` uses it in place of `get_user_recipes`, with the same prompt line. It **keeps its own try/except** and treats a non-list result as `[]`, because the #650 tests' repo mock is a bare `MagicMock`.
- **Frontend:** the starter-context route implements the same rule.

**Default servings:** exactly `_default_servings`:
- cooked meals only, ordered `last_cooked_at desc nulls last`, limit 3;
- rows with a null `servings` or `last_cooked_at` dropped;
- the mode, with ties broken toward the most recent;
- otherwise 2.

`get_recent_meal_servings` has no draft filter, and the route matches it.

**The shared fixture** (both suites):
- Recipes as (cuisine, created, cooked):
  - A: thai, 09-01, 09-28;
  - B: Italian, 09-27, –;
  - C: italian, 09-20, 09-26;
  - D: thai, 09-25, –;
  - E: mexican, 09-24, –;
  - F: korean, 09-29, a **draft**;
  - G: french, 08-01, –.
- That gives `['thai', 'italian']`: F is excluded as a draft, G is outside the sample, and the thai/italian tie goes to thai via A.
- Meals as (servings, cooked):
  - (4, 09-28), (2, 09-27), (4, 09-20) and (2, never) give **4**;
  - (2, 09-28) and (4, 09-27) give **2** (a tie, broken toward the most recent);
  - no cooked meals gives **2**.

## 7. Starter pills (frontend)

### 7a. `GET /api/chat/starter-context` (`app/api/chat/starter-context/route.ts`)

- It calls `requireAuth()`, then runs **six queries** in `Promise.all`, each scoped `.eq('user_id', user.id)`:
  1. expiring;
  2. the pantry count;
  3. recent cooks;
  4. the cooked-cuisine query (§6);
  5. the created-cuisine query (§6);
  6. the meal servings (§6).

  Recent cooks may instead reuse the first 3 rows of the cooked-cuisine query, if that query selects `id, title` too.
- **Expiring:** `name, expiry_date` where `expiry_date` is between the server's local date −1 and +7 and `.gt('quantity', 0)`, ordered by `expiry_date`, then `name`, limit 10.
- **`pantry_count`:** `select('id', { count: 'exact', head: true })` with `.gt('quantity', 0)`, so rows deducted to 0 don't count (PR #666 review).
- **Recent cooks:** `id, title, cuisine, last_cooked_at` where `is_draft = false` and `last_cooked_at` is not null, ordered by `last_cooked_at` desc, limit 3.
- **Failures degrade field by field** and are logged with `console.warn`: `[]`, `pantry_count: null`, `default_servings: 2`. The response is still 200. Only auth is non-200.

### 7b. `rankStarterPills(ctx, now)` (`lib/starter-pills.ts`)

It's pure: it never reads the clock. It returns **exactly 3** pills, deduped by label case-insensitively. All are send-kind except the scan pill.

- **Slot 1 is always the time-of-day pill,** before and after load (hours are `now`'s local time):

  | Hours | Label = message | Emoji, tone |
  |---|---|---|
  | 05:00–10:59 | "Something quick for breakfast" | 🍳, primary |
  | 11:00–15:59 | "Something quick for lunch" | 🥪, primary |
  | 16:00–21:59 | "Plan dinner for {n}", where n = `ctx?.default_servings ?? 2` | 🍽️, primary |
  | 22:00–04:59 | "A late-night snack idea" | 🌙, primary |

- **Slots 2–3** are the first two survivors of this ordered list:
  1. **Scan** (`ctx.pantry_count === 0`; `null` doesn't qualify): label "Scan a receipt", `kind: 'action'`, `action: 'open_scan'`, 📷, fresh. The page handles it with `router.push('/pantry?add=scan')`.
  2. **Expiring:**
     - Take the soonest item with `days` in 0–3, where `days = Math.round((parseLocalDate(expiry_date) − localMidnight(now)) / 86_400_000)`. On ties, the first in route order wins.
     - The label is "Use up the {name} today" (days 0), "Use up the {name} by tomorrow" (1), or "Use up the {name} before {Weekday}" (2–3, `en-US` long weekday). `{name}` is truncated to 28 characters plus "…" in the label only.
     - The message is `ingredientSeedMessage(name)`, with the full name. Emoji ⏳, tone expiring.
  3. **Make again:**
     - Take the first `recent_cooks` entry whose `cuisine?.trim().toLowerCase()` is in `recent_cuisines`, else the first entry.
     - The label is "Make the {title} again". Strip a leading "The " from the title, case-insensitively, and truncate it at 28 characters plus "…" in the label only.
     - The message is "Show me my saved {title}", with the full title. Emoji 🔁, tone accent.
  4. **Cuisine:** "Something {Cuisine} tonight?", or "…today?" before 11:00, using `recent_cuisines[0]` with its first letter capitalised. Emoji ✨, tone accent. The copy never says "you like", "because" or "your taste".
  5. **Fillers:**
     - before 11:00: "What can I make today?" and "Something quick and easy";
     - otherwise: "What can I make tonight?" and "Quick weeknight dinner".
     - Emoji 💡 then ⚡, tone muted.
- **No "tonight" or "weeknight" before 11:00.** With `ctx === null`, the result is the time pill plus the two fillers.

## 8. The `plan` seed (`lib/chat-seed.ts`, frontend)

- **`deriveChatSeed`:**
  - It checks `plan` **before** `tip`.
  - The precedence is cooking > (meal, PR B) > plan > tip > use. The cooking handoff is already excluded at `page.tsx:105-108`.
  - Only `plan=dinner` qualifies, case-insensitively after trimming. Any other value falls through.
- **The seed:**
  ```ts
  { key: 'plan:dinner', kind: 'plan', message: PLAN_DINNER_MESSAGE,
    card: { emoji: '🍽️', label: 'Plan dinner', title: 'Planning dinner',
            subtitle: 'Bubbles will suggest a few meals', dismissLabel: 'Dismiss dinner planning context' } }
  ```
  There's no `context`, and the default servings apply server-side.
- **The header comment** (1-20): the seed rides in the message text **unless** `ChatSeed.context` is set. List the AI service's recognised context keys (§5e).

## 9. Ownership and landing order

| Role | Files |
|---|---|
| **backend** | `models/meal.py`, `workflows/meal/nodes.py`, `prompts/meal.py`, `workflows/router.py`, `workflows/state.py`, `models/requests.py`, `repository/supabase_repo.py` (`get_recent_cuisines`), `tests/test_issue_651_*.py`, `tests/capture_intent_fixtures.py` + `tests/fixtures/intent_classifications.json` |
| **ui-ux** | `components/chat/PostMessageChips.tsx`, `components/chat/CompactMealCard.tsx`, `components/ui/SpringButton.tsx` (only if the ref is forwarded through it), `components/dashboard/HeroHome.tsx`, `components/onboarding/steps.ts`, their component tests |
| **frontend** | `lib/chat-chips.ts`, `lib/starter-pills.ts`, `lib/chat-seed.ts`, `lib/api/starter-context.ts`, `types/chat.ts`, `hooks/useChat.ts`, `app/api/chat/starter-context/route.ts`, `app/chat/page.tsx`, `app/loading.tsx`, `CONTEXT.md` (the **Pill** term: starter, predicted, fallback; send and action kinds), their tests |

**Order:**
1. **A seam commit lands first,** made by a single agent before any parallel work. It contains:
   - §1a verbatim in `PostMessageChips.tsx`, with rendering unchanged apart from the new signature;
   - §1b as an accepted but unused optional prop on `CompactMealCard`;
   - `export { type ChipConfig, type ChipAction }` in `lib/chat-chips.ts`;
   - `planDinnerHref` and `PLAN_DINNER_MESSAGE` in `lib/chat-seed.ts`;
   - a `page.tsx` shim: `handleChipTap = (chip: ChipConfig) => sendChipMessage(chip.message)`, `MessageRendererProps.onChipTap: (chip: ChipConfig) => void`, and `onTryAnother={() => sendChipMessage('Give me a different recipe')}`.

   `npx tsc --noEmit` and jest must be green on that commit.
2. The three roles then run in parallel, each on its own files.

Backend has no compile-time seam with Next.js: the wire keys in §1c already exist or are additive. **Backend re-captures the classifier fixtures** (§11), using the Gemini key in the local `ai-service/.env`.

## 10. The ACs of issue #651 that PR A satisfies

- [x] **The starter-pill ranker:** a pure function with table tests (evening dinner with servings, expiring item and day, empty pantry scan, make again, always exactly 3 and deduped). It renders with no network wait, falling back to time-of-day pills.
- [x] **Predicted pills:** the option-stage and meal-stage structured outputs carry 2–4 pills into `follow_up_suggestions`, and the resolver has meal-stage fallbacks, a cap of 4, and a row that's never empty.
- [x] **Pill kinds:** ✎ fills the input without sending, an action pill that writes opens the confirm card, and model output can't produce an action pill.
- [x] **Plan dinner:** the home screen action seeds and auto-sends, with the seed context card.
- [x] **Recent-cuisine weighting** reaches the starter ranker and the option prompt, and is never shown as a profile.
- [~] **Tests:** ranker; resolver (fallbacks, cap, kinds); workflow pills; the `plan` seed; ✎ and action confirm. Make-it-a-meal is PR B, and the meal lookup is PR C.
- [~] **The `verify` run** (screenshots in the PR body):
  - the empty chat with context-driven starter pills;
  - pills after meal options and after a picked meal;
  - ✎ editing a pill;
  - Save this meal focusing the card's button (with no row written);
  - the home screen's Plan dinner.

  Make-it-a-meal is PR B, and "make that pasta dinner again" is PR C.

## 11. Tests

### Backend (`tests/test_issue_651_meal_pills.py`, `tests/test_issue_651_recent_cuisines.py`)

Stub at the `AIManager` boundary, dispatching on the `response_schema` kwarg rather than call order, and at the repository boundary.

- **Option stage:**
  - The model's `follow_ups` are `["Something with less prep", "Make the pasta one vegetarian", "Save these options"]`. The envelope's `metadata.follow_up_suggestions` holds the first two, and `follow_ups_pending` is false.
  - The meal AI's `complete` is awaited exactly once. `suggest_follow_ups` is never called (a spy), and no call uses `response_schema=FollowUpSuggestions`.
- **Pick stage:**
  - `complete` is awaited exactly `len(dishes)` times.
  - Exactly one call uses `MealDishLLMResult`, and its prompt names the main dish.
  - `follow_up_suggestions` equals the main's cleaned pills.
  - The proposal's JSON has no `follow_ups` key on any dish recipe.
- **Compatibility:** a main stub returning plain `LLMRecipeResult` gives `follow_up_suggestions == []` and the meal still builds. The existing #650 and #652 suites pass **unchanged**.
- **The filter:**
  - 6 pills are capped at 4;
  - case-insensitive dupes are dropped;
  - a 61-character pill is dropped;
  - "Start cooking now" is dropped, and so is "Add it to my grocery list";
  - one survivor ships as `[x]`, and none ships as `[]` with the key present.
- **The pantry opt-out fixture:** with `use_pantry: false`, both stage prompts contain `MEAL_FOLLOW_UPS_NO_PANTRY_RULE`, and "Use up the spinach in your fridge" is dropped, while "Can I use chicken stock instead?" survives. With grounding on, both survive.
- **`meal_followup` routing:**
  - `{meal_followup: True}` makes `classify_intent` return `meal_plan` with the classifier stubbed to raise. That holds with `session_mode` COOKING and with a `picked_recipe` in session.
  - The graph routes it to `meal_options_stage`, not the pick.
  - `{meal_followup: "true"}` (a string) is not honoured.
  - `meal_option_id` together with `meal_followup` routes to the pick.
- **Inheritance:** these tests use the **real** `extract_recipe_constraints`, not the #650 fake:
  - Stub its model call by patching `bubbly_chef.workflows.recipe.nodes.get_ai_manager`, dispatching on `response_schema=RecipeConstraints`.
  - Stub `bubbly_chef.workflows.recipe.nodes.get_stored_dietary_preferences` to return `[]`.
  - **Case 1:** the retained `meal_plan` has servings 4, `dietary: ['vegetarian']` and `kitchen_limits: ['one pan']`. The fresh extraction of "Something quicker, under 30 minutes" gives `max_time_minutes: 30`. The option prompt contains Dietary vegetarian, Kitchen limits one pan, Max time 30, and `MEAL_OPTIONS_PREVIOUS_BLOCK` with the three retained options (titles and dish names), placed after the cuisine hint and before `User:`. `proposal.servings == 4`.
  - **Case 2:** a retained `dietary: ['gluten-free']` plus a fresh "Make it vegetarian" (extraction `dietary: ['vegetarian']`) gives a prompt naming both. The same union applies to `excluded_ingredients`.
  - Without the stamp, the retained constraints aren't used.
- **The pick-stage reply:** `assistant_message == "Here's your {title}: {main} with {side1} and {side2}!"`, built from the expanded recipe titles, including a one-side case.
- **Recent cuisines:** the §6 fixture gives `['thai', 'italian']`. A repo error gives `[]`. The `_recent_cuisine_hint` line names only non-draft cuisines, so it never says korean.
- **Classifier fixtures:**
  - **Backend** adds these to `CASES` and re-captures them with the Gemini key in the local `ai-service/.env`:
    - "Plan dinner for tonight" → `meal_plan`
    - "Plan dinner for 2" → `meal_plan`
    - "make a pasta dinner" → `recipe_generation`
    - "make the lemon pasta again" → `saved_recipe_lookup`
    - "Show me my saved lemon pasta" → `saved_recipe_lookup`

    "what's for dinner?" is already covered.
  - Commit only the added entries. If a re-capture flips an existing entry, keep the old one and report it.
  - The two phrasings pills actually send ("Plan dinner for …" and "Show me my saved …") must pass. A miss on the other three is reported to the PM, not fixed with a classifier-prompt edit in PR A.

### Frontend

- **`__tests__/chat-chip-resolver.test.ts`** (extend):
  - every row in the §2 table;
  - the stamp matrix (options: all sends stamped; meal: only "Different options"; other intents: none);
  - `MAX_FOLLOW_UP_CHIPS === 4`;
  - a model "Save this meal" label is dropped in favour of the action;
  - `[{kind:'action', action:'save_meal'}, 'Ok?']` gives only send pills with no `action` field;
  - never empty over every intent × {`meal_options`, `meal`, undefined} × {saved, unsaved} × {none, junk, 1, 6 suggestions};
  - `cooking_help` with no suggestions still gives all 3 `COOKING_CHIPS`;
  - `resolveStaticChips` equals `resolveChips` with no suggestions for every case.
- **`__tests__/starter-pills.test.ts`** (new, a table; `now` is local time, and `jest.useFakeTimers().setSystemTime(...)` is set to a different date to prove purity):
  - **null context:**
    - 18:30 → `["Plan dinner for 2", "What can I make tonight?", "Quick weeknight dinner"]`
    - 08:00 → `["Something quick for breakfast", "What can I make today?", "Something quick and easy"]`
    - 12:30 → lunch plus the tonight fillers
    - 23:00 → late-night plus the tonight fillers
    - 00:00 → late-night plus the today fillers
  - **evening, `default_servings: 4`** → "Plan dinner for 4".
  - **expiring,** `now` Thu 2026-10-01 18:30:
    - spinach 10-03 → "Use up the spinach before Saturday", message "What can I make with my spinach before they go bad?"
    - 10-01 → "…today"
    - 10-02 → "…by tomorrow"
    - 10-05 → no expiring pill
    - 09-30 → no pill
    - two on 10-02 → the first in order
  - **the scan pill:** `pantry_count: 0` → slot 2 is `{kind:'action', action:'open_scan'}`; `null` → no scan pill.
  - **make again:**
    - "Make the Lemon pasta again" with message "Show me my saved Lemon pasta";
    - it prefers the cuisine match;
    - a 40-character title is truncated in the label only.
  - **cuisine:**
    - `['thai']` alone → "Something Thai tonight?" at 18:30 and "Something Thai today?" at 09:00;
    - no label matches `/you like|because|taste/i`.
  - **priority:** expiring + cook + cuisine → `[time, expiring, make again]`; scan + cook → `[time, scan, make again]`.
  - **property:** every hour 0–23 × each context variant gives length 3 with unique labels, and no `tonight` or `weeknight` before 11.
- **`__tests__/starter-context-route.test.ts`** (new):
  - 401 without a session;
  - the response shape;
  - the expiring window and order;
  - drafts excluded from cooks and cuisines;
  - the §6 fixtures;
  - a failed count gives `pantry_count: null` with 200;
  - zero-quantity rows are excluded from `expiring`.
- **`fetchStarterContext`** (in the same file):
  - it throws on a non-ok response;
  - `pantry_count: -1`, `1.5` or `"3"` becomes `null`;
  - `default_servings: 0`, `21` or `"4"` becomes 2;
  - `expiring: {}` becomes `[]`;
  - an entry missing `name` is dropped.
- **`__tests__/chat-seed.test.ts`** (extend):
  - `?plan=dinner` gives the §8 seed with `context` undefined;
  - `?plan=DINNER` gives the same;
  - `?plan=lunch` → null;
  - `?plan=dinner&tip=x` → plan;
  - `planDinnerHref() === '/chat?plan=dinner'`.
- **`__tests__/chat-deep-links.test.tsx`** (extend): `/chat?plan=dinner` auto-sends "Plan dinner for tonight" exactly once under a StrictMode double mount, with no context. The context card shows, and there's no starter row.
- **`__tests__/chat-pills-page.test.tsx`** (new, page level; mock `fetchStarterContext`, and every existing page test that renders the empty chat mocks it too):
  - The starter pills render while the query is still pending (time pill plus fillers), then update from the context.
  - The cooking row is unchanged while `?cooking=` is set.
  - A meal-ready message shows the pills. Tapping "Save this meal" sends no `POST /api/meals` and focuses the Save meal button.
  - Tapping a stamped option-stage pill sends a request whose `context.meal_followup === true`.
  - ✎ fills the input and sends nothing.
  - The starter "Scan a receipt" pill pushes `/pantry?add=scan`.

### ui-ux

- **`__tests__/post-message-chips.test.tsx`** (new):
  - ✎ appears only on send-kind chips and only when `onEditChip` is set.
  - A ✎ click calls `onEditChip(message)` and not `onChipTap`, and it has the `Edit "<label>" before sending` label.
  - A pill click calls `onChipTap` with the chip, including its `context`.
  - An action click calls `onChipAction(action)` and never `onChipTap`. An action chip has no ✎ and isn't rendered without `onChipAction`.
  - `align="center"` drops the gutter indent.
- **`__tests__/compact-meal-card.test.tsx`** (extend):
  - bumping `focusSaveToken` focuses the Save meal button, calls `scrollIntoView` and shows the highlight;
  - the same token re-rendered does nothing;
  - with `saveState: 'saved'`, nothing is focused.
- **HeroHome** (extend `deep-link-entrypoints.test.tsx`): a link with `aria-label="Plan dinner"` to `/chat?plan=dinner`, with the other three cards still present.

## 12. Reversible product calls (for the sprint doc)

| Call | Rejected alternative |
|---|---|
| Different ideas always keeps a slot under meal options (model pills cap at 3), like Different options under a picked meal (PR #666 review). | Only topping up to 2 pills, which hid every fixed pill whenever the model wrote two. |
| Serve at 7:00 is dropped from the meal-ready fixed set; the meal screen owns serve-at. | A send pill the chat can't act on. |
| `save_meal` scrolls to, focuses and highlights the same message's Save meal button. The card is the confirm. | A second confirm sheet for one action, or writing on the tap. |
| `open_meal` (Start cooking) is exactly the card's Open meal: a draft, then `/meals/[id]`, with no confirm because it writes only the draft the button already writes. | Start cooking deep-linking to `/meals/[id]/cook`, which skips the meal screen's `ensureSteps` gate and needs a session start. |
| "Just one dish" leaves the `meal_plan` fallbacks, per the spec's set. | Keeping it: stamped, it would be forced back into `meal_plan`. |
| Under meal-ready, only the fixed send pill is stamped, and the model pills are cooking questions routed by the classifier. | Stamping every send pill, which sends "Can I prep this ahead?" into a new option set. |
| Swap a side dropped from the pick-stage pills; Start cooking opens the same meal screen. | Rejected: keeping both and losing the options re-ask. |
| Action pills keep their slots (S1), so an unsaved meal-ready row shows one model pill. | Dropping a fixed action to fit two model pills. |
| `meal_followup` turns inherit the retained meal's constraints and servings, and the prompt lists the previous titles. | A fresh extraction only, where a tap on "Make it vegetarian" loses "for 4, one pan", and "Different ideas" can return the same three. |
| The scan pill appears only at `pantry_count === 0`, and `null` (unknown) never triggers it. | "Nearly empty" (≤ 2 items), or treating a failed count as 0. |
| Expiring copy reads "today" / "by tomorrow" / "before {Weekday}". | The literal "before today" / "before tomorrow". |
| Make again uses cooked recipes only. The title is truncated to 28 characters plus "…" in the label only. | Including saved but never-cooked recipes, which reads wrong as "again". |
| Before 11:00, the fillers and the cuisine pill say "today". | One filler set for every hour. |
| `now` is read once per empty state. Pills swap once when context first loads (the spec's cache fallback), and later visits hit the 5-minute cache. | Re-reading the clock on every render, or waiting for context before showing any pill. |
| Starter pills get ✎ too. | ✎ only under replies. |
| The starter-context key sits under `['pantry']`, so it rides the existing pantry invalidations. Recipe staleness is bounded by the 5 min `staleTime`. | New invalidations on every recipe write. |
| `?plan=` accepts only `dinner`. | A generic `plan=<meal>` nobody asked for. |
| Home Plan dinner is a 4th card, placed first, in a 2×2 grid. | `grid-cols-4` (labels wrap at 375 px), or replacing Ask. |
| The starter-context client goes in a new `lib/api/starter-context.ts`. | Adding a same-origin call to the AI-service client `lib/api/chat.ts`. |

## 13. Not in PR A

- **Make it a meal (PR B):**
  - `context.meal_fixed_main` and `fixed_main` in `MealPlanSessionState`;
  - `recipe_id` on `MealProposalDish`;
  - the `onMakeMeal` buttons, the recipe page button and the `meal` seed;
  - B4's "Different options keeps the fixed main";
  - moving `with_follow_ups` to side 1.

  Seams left for it: the `classify_intent` block (§5e), the inheritance branch (§5e), the `deriveChatSeed` precedence slot and `ChatSeed.context` (§8), and the `ChipAction` union (§1a).
- **The meal-again lookup (PR C):** `search_saved_meals`, `saved_meal_matches` and `SavedMealMatchCard`.
- **Other flows:** pills after a side swap on the meal screen; pills for scan, pantry or the kitchen.
- **Actions with no home yet:** serve-at in chat, and an "Add missing to grocery list" action (there's no grocery list).
- **Out of scope:** the final pill and ✎ visual design (Goal 3); any change to `suggest_follow_ups`, to the non-meal backend cap of 3, or to non-meal fixed sets.
- **Known gaps:**
  - The saved lookup returning drafts is a pre-existing bug, filed separately.
  - `mealSaved` isn't persisted: after a reload the Save pill shows again, matching the card's own button, which is idempotent on `meal_ref`.
  - ✎-edited pills keep no stamp.

## 14. Where this revises review 1's amendments

Review 2's 18 amendments are applied in place, and it asked for no third pass.

- **B1:**
  - `MealDishLLMResult` lives in `workflows/meal/nodes.py`. Putting it in `models/meal.py` would be circular, because `shared_state.py:23` imports `models.meal`.
  - `_expand_dish` keeps its return type, because `sides.py:352` needs a `RecipeCard`. The new `_expand_dish_result(..., with_follow_ups=)` carries the schema.
- **B4:**
  - The stamp is scoped by stage (§2).
  - The option stage also inherits the retained constraints, servings and titles. The review asked only for `fixed_main`, which is PR B; without the rest, the pills misfire.
- **S1 + S2:** a model pill that duplicates an action's label is dropped. With no model pills, the row is the full fixed set (today's rule), not a top-up to 2.
- **S3:** `resolveChips` takes a 4th `opts.mealSaved` argument, so that `save_meal` shows only while the meal is unsaved.
- **S8:** the day-label grammar is changed (§12). `pantry_count` is nullable, so a failed count never fakes an empty pantry.
