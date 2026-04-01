# BubblyChef — AI Assistant Context

**A Sanrio-inspired pantry + recipe assistant. Scan receipts, manage pantry, generate AI recipes, chat about cooking, and visualize your kitchen.**

---

## Quick Start

```bash
uvicorn bubbly_chef.api.app:app --reload --port 8888   # backend
cd web && npm run dev                                   # frontend → http://localhost:5173
pytest                                                  # tests
ruff check bubbly_chef/                                 # lint
mypy bubbly_chef/ --strict                             # type check
```

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11+ + FastAPI (port 8888) |
| Frontend | React 18 + TypeScript + Vite (port 5173) |
| Database | SQLite (aiosqlite, async) + Alembic migrations |
| AI | Gemini API (free tier) + Ollama (self-hosted fallback) |
| AI Orchestration | LangGraph workflows (chat, receipt, product, recipe ingest) |
| OCR | Tesseract |
| State (frontend) | Zustand (client) + React Query (server state) |
| Styling | Tailwind CSS v4 + Framer Motion |
| Version | 0.1.0 — Phase 2 complete, Phase 3 next |

---

## Architecture

```
Frontend (React + TypeScript)
    └── React Query + Fetch → HTTP/REST
Backend (FastAPI)
    └── Routes (thin) → Services (business logic) → Repository (SQLite)
                     → Workflows (LangGraph state machines for complex AI ops)
                     → AI Manager → GeminiProvider | OllamaProvider
                     → Domain (normalize, expiry, defaults, icon mapping)
                     → Tools (LLM client, expiry, normalizer, product lookup)
                     → OCR Service (Tesseract)
```

**Key patterns:**
- **AI Provider Abstraction** — `AIManager` picks first available provider. Never call Gemini SDK directly.
- **Repository Pattern** — All DB access via `SQLiteRepository`. All methods are `async/await`.
- **LangGraph Workflows** — Complex multi-step AI ops (chat intent routing, receipt parsing, recipe ingestion) live in `workflows/`, not in routes or services.
- **Services layer** — Business logic lives in `services/`, routes stay thin.
- **React Query** — Server state only. Avoid `useState` for fetched data.
- **Structured AI output** — Always use Pydantic response schemas, never parse raw strings.

---

## Project Structure

```
bubbly_chef/
├── api/
│   ├── app.py               # FastAPI app, lifespan, middleware, router registration
│   └── routes/              # pantry.py, scan.py, recipes.py, chat.py, profile.py,
│                            # health.py, ingest.py, apply.py, icons.py, decorations.py
├── ai/                      # provider.py, manager.py, gemini.py, ollama.py
├── workflows/               # LangGraph: chat_ingest.py, receipt_ingest.py,
│                            #   product_ingest.py, recipe_ingest.py, state.py
│                            #   recipe/ package: nodes.py (grounding + constraint extraction)
├── tools/                   # llm_client.py, expiry.py, normalizer.py, product_lookup.py
├── services/                # ocr.py, receipt_parser.py, image_preprocessor.py
├── domain/                  # normalizer.py, expiry.py, defaults.py, icon_map.py,
│                            # catalog.py (304-entry USDA food catalog)
├── models/                  # pantry.py, user.py, recipes.py, proposals.py
├── repository/              # base.py, sqlite.py
├── config.py
└── logger.py

web/src/
├── api/client.ts            # API client + React Query hooks
├── pages/                   # Dashboard, Pantry, Scan, Chat, Profile
├── components/              # Shared UI components + Kitchen scene
└── types/index.ts
```

---

## Frontend Routes

| Path | Page | Notes |
|---|---|---|
| `/` | Dashboard | Expiring items widget, quick actions, recent activity |
| `/pantry` | Pantry | Browse/manage all items |
| `/scan` | Scan | Receipt OCR upload + review flow |
| `/chat` | Chat | AI assistant — recipe mode (`?mode=recipe`) or general |
| `/chat?mode=recipe` | Chat (recipe mode) | `/recipes` redirects here |
| `/profile` | Profile | User settings, dietary preferences |

---

## API Endpoints

```
GET  /health | /health/ai

# Pantry
GET|POST|PUT|DELETE  /pantry
GET  /pantry/expiring?days=3
PATCH /pantry/{id}/slot

# Scan (OCR + receipt parsing)
GET  /scan/ocr-status
POST /scan/preprocess
POST /scan/receipt            # OCR + AI parse (preprocess: bool, preprocess_mode: auto|light|aggressive)
POST /scan/confirm            # write confirmed items to DB

# Chat (intent router → LangGraph)
POST /v1/chat                 # intent: recipe-generate | pantry-add | cooking-question | saved-recipe-lookup
GET  /v1/chat/history
GET  /v1/chat/intents

# Ingest workflows (LangGraph)
POST /ingest/chat
POST /ingest/receipt
POST /ingest/product
POST /ingest/recipe

# Apply (proposal system)
POST /apply

# Recipes
POST /recipes/generate
GET  /recipes/suggestions

# Icons (Fluent emoji fallback)
GET  /api/icons/{name}

# Decorations (kitchen scene milestones)
GET  /decorations
GET  /decorations/milestone-check
POST /decorations

# Profile
GET|POST|PUT|DELETE  /profile
```

---

## Core Workflows

### Receipt Scanning
```
Upload image → (optional) preprocess → Tesseract OCR
→ AI parses items with confidence scores
→ ≥0.8 ready_to_add | 0.5–0.8 needs_review | <0.5 skipped
→ User reviews/edits → clicks "Add X Items"
→ POST /scan/confirm writes to DB
Nothing auto-adds without explicit user confirm.
```

### Chat Intent Routing (LangGraph)
```
POST /v1/chat → chat_ingest workflow
→ classify intent → route to sub-workflow:
  recipe-generate     → pantry-aware recipe suggestions (grounding workflow)
  pantry-add          → add items via chat
  cooking-question    → general AI cooking advice
  saved-recipe-lookup → query saved recipes
```

### Recipe Grounding Workflow (implemented Phase 2)
```
classify_intent → [recipe-generate]
  ↓
gather_pantry_context       # fetch items + expiring
  ↓
extract_constraints         # LLM: cuisine, time budget, dietary, skill level → RecipeConstraints
  ↓
score_and_rank              # deterministic: rank by expiry urgency + constraint match
  ↓
generate_grounded_response  # LLM with structured context, not raw pantry dump
```

### AI Provider Fallback
```python
AIManager.get_provider()  # returns first available: Gemini → Ollama
```

---

## Current State: Phase 2 Complete

**Done:**
- Phase 1: pantry CRUD, receipt scanning, recipe generation, Alembic migrations
- Phase 2: dashboard, chat + intent router, DOM kitchen scene, milestone decorations
- Recipe grounding workflow with constraint extraction + expiry-ranked scoring
- Chat UX: new chat button, markdown rendering, streaming, conversation history
- 304-entry USDA food catalog for category/emoji lookup
- 454+ tests passing, mypy strict clean, ruff clean, tsc clean

**Next: Phase 3 — Recipe Library + Multimodal Ingestion**
See `ROADMAP.md` for plan, open issues, and success criteria.

---

## Design System (Sanrio/Kawaii)

```css
--pastel-pink: #ffb5c5    --pastel-mint: #b5ead7    --pastel-lavender: #c9b5e8
--pastel-peach: #ffdab3   --pastel-coral: #ff9aa2   --cream-white: #fff9f5
--soft-charcoal: #4a4a4a
```

- Rounded corners everywhere (12–16px), pill buttons (border-radius: 999px)
- Emoji-driven UI, mobile-first (max-width 480px)
- Nunito/Quicksand fonts
- Framer Motion for transitions

---

## Dev Guidelines

**Python:**
- `ruff` (line length 100), `mypy` strict, `pytest` for tests
- Type hints on all public functions
- `raise ... from e` to preserve stack traces
- Never bare `except:` — always specify exception type
- All AI calls through `AIManager`, never direct SDK calls
- All DB access through `repository/sqlite.py`
- Business logic in `services/` or `workflows/`, routes stay thin

**TypeScript:**
- Strict mode, functional components + hooks only
- Tailwind only (no custom CSS files)
- React Query for server state, Zustand for client state
- All API calls through `web/src/api/client.ts`

---

## Working with Claude Code

**Session orientation:** Read `ROADMAP.md` for current phase + open issues. `MEMORY.md` is auto-loaded each session with accumulated context.

**For non-trivial features:**
1. Triage — read the relevant code, identify files affected
2. Describe the goal; Claude enters plan mode → approve the plan
3. Agent team implements in parallel: `pm` coordinates, `dev1` (backend), `dev2` (frontend), `designer` (UX QA)
4. Run quality gates before committing: `pytest`, `mypy --strict`, `ruff`, `tsc --noEmit`

**For spec-driven autonomous work:**
- Write a thorough design doc in `docs/plans/` with clear acceptance criteria per task
- Tell Claude: *"Implement the spec at docs/plans/my-feature.md autonomously"*
- Agents read the spec, implement, run gates, mark tasks done — no back-and-forth
- Review the diff and commit

**Autonomous improvement loop:**
```
"Run pytest + mypy + ruff + tsc. Fix any failures. Keep going until all green."
```

**Persistent memory:** Key decisions and lessons live in `.claude/agent-memory/` (auto-loaded via `MEMORY.md`). At session end: *"save a handoff note to memory"*

See `docs/WORKFLOW.md` for the full workflow reference.

---

## Environment Variables

```bash
BUBBLY_GEMINI_API_KEY=...                        # required
BUBBLY_OLLAMA_BASE_URL=...                       # optional, default: http://localhost:11434
BUBBLY_DATABASE_URL=sqlite+aiosqlite:///./bubbly_chef.db
BUBBLY_AUTO_ADD_CONFIDENCE_THRESHOLD=0.8
BUBBLY_REVIEW_CONFIDENCE_THRESHOLD=0.5
BUBBLY_CORS_ORIGINS=["http://localhost:5173"]
```

---

## Known Limitations / Tech Debt

- No unit conversion (can't deduct "3 eggs" from "1 dozen eggs") — issue #6
- Single-user, no auth
- Receipt quality dependent on image quality
- No rate limiting on AI provider calls — issue #8
- Pagination missing from pantry list endpoint — issue #5
- iOS Safari bottom nav bug — issue #4

---

*Last updated: 2026-03-31*
