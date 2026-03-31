# AI Workflows Architecture Redesign

## Context

BubblyChef's AI workflows have grown into a 2400-line monolith (`chat_ingest.py`) that handles intent routing, pantry parsing, recipe brainstorming, recipe generation, cooking help, and general chat all in one file. Recipe ingest is hardcoded to Ollama (bypassing AIManager). Conversation state doesn't persist across turns — "yes" after "can I make pasta?" gets misclassified. Scan page and chat workflows duplicate logic (OCR, item parsing, normalization). Two new use cases (cooking companion, multimodal ingest) can't be built cleanly on the current foundation.

**Goal:** Decompose the monolith into composable LangGraph sub-graphs with shared tools, server-side conversation sessions, and a lightweight parent router — then build cooking companion and multimodal ingest on the new foundation.

---

## Architecture Overview

```
POST /v1/chat
    │
    ▼
┌─────────────────────────────────────────┐
│         Parent Graph: Router            │
│  1. Load ConversationSession (SQLite)   │
│  2. Classify intent (context-aware)     │
│  3. Dispatch to sub-graph               │
│  4. Update session state                │
│  5. Wrap response in ProposalEnvelope   │
└───────────┬─────────────────────────────┘
            │
   ┌────────┼────────┬──────────┬──────────┐
   ▼        ▼        ▼          ▼          ▼
Pantry   Recipe   Cooking    Ingest    General
Sub-Graph Sub-Graph Sub-Graph Sub-Graph  Chat
                     │                  Sub-Graph
                     │                     │
              LLM ToolNode          LLM ToolNode
              (substitution,        (search_recipes,
               technique,            get_pantry_items,
               get_pantry)           score_pantry)
```

Each sub-graph:
- Has its own scoped `TypedDict` state (Pattern B)
- Uses `AIManager` for all LLM calls (Gemini → Ollama fallback)
- Returns results through the shared `ProposalEnvelope` contract
- Is independently testable

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sub-graph state | Scoped (each has own TypedDict) | Testable in isolation, no field collision between sub-graphs |
| Conversation persistence | Server-side SQLite sessions | Router needs mode/context to classify correctly; frontend just sends conversation_id |
| LLM tool access | Cooking + General Chat sub-graphs only | Pantry/Recipe flows are deterministic; cooking/chat need dynamic tool dispatch |
| Shared tools | Plain Python functions callable from routes AND graph nodes AND LLM ToolNode | Eliminates duplication between scan page, pantry page, and chat workflows |
| AI provider | All sub-graphs use AIManager | Fixes recipe_ingest.py Ollama-only bug; consistent fallback everywhere |

---

## File Structure

```
bubbly_chef/workflows/
├── router.py                    # Parent graph: classify + dispatch + session management
├── session.py                   # ConversationSession model + SQLite CRUD
├── shared_state.py              # Shared types, envelope builders (from current state.py)
├── pantry/
│   ├── __init__.py              # Exports: pantry_subgraph, PantrySubState
│   ├── graph.py                 # LangGraph sub-graph definition
│   └── nodes.py                 # parse, normalize, expiry, dedup, review_gate, finalize
├── recipe/
│   ├── __init__.py
│   ├── graph.py
│   └── nodes.py                 # constraints, score_pantry, brainstorm, research, generate
├── cooking/
│   ├── __init__.py
│   ├── graph.py                 # ReAct-style graph with ToolNode
│   ├── nodes.py                 # pin_recipe, call_cooking_llm, respond
│   └── tools.py                 # suggest_substitution, explain_technique (LangGraph @tool)
├── ingest/
│   ├── __init__.py
│   ├── graph.py
│   ├── detect.py                # Media type detection (photo, URL, video, receipt, text)
│   └── handlers.py              # photo_to_items (vision), video_to_recipe, url_to_recipe
└── chat/
    ├── __init__.py
    ├── graph.py                 # ReAct-style graph with ToolNode
    └── nodes.py                 # call_chat_llm, respond

bubbly_chef/tools/               # Shared tool functions (used by routes + sub-graphs + LLM)
├── ocr.py                       # ocr_receipt(image, preprocess) → str
├── parse_items.py               # parse_items(text) → list[ParsedItem]   (LLM call)
├── normalize.py                 # normalize_item(name) → NormalizedItem   (existing, refactored)
├── expiry.py                    # estimate_expiry(item) → ExpiryEstimate  (existing, refactored)
├── dedup.py                     # check_duplicates(items, pantry) → DedupResult
├── pantry_ops.py                # add_pantry_items(), update_pantry_item() (DB writes)
├── recipe_search.py             # search_recipes(query, cuisine) → list[SearchResult]
├── pantry_scoring.py            # score_pantry_for_recipe(constraints, pantry) → list[ScoredItem]
├── substitution.py              # suggest_substitution(ingredient, available) → Suggestion
├── web_search.py                # (existing) DuckDuckGo search
├── product_lookup.py            # (existing) barcode/name lookup
├── vision.py                    # identify_items_from_photo(image) → list[ParsedItem] (NEW)
└── video_extract.py             # extract_video_transcript(url) → str (NEW)
```

---

## Conversation Session Model

### Database Schema (Alembic migration)

```sql
CREATE TABLE conversation_sessions (
    id TEXT PRIMARY KEY,
    active_mode TEXT NOT NULL DEFAULT 'default',
    pinned_recipe_id TEXT,
    pending_proposal TEXT,          -- JSON serialized ProposalEnvelope
    metadata TEXT DEFAULT '{}',     -- JSON dict for sub-graph specific state
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE conversation_turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES conversation_sessions(id),
    role TEXT NOT NULL,              -- 'user' | 'assistant'
    content TEXT NOT NULL,
    intent TEXT,
    created_at TIMESTAMP NOT NULL
);
```

### Session Modes

| Mode | Meaning | Router Behavior |
|------|---------|-----------------|
| `default` | No active flow | Full intent classification (keyword → LLM) |
| `cooking` | User is cooking a pinned recipe | Route to Cooking sub-graph unless exit phrase detected |
| `recipe_exploring` | User brainstorming/picking recipes | Route to Recipe sub-graph for selection/refinement |
| `ingesting` | User reviewing proposed items | Route to Ingest sub-graph for confirm/edit/cancel |
| `pantry_editing` | User mid-pantry-update | Route to Pantry sub-graph for follow-up |

### Context-Aware Intent Classification

```python
def classify_with_context(message: str, session: ConversationSession) -> Intent:
    # 1. If mid-flow, use mode to shortcut classification (no LLM call)
    if session.active_mode == "cooking":
        return Intent.COOKING_END if is_exit_phrase(message) else Intent.COOKING_QUESTION
    if session.active_mode == "recipe_exploring":
        if is_recipe_selection(message, session.metadata.get("brainstorm_ideas")):
            return Intent.RECIPE_SELECTED
        return Intent.RECIPE_REFINE if not is_exit_phrase(message) else Intent.GENERAL_CHAT
    if session.active_mode == "ingesting":
        if is_confirmation(message): return Intent.INGEST_CONFIRM
        if is_cancellation(message): return Intent.INGEST_CANCEL
        return Intent.INGEST_EDIT
    # 2. Default: full classification (existing keyword + LLM fallback)
    return classify_intent_fresh(message, session.recent_turns)
```

---

## Sub-Graph Details

### 1. Pantry Sub-Graph

**Source:** Extracted from `chat_ingest.py` lines ~500-1200

**Scoped State:**
```python
class PantrySubState(TypedDict):
    input_text: str
    pantry_snapshot: list[dict]
    parsed_items: list[dict]
    normalized_items: list[dict]
    actions: list[PantryUpsertAction]
    proposal: PantryProposal | None
    confidence: float
    field_confidences: dict[str, float]
    per_item_confidences: list[float]
    warnings: list[str]
    errors: list[str]
    requires_review: bool
    clarifying_questions: list[str]
    assistant_message: str
```

**Graph:**
```
parse_items → normalize → apply_expiry → check_duplicates → create_actions → review_gate → finalize
```

**Tool usage:** Calls shared tools directly (deterministic, not LLM-driven)

### 2. Recipe Sub-Graph

**Source:** Extracted from `chat_ingest.py` lines ~1400-2100 + `recipe_ingest.py`

**Scoped State:**
```python
class RecipeSubState(TypedDict):
    input_text: str
    pantry_snapshot: list[dict]
    recipe_constraints: RecipeConstraints | None
    scored_pantry_items: list[dict]
    brainstorm_ideas: list[str]
    selected_recipe_name: str | None
    web_search_result: dict | None
    recipe: RecipeCard | None
    ingredient_availability: list[IngredientAvailability]
    proposal: RecipeCardProposal | None
    confidence: float
    warnings: list[str]
    errors: list[str]
    assistant_message: str
```

**Graph:**
```
extract_constraints → score_pantry → brainstorm
    (user picks → via session) → research → generate_grounded → finalize
```

**Tool usage:** Calls shared tools directly; `search_recipes` for web research

### 3. Cooking Sub-Graph (NEW)

**Scoped State:**
```python
class CookingSubState(TypedDict):
    recipe: RecipeCard
    current_step: int
    user_message: str
    conversation_history: list[dict]
    tool_calls: list[dict]
    assistant_message: str
```

**Graph (ReAct pattern):**
```
call_cooking_llm ←→ tool_node (loop until LLM stops calling tools)
    │
    ▼
  respond → END
```

**LLM Tools:**
- `suggest_substitution(ingredient, available_items)` — pantry-aware substitution
- `explain_technique(technique)` — cooking technique explanation
- `get_pantry_items()` — check what user has available

**System prompt includes:** Full recipe text, current step number, user's pantry summary

### 4. Ingest Sub-Graph (UNIFIED, replaces 3 separate workflows)

**Scoped State:**
```python
class IngestSubState(TypedDict):
    input_type: str              # "photo", "url", "video_url", "receipt_image", "text"
    raw_input: str | bytes
    extracted_text: str | None
    parsed_items: list[dict]     # if pantry items
    recipe: RecipeCard | None    # if recipe
    proposal: PantryProposal | RecipeCardProposal | None
    confidence: float
    warnings: list[str]
    errors: list[str]
    assistant_message: str
```

**Graph:**
```
detect_media_type → route
    ├── photo_handler → (vision API) → Pantry Sub-Graph
    ├── video_url_handler → (transcript extraction) → Recipe Sub-Graph
    ├── receipt_handler → (Tesseract OCR) → Pantry Sub-Graph
    ├── url_handler → (fetch + clean HTML) → Recipe Sub-Graph
    └── text_handler → classify → Pantry or Recipe Sub-Graph
```

**Handlers use shared tools:** `ocr_receipt()`, `identify_items_from_photo()`, `extract_video_transcript()`, `fetch_url_content()`

### 5. General Chat Sub-Graph

**Source:** Extracted from `chat_ingest.py` general_chat + cooking_help nodes

**Scoped State:**
```python
class ChatSubState(TypedDict):
    user_message: str
    conversation_history: list[dict]
    pantry_context: str | None
    tool_calls: list[dict]
    assistant_message: str
    suggested_mode: str | None
    suggested_action: str | None
```

**Graph (ReAct pattern):**
```
call_chat_llm ←→ tool_node (loop)
    │
    ▼
  respond → END
```

**LLM Tools:**
- `get_pantry_items()` — "what do I have?"
- `search_recipes(query)` — "find me a quick pasta recipe"
- `score_pantry_for_recipe(constraints)` — "what can I make?"
- `suggest_substitution(ingredient, available)` — "what can I use instead of butter?"

---

## Shared Tool Registry

These are plain Python `async` functions that can be:
1. Called directly from sub-graph nodes (deterministic orchestration)
2. Wrapped as LangGraph `@tool` for LLM ToolNode access
3. Called from API routes (scan page, pantry page)

| Tool | Input | Output | LLM-accessible? |
|------|-------|--------|------------------|
| `ocr_receipt(image, preprocess)` | bytes, bool | str (raw text) | No |
| `parse_items(text)` | str | list[ParsedItem] | No |
| `normalize_item(name)` | str | NormalizedItem | No |
| `estimate_expiry(item)` | NormalizedItem | ExpiryEstimate | No |
| `check_duplicates(items, pantry)` | lists | DedupResult | No |
| `add_pantry_items(items)` | list[PantryItem] | list[PantryItem] | No |
| `update_pantry_item(id, updates)` | UUID, dict | PantryItem | No |
| `get_pantry_items()` | - | list[dict] | **Yes** (cooking, chat) |
| `search_recipes(query, cuisine)` | str, str? | list[SearchResult] | **Yes** (chat) |
| `score_pantry_for_recipe(constraints)` | RecipeConstraints | list[ScoredItem] | **Yes** (chat) |
| `suggest_substitution(ingredient, available)` | str, list[str] | Suggestion | **Yes** (cooking, chat) |
| `explain_technique(technique)` | str | str | **Yes** (cooking) |
| `identify_items_from_photo(image)` | bytes | list[ParsedItem] | No |
| `extract_video_transcript(url)` | str | str | No |
| `fetch_url_content(url)` | str | str | No |

---

## Parent-to-Sub-Graph State Mapping

Each sub-graph has enter/exit mapping functions:

```python
# Example: Pantry
def enter_pantry(state: RouterState) -> PantrySubState:
    return PantrySubState(
        input_text=state["input_text"],
        pantry_snapshot=state.get("pantry_snapshot", []),
        parsed_items=[], normalized_items=[], actions=[],
        proposal=None, confidence=0.0, field_confidences={},
        per_item_confidences=[], warnings=[], errors=[],
        requires_review=False, clarifying_questions=[],
        assistant_message="",
    )

def exit_pantry(parent: RouterState, sub: PantrySubState) -> RouterState:
    return {**parent,
        "proposal": sub["proposal"],
        "assistant_message": sub["assistant_message"],
        "confidence": sub["confidence"],
        "errors": sub["errors"], "warnings": sub["warnings"],
        "requires_review": sub["requires_review"],
        "clarifying_questions": sub["clarifying_questions"],
    }
```

---

## Execution Order (Refactor-First)

### Phase R1: Foundation (no new features, same behavior)
1. **Create `workflows/session.py`** — ConversationSession model + SQLite CRUD + Alembic migration
2. **Create `workflows/shared_state.py`** — Move envelope builders, mappers, shared types from `state.py`
3. **Extract Pantry Sub-Graph** — Move pantry nodes from `chat_ingest.py` → `workflows/pantry/`
4. **Extract Recipe Sub-Graph** — Move recipe nodes from `chat_ingest.py` → `workflows/recipe/`; fix Ollama-only bug
5. **Extract General Chat Sub-Graph** — Move general_chat + cooking_help from `chat_ingest.py` → `workflows/chat/`
6. **Create `workflows/router.py`** — Parent graph that dispatches to sub-graphs; replaces `chat_ingest.py`
7. **Refactor shared tools** — Extract reusable functions from sub-graph nodes into `tools/`
8. **Wire scan routes** to use shared tools (eliminate duplication with chat workflow)
9. **Tests** — Verify all existing tests still pass; add sub-graph unit tests

### Phase R2: Conversation Sessions
1. Alembic migration for `conversation_sessions` + `conversation_turns` tables
2. Implement session loading/saving in router
3. Context-aware intent classification using session mode
4. Update `/v1/chat` route to use `conversation_id` → session lookup
5. Frontend sends `conversation_id` only (stop shipping full history array)

### Phase R3: Cooking Companion
1. `workflows/cooking/` — ReAct sub-graph with LLM tool access
2. `tools/substitution.py`, `tools/technique.py` — cooking-specific tools
3. Session mode transitions: `default` → `cooking` → `default`
4. Update chat UI to show pinned recipe when in cooking mode

### Phase R4: Multimodal Ingest
1. `workflows/ingest/` — Unified ingest with media type detection
2. `tools/vision.py` — Gemini vision API for photo → items
3. `tools/video_extract.py` — YouTube/TikTok transcript extraction
4. Deprecate separate `receipt_ingest.py`, `product_ingest.py`, `recipe_ingest.py`

### Phase R5: LLM Tools for General Chat
1. Add tool access to General Chat sub-graph
2. Register: `get_pantry_items`, `search_recipes`, `score_pantry_for_recipe`, `suggest_substitution`
3. Enable proactive suggestions ("chicken expiring tomorrow — want recipe ideas?")

---

## Verification

After each phase:
- `pytest` — all existing tests pass
- `mypy bubbly_chef/ --strict` — type check clean
- `ruff check bubbly_chef/` — lint clean
- `cd web && npx tsc --noEmit` — frontend types clean
- Manual: POST `/v1/chat` with test messages, verify same behavior as before
- Manual: Scan page still works end-to-end
- `ao goals measure` — fitness gates still passing

After Phase R1 specifically:
- `chat_ingest.py` should be deleted or reduced to a thin re-export shim
- Each sub-graph should have its own test file
- No behavior changes — this is a pure refactor
