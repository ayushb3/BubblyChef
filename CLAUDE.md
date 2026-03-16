# BubblyChef — AI Assistant Context

**A Sanrio-inspired pantry + recipe assistant. Scan receipts, manage pantry, generate AI recipes.**

---

## Quick Start

```bash
uvicorn bubbly_chef.api.app:app --reload --port 8888   # backend
cd web && npm run dev                                   # frontend → http://localhost:5173
pytest                                                  # tests
ruff check bubbly_chef/                                 # lint
```

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12 + FastAPI (port 8888) |
| Frontend | React 18 + TypeScript + Vite (port 5173) |
| Database | SQLite (aiosqlite) |
| AI | Gemini API (free tier) + Ollama (self-hosted fallback) |
| OCR | Tesseract |
| Version | 0.2.0 — Phase 1C complete (Recipe Generation) |

---

## Architecture

```
Frontend (React + TypeScript)
    └── React Query + Fetch → HTTP/REST
Backend (FastAPI)
    └── Routes (thin) → Services (business logic) → Repository (SQLite)
                     → AI Manager → GeminiProvider | OllamaProvider
                     → Domain (normalize, expiry, defaults)
                     → OCR Service (Tesseract)
```

**Key patterns:**
- **AI Provider Abstraction** — `AIManager` picks first available provider. Never call Gemini SDK directly.
- **Repository Pattern** — All DB access via `SQLiteRepository`. All methods are `async/await`.
- **Services layer** — Business logic lives in `services/`, routes stay thin.
- **React Query** — Server state only. Avoid `useState` for fetched data.
- **Structured AI output** — Always use Pydantic response schemas, never parse raw strings.

---

## Project Structure

```
bubbly_chef/
├── api/routes/          # pantry.py, scan.py, recipes.py, profile.py, health.py
├── ai/                  # provider.py, manager.py, gemini.py, ollama.py
├── domain/              # normalizer.py, expiry.py, defaults.py
├── services/            # ocr.py, receipt_parser.py, image_preprocessor.py
├── models/              # pantry.py, user.py
├── repository/          # base.py, sqlite.py
├── config.py
└── logger.py

web/src/
├── api/client.ts        # API client + React Query hooks
├── pages/               # Dashboard, Pantry, Scan, Recipes, Profile
├── components/
└── types/index.ts
```

---

## Core Workflows

### Auto-categorization
```
User adds "milk" → normalize → detect_category → get_default_location → estimate_expiry_days
```

### Receipt Scanning Flow
1. Upload image → (optional) preprocess for OCR quality
2. Tesseract OCR → AI parses items with confidence scores
3. Split: ≥0.8 ready_to_add | 0.5-0.8 needs_review | <0.5 skipped
4. User reviews/edits all sections → clicks "Add X Items"
5. All selected items written to DB at once (**nothing auto-adds without user confirm**)

### AI Provider Fallback
```python
AIManager.get_provider()  # returns first available: Gemini → Ollama
```

---

## API Endpoints

```
GET  /health | /health/ai
GET|POST|PUT|DELETE  /api/pantry
GET  /api/pantry/expiring?days=3
GET  /api/scan/ocr-status
POST /api/scan/preprocess         # image preprocessing only
POST /api/scan/receipt            # OCR + AI parse (preprocess: bool, preprocess_mode: auto|light|aggressive)
POST /api/scan/confirm            # write confirmed items to DB
POST /api/recipes/generate
GET  /api/recipes/suggestions
GET|POST|PUT|DELETE  /api/profile
```

---

## Design System (Sanrio/Kawaii)

```css
--pastel-pink: #ffb5c5    --pastel-mint: #b5ead7    --pastel-lavender: #c9b5e8
--pastel-peach: #ffdab3   --pastel-coral: #ff9aa2   --cream-white: #fff9f5
--soft-charcoal: #4a4a4a
```

- Rounded corners everywhere (12-16px), pill buttons (999px)
- Emoji-driven UI, mobile-first (max-width 480px)
- Nunito/Quicksand fonts

---

## Dev Guidelines

**Python:**
- `ruff` (line length 100), `mypy` strict, `pytest` for tests
- Type hints on all public functions
- `raise ... from e` to preserve stack traces
- Never bare `except:` — always specify exception type

**TypeScript:**
- Strict mode, functional components + hooks
- Tailwind only (no custom CSS)
- React Query for server state

**Workflow:**
- Use `/rpi "goal"` for features — full research → plan → implement → validate cycle
- Use `/vibe recent` before committing
- Use `/status` to orient at session start

---

## Environment Variables

```bash
BUBBLY_GEMINI_API_KEY=...            # required
BUBBLY_OLLAMA_BASE_URL=...           # optional
BUBBLY_DATABASE_URL=sqlite+aiosqlite:///./bubbly_chef.db
BUBBLY_AUTO_ADD_CONFIDENCE_THRESHOLD=0.8
BUBBLY_REVIEW_CONFIDENCE_THRESHOLD=0.5
BUBBLY_CORS_ORIGINS=["http://localhost:5173"]
```

---

## Known Limitations

- No unit conversion (can't deduct "3 eggs" from "1 dozen eggs")
- Single-user, no auth
- SQLite only
- Receipt quality dependent on image quality

---

## Current Phase: 1C Complete → Next: Phase 2 (Dashboard + Chat)

See `docs/ROADMAP.md` for product vision. See `GOALS.md` for fitness gates. See `docs/AGENTOPS.md` for workflow commands.

---

## AgentOps

Knowledge compounds automatically via `.agents/`. Use `/status` to orient, `/rpi "goal"` to start work.

```bash
ao lookup --query "topic"   # search past learnings
ao metrics health           # flywheel health
ao goals measure            # check fitness gates
```

*Last Updated: 2026-03-16*
