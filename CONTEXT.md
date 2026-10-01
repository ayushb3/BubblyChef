# BubblyChef — Domain Context

This is the domain glossary for BubblyChef. Refer to this when building features, writing PRDs, or discussing architecture.

---

## Core Entities

### Recipe
A structured instruction for preparing food. Has ingredients, steps, cuisine, dietary tags, and metadata.

- **Fields**: name, description, ingredients (list), steps (list), cuisine, prep_time, cook_time, servings, dietary_tags, source_url, source_type, source_title, thumbnail_url, user_id
- **source_type values**: `chat` (AI-generated in session) | `url` (recipe website import) | `video` (TikTok/YouTube/Reels) | `manual` (user-typed). `scan` is not valid — scanning produces PantryItems, never Recipes.
- **States**: draft, saved, favorited
- **Constraints**: Can be grounded in pantry (uses available ingredients + expiring items)
- **Related**: RecipeConstraints (user preferences), ProposalEnvelope (AI-generated with confidence)

### Structured step
A recipe step with text, a short label, an ongoing label, a duration, hands-on/off and dependencies — replaces regex-guessed cook-mode timers with real ones (issue #648).

- **Fields**: `text` (identical to the matching `instructions` entry), `label` (2-5 word imperative, e.g. "Boil the pasta"), `ongoing_label` (subject+verb clause for a step in progress, e.g. "the pasta boils" — required when hands-off, optional when hands-on), `duration_minutes` (1-240), `duration_estimated` (bool — true when code, not the model, supplied the duration), `hands_on` (bool), `depends_on` (indices of earlier steps in the same recipe that must finish first), `exclusive` (kitchen-limit tags, usually empty)
- **Storage**: `recipes.steps`, a nullable JSONB column alongside the unchanged `instructions` column. `steps = null` means "not yet structured". RLS is unchanged.
- **Validation** (Pydantic validators on `StructuredStep`, `bubbly_chef/models/recipe.py`): a missing duration is estimated from a duration phrase in the text, or else 3 minutes, and flagged `duration_estimated`; a null `depends_on` means "the previous step" and an explicit `[]` means "no dependencies"; an index that isn't strictly earlier than the step is dropped (makes a dependency cycle impossible by construction); a missing `hands_on` becomes `true`; labels are trimmed and capped; a step count that doesn't match the instruction count rejects the whole set (`steps` stays `null`, generation still succeeds).
- **Generation**: every recipe-generation path (the grounded chat recipe, refine, `/v1/recipes/generate`) asks the model for step *metadata only* — `text` always comes from the matching `instructions` entry via `build_structured_steps`, never from the model, so the two can never drift.
- **Lazy upgrade**: `POST /v1/recipes/{recipe_id}/steps/ensure` returns existing steps with no model call (idempotent), or derives them from `instructions` + a model metadata call, validates, persists, and returns them. A failed or invalid model call persists nothing; the caller falls back to the client-side regex timer parser.
- **Related**: Recipe (holds `steps` alongside `instructions`), Meal timeline (issue #649, the scheduler this feeds)

### Meal
A saved or draft grouping of one main and one or two sides, with a single servings number and optional Kitchen limits (issue #650 / spec #647). It refers to its Dishes and never copies them.

- **Fields**: `title`, `description`, `servings` (int), `constraints` (JSONB — kitchen limits, the mapped exclusive tags, and the RecipeConstraints echo used to regenerate sides), `is_draft`, `source_type` (default `chat`), `last_cooked_at`, `times_cooked`, `user_id`, timestamps
- **Storage**: `meals` + `meal_dishes` (join table: `meal_id`, `recipe_id`, `user_id`, `role`, `position`), `supabase/migrations/00013_meals.sql`. `meal_dishes` cascades on either its meal or its recipe being deleted. One main per meal (a partial unique index on `role = 'main'`), unique `(meal_id, position)`, unique `(meal_id, recipe_id)`. RLS: own rows only, same shape as `recipes`.
- **Drafts**: opening a meal from chat persists it (and any new Dish recipes) as a draft — the same pattern as a chat-generated Recipe — so it has an id, a route, and a cook session that survives reload. Saving promotes the meal and its draft dishes together.
- **Deleting**: deleting a meal deletes it and its *draft* dish recipes, keeping saved ones. Deleting a recipe that's a meal's main deletes that meal too (a mainless meal can't stand); deleting a side recipe just removes it from the meal.
- **The Meal timeline is not stored** — recomputed from the dishes' Structured steps and the meal's constraints, since the scheduler is deterministic.
- **Related**: Dish, Meal option, Meal timeline, Kitchen limits, Recipe

### Dish
A Recipe playing a role (`main` | `side`) in a Meal, at a position (0 = main, 1-2 = sides). A Dish *is* a Recipe — dish identity is by recipe id only, never a copy — so the same Recipe can be a Dish in several Meals.

- **Related**: Meal (holds 1-3 Dishes via `meal_dishes`), Recipe

### Meal option
One of the three lightweight outlines shown as tappable cards before the user picks a Meal to expand (issue #650 / spec #647). Holds dish names and roles, estimated total/hands-on time, pantry coverage, and a rescue flag — not yet a set of full recipes.

- **Fields** (`meal_options` proposal, `intent: "meal_plan"`, `next_action: "pick_meal"`): `option_id` (stable within the conversation), `title`, `blurb`, `dishes` (role, name, key_ingredients, est_total_minutes, est_hands_on_minutes — one main first, then 1-2 sides), `est_total_minutes`, `est_hands_on_minutes`, `coverage` (`pantry_items_used`, `to_buy`), `rescues` (expiring-soon items used, `[]` when none)
- **Computed in code, never by the model**: coverage, `to_buy`, and the rescue flag — deterministic pantry matching, staples counted as assumed.
- **Pick**: a tap sends the option's `option_id` in `context.meal_option_id`, never fuzzy-matched from the visible message text. The backend resolves it from the three options retained in the session (next to `brainstorm_ideas`). The response is then a `meal` proposal — one full RecipeCard with Structured steps per Dish.
- **Related**: Meal (what picking an option expands into), Dish

### Fixed main
The dish a make-it-a-meal flow keeps as the Meal's main (issue #651 PR B). The user starts from one existing dish ("Make it a meal" on a chat recipe card, a saved-recipe lookup card, or the recipe page); every Meal option then carries that dish unchanged as its main and differs only in its sides.

- **Reference**: a saved Recipe is referenced by id (`context.meal_fixed_main.recipe_id`); an in-chat recipe is sent as a payload (`context.meal_fixed_main.recipe`). A draft row is never referenced by id.
- **Pick**: the main is not regenerated. A saved main carries its `recipe_id` through to `POST /api/meals`, which links it without copying, so the Meal's main is the same Recipe the user started from.
- **Related**: Meal option, Dish, Pill (the `meal_followup` pills keep the main; sides-only wording when a main is fixed)

### Meal timeline
The deterministic meal scheduler's output for a set of 1-3 dishes (a main plus one or two sides) — placements, display rows and cues for cooking them together. Produced by `scheduleMeal()` in `nextjs/src/lib/meal-scheduler.ts` (issue #649).

- **Pure module**: no LLM call, no clock read (`Date.now()`), no I/O, no randomness — the LLM supplies step facts (durations, dependencies, hands-on/off) via Structured step, and code builds the plan. Lives in the Next.js shared library, not ai-service, so cook-along can re-plan instantly and offline-tolerantly on every +2 min or Skip tap.
- **Algorithm**: backward, as-late-as-possible list scheduling from a common finish time — implemented as forward ("as soon as possible") resource-constrained list scheduling run on the *reversed* dependency graph, then shifted so the earliest start is 0. The cook (one hands-on step at a time, across all dishes) and each Kitchen limit tag are unary resources. Resource-contention ties are broken by critical-path length (more chained work goes first), then column order (main, side 1, side 2), then step index — the last two are what guarantee byte-identical output for the same input. Re-planning (a `progress` input of done/skipped/running steps and `+2 min` extensions) instead runs forward in real time from `now_minutes`, with past placements fixed.
- **Guarantees** (asserted as property tests over seeded-random dish sets): no two hands-on steps overlap; dependencies are respected; no two steps sharing an exclusive tag overlap; every dish finishes within the finish window when feasible, with the actual spread reported when it isn't; identical input gives identical output; the plan is never longer than cooking the dishes one after another (an explicit sequential-plan comparison is the fallback if it ever would be); re-planning keeps past placements fixed and places nothing before `now_minutes`.
- **Rows and cues**: one row per moment at least one dish starts a new step. A cell is `start` / `ongoing` (rendered faded, e.g. "pasta boiling · 6 min left") / `waiting` / `done`. A row gets a cue — `"While {ongoing_label}, {label}"` for the longest-remaining ongoing hands-off step (ties by column order), or `"Meanwhile, {label}"` when that step has no ongoing label — generated from labels with no second LLM call.
- **Defensive degradation**: a missing/invalid duration defaults to 3 minutes (`estimated_duration` warning); a dish whose `depends_on` can't be trusted as given falls back to running its steps strictly in order (`sequential_fallback` warning, `degraded: true`).
- **Anchoring**: a separate pure helper (`resolveMealAnchor()`, `meal-anchor.ts`) maps offsets to clock time, given an explicit `now` — never reads a clock itself. Start-now shows relative offsets until cooking begins; serve-at computes `start = serve_at − total_minutes` and returns `too_late` plus the earliest ready time when that's already in the past.
- **Related**: Structured step (the input), Kitchen limits (the `exclusive` resource), the timeline table component (`MealTimelineTable`, renders this) — see also issue #647's "the deterministic meal scheduler (contract)".

### Pill
A tappable affordance rendered by `PostMessageChips` (chat) or the home screen's starter row — the umbrella term for what issue #651 calls "chips" everywhere else in the codebase (`ChipConfig`, `resolveChips`, `lib/chat-chips.ts`). Two kinds, three sources.

- **Kinds**: **send** (default) — taps `onChipTap(chip)`, which sends `chip.message` as the next user turn; gets a ✎ (edit) affordance when the caller wires `onEditChip`, staging the message in the input instead of sending. **action** — taps `onChipAction(chip.action)`, one of a closed union (`save_meal` | `open_scan` | `open_meal`) that model output can never produce; never gets a ✎; omitted entirely when the caller hasn't wired a handler.
- **Sources**: **starter** — the empty chat screen's row, ranked from `StarterContext` by `rankStarterPills()` (`lib/starter-pills.ts`); always exactly 3, slot 1 always time-of-day. **predicted** — a model-generated follow-up riding `metadata.follow_up_suggestions`, sanitised and capped by `resolveChips()`. **fallback** — the fixed per-intent set (`resolveStaticChips()`) shown when no usable predicted pills survive sanitising, or topped up alongside them.
- **The `meal_followup` stamp**: a resolver-only `context: { meal_followup: true }` on specific send pills (never on model output) that routes a tap straight back to the `meal_plan` intent, bypassing the classifier. Lost when a pill is edited via ✎.
- **Related**: Meal option (the pick stage a meal-plan pill can re-open), Intent (what a stamped pill overrides)

### Kitchen limits
User-stated cooking constraints, e.g. "I only have one pan" — not an equipment model (no burners/ovens/pans-as-inventory), just what the user says.

- Two halves. A Structured step's `exclusive` tags say what equipment it ties up (`pan`, `oven`), whoever is cooking. The user's limits, extracted from chat as short phrases (`"one pan"` → `pan`), live on the Meal and reach the scheduler as `constraints.exclusive_tags`.
- The Meal timeline scheduler treats a tag as a unary resource only when it is one of the user's limits. Under "one pan", two pan steps, hands-on or hands-off, never overlap and run one after the other, whichever dish they belong to. With no limit, the same steps overlap freely.
- Stored on the meal (issue #647's `meals.constraints`), out of scope for #649 itself, which only consumes the tags already present on steps.

### Pantry
User's inventory of food items. Tracks what's available, quantities, expiry dates, and location (storage slot).

- **Fields**: name, quantity, unit, category, expiry_date, stored_at (slot_index), user_id
- **Computed**: is_expired, days_until_expiry, priority (for recipe generation)
- **Lifecycle**: added (manual or via scan), used/consumed, expired
- **Related**: Recipe (used to ground recipe generation)

### RecipeConstraints
Extracted user preferences that shape recipe generation. Populated from chat intent, explicit user input, or AI inference.

- **Fields**: cuisine (list), max_prep_time (minutes), max_cook_time (minutes), dietary (list), skill_level, restrictions (list)
- **Source**: LLM extracts from user query in chat workflows
- **Usage**: Passed to score_and_rank() during recipe generation

### Allergy and Dislike
Two profile lists (`user_profiles.allergies`, `user_profiles.disliked_ingredients`, migration `00018`; issue #500) that feed `RecipeConstraints.excluded_ingredients` on every generation and chat turn. They differ in strength, and the difference is the point:

- **Allergy** -- a hard "never suggest" (safety, not preference). Nothing in a message overrides it ("I know I'm allergic, do it anyway" changes nothing). Enforced twice: the prompts carry an explicit `NEVER include (allergy)` line, and a deterministic **allergen guard** (`services/allergen_guard.py`, matcher in `domain/allergens.py`) checks every card, meal outline, dish and brainstorm idea the model returns -- regenerate once naming the offence, then refuse honestly rather than return it. The model is never the only line of defence. Broad labels expand ("nuts" covers almond, cashew...; "dairy" covers cheese...). Free-text chat replies are prompt-only (no structured output to check).
- **Dislike** -- a soft "leave out of suggestions". A message that explicitly asks for the ingredient ("add cilantro on top") wins for that reply only; "without cilantro" does not count as an ask. Rides the same set-aside rules as an exclusion the user typed (`RecipeCard.exclusions_set_aside`).
- **Not persisted into the session**: profile-origin exclusions are re-read from the profile each turn (`constraints_to_persist` leaves them out), so dropping one from the profile takes effect immediately.
- **Degrades**: a profile row without the columns (migration not yet applied), a missing row or an unreachable DB reads as "nothing stored" -- never an error.
- **Related**: RecipeConstraints, Recipe (the card the guard checks), Meal option / Dish (the meal engine runs the same guard)

### ProposalEnvelope
AI-generated structured output wrapped with confidence scores. Prevents data corruption from low-confidence AI hallucinations.

- **Fields**: proposal (the data), confidence (0.0–1.0), notes (why this confidence level)
- **Flow**: AI generates → proposal returned to user with confidence badge → user confirms → writes to DB
- **Related**: Recipe (recipe_proposal), Pantry (item_proposal), Profile (preference_proposal)

### Session
Server-side conversation state. Enables context-aware intent routing across turns.

- **Fields**: id, user_id, created_at, active_mode (last detected intent), messages (history)
- **Modes**: chat, recipe, pantry, cooking, general
- **Lifecycle**: created on first POST /v1/chat, persists until explicit clear or timeout
- **Related**: Intent routing (SessionMode transitions enable multi-turn understanding)

### Intent
User's underlying goal in a chat message. Detected by LLM classification or heuristic matching.

- **Canonical intents**:
  - `recipe-generate` — "What can I make with X?" (grounds in pantry)
  - `pantry-add` — "I just bought milk" (triggers scan or manual add)
  - `cooking-question` — "How do I tenderize chicken?" (general advice, no data mutation)
  - `saved-recipe-lookup` — "Make that butter chicken" (queries recipe library)
  - `general-chat` — Anything else (open-ended conversation)
- **Routing**: Router dispatches to sub-graph based on intent
- **Related**: Session (active_mode for context)

### Grounding Workflow
The process of anchoring recipe generation in the user's actual pantry to ensure feasibility.

1. Extract user constraints (RecipeConstraints) from chat
2. Fetch pantry items + expiring items
3. Score items by relevance (expiry urgency + constraint match)
4. Pass ranked items as context to LLM (never dump raw inventory)
5. LLM generates recipe that uses available ingredients
6. Return ProposalEnvelope with confidence score

**Key insight**: LLM receives structured context, not raw data. Prevents hallucinated ingredients.

---

### URL Recipe Import
A feature that lets users paste a recipe URL and import it into their library as a RecipeCardProposal.

- **Entry point**: "Import" button/modal on the `/recipes` page
- **Parser**: `services/url_recipe_importer.py` — `async def import_from_url(url, user_id, ai_manager) -> RecipeCardProposal`
- **Extraction strategy**: `recipe-scrapers` for known sites (~300 supported); LLM fallback for unknowns
- **Review flow**: Returns `ProposalEnvelope` — user reviews/edits extracted fields before confirming to DB
- **Error handling**: Hard errors with classified failure reason — `not_a_recipe`, `paywalled`, `fetch_failed`, `invalid_url`. Error message shown in modal; user can try a different URL. Contextual LLM-generated reason text is a future enhancement.
- **Confidence thresholds**: Same as scan — ≥0.8 ready, 0.5–0.8 needs review, <0.5 treated as hard error
- _Avoid_: "scrape", "crawl" — use "import" or "extract"

## AI Workflows Architecture

The AI service uses LangGraph sub-graphs dispatched by a parent Router:

### Router (router.py, 1391 lines)
Parent graph that:
1. Accepts chat message + session context
2. Classifies intent
3. Dispatches to appropriate sub-graph (or chains multiple sub-graphs)
4. Returns response

**Sub-graphs:**
- **Pantry** — deterministic inventory logic (no LLM)
- **Recipe** — constraint extraction + grounding workflow + generation
- **Cooking** — ReAct-style with tool access (substitutions, techniques)
- **Ingest** — unified multimodal: photo, URL, video, receipt, text
- **General Chat** — ReAct-style with tool access (no data mutation)

### Execution Phases (Refactor R1–R5)

| Phase | Complete? | Description |
|-------|-----------|-------------|
| R1 | ✅ Done | Sub-graph decomposition; `chat_ingest.py` is now 23-line shim |
| R2 | ✅ Done | Server-side sessions + context-aware intent routing |
| R3 | Pending | Cooking Companion sub-graph (ReAct-style) |
| R4 | Pending | Unified Ingest sub-graph (absorbs URL + video ingestion) |
| R5 | Pending | LLM tools for General Chat sub-graph |

---

## Frontend Stack

- **Framework**: Next.js 14 (App Router)
- **State management**: React Query (server state), Zustand (client state)
- **Styling**: Tailwind CSS v4 + Framer Motion
- **Auth**: Supabase (session token in Authorization header)
- **API**: Two surfaces:
  - CRUD → `/api/*` (Next.js routes, same-origin)
  - AI ops → `http://localhost:8888` (FastAPI microservice, direct browser calls for SSE)

## Backend Stack

- **Database**: Supabase Postgres 15 (Row-Level Security per user)
- **CRUD API**: Next.js API routes (`/api/*`)
- **AI Microservice**: FastAPI + LangGraph (port 8888, Railway deployment)
- **Async/streaming**: SSE for chat (client → Railway, bypasses Vercel serverless timeout)

---

## Key Patterns

### API Client
All API calls go through `nextjs/src/lib/api/client.ts`. Methods:
- `pantryQuery()` — fetch pantry
- `createRecipe()` — POST new recipe
- `chatStream()` — SSE stream from AI service
- etc.

### Repository Pattern (ai-service)
All DB access via `SupabaseRepository` in `ai-service/bubbly_chef/repository/supabase_repo.py`:
- Takes `service_role_key` (admin, used by microservice)
- Every method takes `user_id` as first param (enforces RLS)
- Never call Supabase SDK directly from routes; always delegate to Repository

### AIManager
Central dispatcher for AI providers. Never call Gemini/Ollama SDK directly:
```python
manager = get_ai_manager()
result = await manager.complete(messages, schema)  # Falls back: Gemini → Ollama
```

### Proposal Pattern
AI never writes to DB directly. Always returns ProposalEnvelope:
```python
{
  "proposal": {...recipe data...},
  "confidence": 0.87,
  "notes": "High confidence: clear ingredients + standard technique"
}
```
Frontend displays confidence badge. User clicks "Add" → POST `/apply` → write to DB.

---

## Domain Reference

### Categories
Pantry items categorized by type: produce, dairy, meat, pantry, frozen, beverages, condiments, etc. Used for icon selection + sorting.

### Expiry Priority
Items with 1–3 days until expiry are flagged as "expiring soon" and prioritized in recipe grounding. Items past expiry are hidden from normal view but remain in history.

### Unit Normalization
Pantry accepts units: oz, g, ml, l, cup, tsp, tbsp, count. Recipe generation uses compatible units only.

### Piece vs Package Units
A **piece unit** (slice, leaf, clove, sprig, stick) counts pieces *of* an ingredient. A **package unit** (item, loaf, bunch, head, bag, can, package, bottle, jar, box, container) counts packages *containing* an unknown number of pieces. They are incommensurable: the pantry does not record slices per loaf.

`count` is neither — it is a genuine tally, so `6 count garlic` still deducts normally. The distinction is read from a pantry row's **raw display unit**, before `normalize_unit` collapses `item` into `count`.

### Imprecise (cook match status)
A cook-proposal ingredient status alongside `ready` / `substitute` / `shortfall` / `unit_conflict`. Means "you have this, we cannot quantify how much the recipe uses" — a piece-unit request against a package-unit row. Counts as **satisfied** for cook-readiness and deducts **nothing**; the pantry row is stamped with the recipe and time that consumed it imprecisely, so the deliberate drift is visible where the user would correct it.

Genuine conversion is always tried first — a piece against a row with a real mass base resolves through conventional piece weights (`2 slices cheese` vs `500 g cheese` → 42 g). See `docs/adr/0003-piece-vs-package-units-are-incommensurable.md`.

### Confidence Thresholds
- ≥ 0.8: Ready-to-add (no user review needed)
- 0.5–0.8: Needs review (user edits before add)
- < 0.5: Skipped (low confidence, not shown)

---

## References

- **Architecture docs**: `docs/ARCHITECTURE.md`
- **API routes**: `docs/plans/2026-04-29-active-work-items.md` (endpoints section)
- **Workflows**: `ai-service/bubbly_chef/workflows/router.py`
- **Repository**: `ai-service/bubbly_chef/repository/supabase_repo.py`

---

*Last updated: 2026-05-02*
