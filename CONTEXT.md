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
