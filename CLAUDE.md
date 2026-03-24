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
| Database | SQLite (aiosqlite, async) |
| AI | Gemini API (free tier) + Ollama (self-hosted fallback) |
| AI Orchestration | LangGraph workflows (chat, receipt, product, recipe ingest) |
| OCR | Tesseract |
| State (frontend) | Zustand (client) + React Query (server state) |
| Styling | Tailwind CSS v4 + Framer Motion |
| Version | 0.1.0 — Phase 2 in progress (Dashboard + Chat + Kitchen Scene) |

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
│                            #            product_ingest.py, recipe_ingest.py, state.py
├── tools/                   # llm_client.py, expiry.py, normalizer.py, product_lookup.py
├── services/                # ocr.py, receipt_parser.py, image_preprocessor.py
├── domain/                  # normalizer.py, expiry.py, defaults.py, icon_map.py
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
  recipe-generate     → pantry-aware recipe suggestions
  pantry-add          → add items via chat
  cooking-question    → general AI cooking advice
  saved-recipe-lookup → query saved recipes
```

### AI Provider Fallback
```python
AIManager.get_provider()  # returns first available: Gemini → Ollama
```

---

## Current Phase: 2 — Dashboard + Chat + Kitchen Scene

**What's done:**
- Phase 1 complete: pantry CRUD, receipt scanning, recipe generation
- Dashboard with expiring items widget, quick actions, recent activity
- Chat interface with LangGraph intent router (4 intents)
- DOM-based kitchen scene with drag-and-drop across zones (fridge/freezer/pantry/counter)
- Milestone progress bar + decoration unlock system
- Cross-zone drag with ghost preview and drop zone glow

**Phase 2 exit gates** (see `GOALS.md`):
- `pytest` passes, `mypy --strict` passes, `ruff` clean, `tsc --noEmit` passes
- Dashboard renders expiring widget + real DB activity (not hardcoded)
- Chat UI routes work, intent classification correct
- 80% coverage on core modules

**Next phases** (see `GOALS.md`):
- Phase K1: Fluent Emoji icon system
- Phase K2: Phaser kitchen game scene (depends on K1)
- Phase 3: Recipe Library + multimodal ingestion (URL, TikTok, YouTube)
- Phase 4: Mobile PWA

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

**Workflow:**
- Use `/rpi "goal"` for features — full research → plan → implement → validate cycle
- Use `/vibe recent` before committing
- Use `/status` to orient at session start
- Run `ao goals measure` to check phase fitness gates

---

## Agentic Team Workflow

**When the user reports an issue or requests a feature:**

1. **Triage** — Claude reads the issue, gathers just enough context to describe it clearly (what's broken, what's wanted, which files are likely involved)
2. **Create a PM task** — Spawn a `pm` agent via the Agent tool with the triage summary. The PM will:
   - Research the codebase in depth
   - Write a detailed implementation plan (what to change, file-by-file)
   - Spawn `dev1`, `dev2`, and/or `designer` agents as needed
   - Coordinate implementation and verify completion
3. **Claude stays as coordinator** — Claude monitors the team, answers questions, and relays final results to the user

**Agent roles:**
- `pm` — Plans, decomposes, coordinates. Reads codebase + spawns devs. Owns the task list.
- `dev1` — Backend/Python: FastAPI routes, services, workflows, repository, domain
- `dev2` — Frontend/TypeScript: React pages, components, Tailwind, client hooks
- `designer` — UX QA, dark mode review, visual consistency checks

**DO NOT** implement features directly when the user reports an issue — always triage → PM → agent team unless the fix is a single-line change.

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

- No unit conversion (can't deduct "3 eggs" from "1 dozen eggs")
- Single-user, no auth
- SQLite only (no migrations — Alembic needed before Phase 3)
- Receipt quality dependent on image quality
- No rate limiting on AI provider calls
- Pagination missing from pantry list endpoint

---

## AgentOps

Knowledge compounds via `.agents/`. Prior research, plans, learnings, and handoffs are all there.

```bash
ao lookup --query "topic"   # search past learnings
ao metrics health           # flywheel health
ao goals measure            # check fitness gates
/status                     # orient at session start
/rpi "goal"                 # start a new feature
/vibe                       # validate before committing
/handoff                    # save state at session end
```

---

*Last updated: 2026-03-23*
