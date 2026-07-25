# BubblyChef — AI Assistant Context

**A Sanrio-inspired pantry + recipe assistant. Scan receipts, manage pantry, generate AI recipes, chat about cooking, and visualize your kitchen.**

---

## Quick Start

```bash
# Frontend (http://localhost:3000)
cd nextjs && npm run dev

# AI microservice (http://localhost:8888)
cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888

# Tests (AI microservice)
cd ai-service && pytest
cd ai-service && ruff check bubbly_chef/
cd ai-service && mypy bubbly_chef/ --strict

# TypeScript check
cd nextjs && npx tsc --noEmit
```

---

## Stack

| Layer | Tech |
|---|---|
| Frontend + CRUD | Next.js 14 (App Router), React, TypeScript, Tailwind CSS v4 (port 3000) |
| Auth + Database | Supabase (Postgres 15 + Row Level Security) |
| AI Microservice | FastAPI + LangGraph + Gemini API + Ollama fallback (port 8888) |
| State (frontend) | React Query (server state), Zustand (client state) |
| Styling | Tailwind CSS v4 + Framer Motion, Nunito font |
| Deployment | Vercel (frontend) + Railway (AI microservice) |

---

## Architecture

```
Browser
  │
  ├── Next.js API routes (/api/*)    →  Supabase Postgres (RLS per user)
  │   pantry, recipes, profile,
  │   decorations, foods
  │
  └── AI Microservice (port 8888)   →  Supabase (service_role key)
      chat, scan, recipe generation
      LangGraph workflows
      Gemini → Ollama fallback
      Gemini Vision OCR (receipt scanning)
```

**Key patterns:**
- **CRUD vs. AI, with a proxy exception** — CRUD always goes through Next.js routes (same-origin). Most AI ops (recipe generate/refine/cook + cook/confirm, scan, apply) go through Next.js proxy routes under `nextjs/src/app/api/ai/*`, which forward the user's Supabase JWT server-side via `lib/api/ai-proxy.ts` (`aiProxyFetch`/`aiProxyJson`) to the FastAPI microservice. Only chat streaming (`/v1/chat/stream`) still goes direct from browser to the AI microservice, to avoid Vercel's serverless timeout on SSE.
- **AI Provider Abstraction** — `AIManager` picks first available provider. Never call Gemini SDK directly.
- **Repository Pattern** — All DB access via `SupabaseRepository` in `ai-service/`. Every method takes `user_id` as first param.
- **LangGraph Workflows** — Complex multi-step AI ops live in `ai-service/bubbly_chef/workflows/`, not in routes.
- **Proposal pattern** — AI workflows return `ProposalEnvelope` with confidence scores. Nothing writes to DB without user confirmation.
- **React Query** — Server state only. Avoid `useState` for fetched data.
- **Structured AI output** — Always use Pydantic response schemas, never parse raw strings.

---

## Project Structure

```
BubblyChef/
├── nextjs/                          # Next.js app (frontend + CRUD API)
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # Root layout
│       │   ├── page.tsx             # Dashboard
│       │   ├── login/page.tsx       # Auth (sign in / sign up)
│       │   ├── recipes/page.tsx     # Recipe library
│       │   ├── pantry/page.tsx
│       │   ├── scan/page.tsx
│       │   ├── chat/page.tsx
│       │   └── api/                 # CRUD route handlers
│       │       ├── pantry/          # GET/POST, expiring/, [id]/, [id]/slot/
│       │       ├── recipes/         # GET/POST, [id]/
│       │       ├── profile/         # POST, [id]/, email/[email]/, username/[username]/
│       │       ├── decorations/     # GET
│       │       └── foods/search/    # GET
│       ├── components/              # React components
│       └── lib/
│           ├── supabase/            # client.ts, server.ts, middleware.ts
│           ├── api/client.ts        # API client + React Query hooks
│           ├── pantry-helpers.ts    # Computed fields (expiry, is_expired, etc.)
│           └── response-helpers.ts  # requireAuth(), errorResponse()
│
├── ai-service/                      # FastAPI AI microservice
│   └── bubbly_chef/
│       ├── main.py                  # FastAPI app (AI endpoints only)
│       ├── api/auth.py              # JWT validation (get_current_user_id)
│       ├── workflows/               # LangGraph: chat_ingest, receipt_ingest, recipe/nodes
│       ├── ai/                      # manager.py, gemini.py, ollama.py, provider.py
│       ├── services/                # ocr.py, receipt_parser.py, image_preprocessor.py
│       ├── domain/                  # normalizer.py, expiry.py, catalog.py (304 entries)
│       ├── models/                  # pantry.py, recipes.py, proposals.py
│       └── repository/supabase_repo.py  # SupabaseRepository (30+ methods, service_role)
│
├── supabase/migrations/             # SQL migrations (schema + RLS policies)
└── docs/                            # Architecture, setup, plans
```

---

## Frontend Routes

| Path | Page | Notes |
|---|---|---|
| `/` | Dashboard | Expiring items widget, quick actions |
| `/pantry` | Pantry | Browse/manage all items |
| `/scan` | Scan | Receipt OCR upload + review flow |
| `/recipes` | Recipe library | Search, save, edit, favourite |
| `/chat` | Chat | AI assistant — general or recipe mode |
| `/profile` | Profile | User settings, dietary preferences |
| `/login` | Auth | Sign in / sign up (Supabase) |

---

## API Endpoints

### Next.js CRUD routes (`/api/*`)

```
# Pantry
GET|POST          /api/pantry
GET               /api/pantry/expiring
GET|PUT|DELETE    /api/pantry/[id]
PATCH             /api/pantry/[id]/slot

# Recipes
GET|POST          /api/recipes
GET|PUT|DELETE    /api/recipes/[id]

# Profile
POST              /api/profile
GET|PUT|DELETE    /api/profile/[id]
GET               /api/profile/email/[email]
GET               /api/profile/username/[username]

# Misc
GET               /api/decorations
GET               /api/foods/search
```

### AI microservice routes (`http://localhost:8888`)

All AI routes live under `/v1/*` (`api/routes/*.py`, `APIRouter(prefix=...)`).
Non-streaming ones are also reachable through Next.js proxy routes at
`/api/ai/*` (see the CRUD-vs-AI pattern above) — chat streaming is the one
exception that stays direct browser → microservice.

```
GET   /health | /health/ai

# Chat (api/routes/chat.py, prefix /v1/chat)
POST  /v1/chat/stream               # SSE streaming chat (browser → microservice, direct)
POST  /v1/chat                      # Non-streaming fallback
GET   /v1/chat/history/{conversation_id}
GET   /v1/chat/sessions

# Scan (api/routes/scan.py, prefix /v1/scan)
POST  /v1/scan/receipt              # OCR + AI parse — proxied via /api/ai/scan

# Recipe generation (api/routes/recipes_ai.py, prefix /v1/recipes)
POST  /v1/recipes/generate          # proxied via /api/ai/recipes/generate
POST  /v1/recipes/refine            # proxied via /api/ai/recipes/refine
POST  /v1/recipes/cook              # match ingredients vs pantry — proxied via /api/ai/recipes/cook
POST  /v1/recipes/cook/confirm      # apply deductions — proxied via /api/ai/recipes/cook/confirm

# Ingest (api/routes/ingest.py, prefix /v1/ingest)
POST  /v1/ingest/recipe-url         # extract RecipeCard from a URL

# Apply proposal (api/routes/workflows.py, prefix /v1/workflows)
POST  /v1/workflows/apply           # human-reviewed proposal → DB — proxied via /api/ai/workflows/apply
```

---

## Core Workflows

### Receipt Scanning
```
POST /v1/scan/receipt (optional preprocess) → Gemini Vision OCR
→ AI parses items with confidence scores
→ ≥0.8 ready_to_add | 0.5–0.8 needs_review | <0.5 skipped
→ User reviews/edits → clicks "Add X Items"
→ POST /v1/workflows/apply (intent=pantry_update) writes to DB
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

### Recipe Grounding Workflow
```
classify_intent → [recipe-generate]
  ↓
gather_pantry_context       # fetch items + expiring
  ↓
extract_constraints         # LLM → RecipeConstraints (cuisine, time, dietary, skill)
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

## Current State

**Live at:** https://bubbly-chef.vercel.app

**Done:**
- Phase 1 + 2: pantry CRUD, receipt scanning, recipe generation, chat intent router, DOM kitchen scene, milestone decorations, 454+ tests
- Migration: Next.js + Supabase + FastAPI AI microservice (three-tier)
- Recipe library UI: save, search, edit, delete, favourite
- Phase 7: Deployed to Vercel + Railway; Gemini Vision OCR; all core features working in production

**Next:** See `ROADMAP.md` for open issues and upcoming work.

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

**Python (ai-service/):**
- `ruff` (line length 100), `mypy` strict, `pytest` for tests
- Type hints on all public functions
- `raise ... from e` to preserve stack traces
- Never bare `except:` — always specify exception type
- All AI calls through `AIManager`, never direct SDK calls
- All DB access through `ai-service/bubbly_chef/repository/supabase_repo.py`
- Business logic in `services/` or `workflows/`, routes stay thin

**TypeScript (nextjs/):**
- Strict mode, functional components + hooks only
- Tailwind only (no custom CSS files)
- React Query for server state, Zustand for client state
- All API calls through `nextjs/src/lib/api/client.ts`
- Every API route calls `requireAuth()` — never access DB without extracting user

---

## Working with Claude Code

**Session orientation:** Read `ROADMAP.md` for current phase + open issues.

**Full workflow reference:** See `WORKFLOW.md` at the repo root for the complete
process model (issue lifecycle, autonomy gate, layered review, orchestration
depth), and `docs/WORKFLOW.md` for BubblyChef's own operational quick-reference
(recovery commands, common failure patterns).

**Agent team:** `pm` (you, orchestrating) plus `backend`, `frontend`, `ui-ux`,
`qa-reviewer` — see `docs/agents/roles/` for each role's full mandate and
ownership boundary. PM delegates one level deep only — dev roles don't spawn
further subagents; see `WORKFLOW.md` §5.

**For non-trivial features:**
1. Triage — read the relevant code, identify files affected
2. Describe the goal; Claude enters plan mode → approve the plan
3. Agent team implements per role boundaries (`docs/agents/roles/`)
4. Run quality gates before committing: `cd ai-service && pytest && ruff check bubbly_chef/ && mypy bubbly_chef/ --strict` + `cd nextjs && npx tsc --noEmit`

**For larger initiatives:**
1. Explore + plan mode → design in `docs/plans/`
2. `/wayfinder` (idea, size unknown) or `/to-spec` (idea already shaped) → publishes a spec as a GitHub Issue
3. `/to-tickets` → breaks the spec into vertical-slice child issues
4. Implement each issue independently

**For spec-driven autonomous work:**
- Write a design doc in `docs/plans/` with clear acceptance criteria
- Tell Claude: *"Implement the spec at docs/plans/my-feature.md autonomously"*

**Plan storage:** When creating plans (plan mode, architecture investigations, design docs), save them to `docs/plans/` with a date prefix (`YYYY-MM-DD-topic.md`). This keeps plans visible in the project alongside the code they describe.

**Branch naming (going forward):** `feat/issue-<n>-<slug>` / `fix/issue-<n>-<slug>`,
merged with real merge commits — this is already the dominant pattern in the repo.
Two other schemes (hash-suffixed, `ui-wN-*`) exist on older branches; don't
bulk-rename them, just use the convention above for anything new. See `WORKFLOW.md`
§4.

---

## Environment Variables

### nextjs/.env.local
```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_AI_SERVICE_URL=http://localhost:8888
```

### ai-service/.env
```bash
BUBBLY_SUPABASE_URL=...
BUBBLY_SUPABASE_SECRET_KEY=...
BUBBLY_SUPABASE_JWT_SECRET=...
BUBBLY_GEMINI_API_KEY=...
BUBBLY_OLLAMA_BASE_URL=http://localhost:11434   # optional
BUBBLY_AUTO_ADD_CONFIDENCE_THRESHOLD=0.8
BUBBLY_REVIEW_CONFIDENCE_THRESHOLD=0.5
BUBBLY_CORS_ORIGINS=["http://localhost:3000"]
```

---

## Known Limitations / Tech Debt

- No rate limiting on AI provider calls — issue #8
- Pagination missing from pantry list — issue #5
- No unit conversion (can't deduct "3 eggs" from "1 dozen eggs") — issue #6
- iOS Safari bottom nav bug — issue #4
- Recipe generation ignores constraint modifications from chat follow-up — BubblyChef-747

---

## Agent skills

**Installed skills live in `.claude/skills/`, committed to the repo** — so they work
in a fresh clone, in CI, and in cloud sessions, not just on a configured laptop.
27 skills vendored — 19 from `mattpocock/skills`, 8 from `cursor/plugins`.
`skills-lock.json` records each upstream commit and per-skill hashes for drift
detection. See `WORKFLOW.md` §9.

Most-used: `/implement` (build from a ticket — wraps `tdd` + `code-review`),
`/to-spec` → `/to-tickets` (plan), `/triage` (label state machine),
`/wayfinder` (chart unknown-shaped work), `/diagnosing-bugs`, `/handoff`.

### Issue tracker

Issues are tracked in GitHub Issues at https://github.com/ayushb3/BubblyChef. See `docs/agents/issue-tracker.md`.

### Triage labels

Default mattpocock vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` at repo root, `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.

### Agent roles

`pm`, `backend`, `frontend`, `ui-ux`, `qa-reviewer` — one file per role under
`docs/agents/roles/`, committed (not gitignored). See `docs/agents/roles/pm.md`
for the orchestration mandate and `docs/agents/roles/_role-template.md` for how to
add a new one.

### Review

`/code-review` on every PR; `/interrogate` before merging a feature-level PR;
`thermo-nuclear-code-quality-review` fires automatically as a `PreToolUse` hook at
`gh pr create`/`gh pr merge` time. See `WORKFLOW.md` §7.

---

*Last updated: 2026-07-11*


## Issue Tracking

Issues are tracked in **GitHub Issues** at https://github.com/ayushb3/BubblyChef/issues.

```bash
gh issue list                        # See open issues
gh issue view <number>               # View issue details
gh issue create --title "..." --body "..."  # File a new issue
gh issue close <number>              # Close an issue
```

## Session Completion

**When ending a work session**, work is NOT complete until `git push` succeeds.

1. **File issues** for any remaining work via `gh issue create`
2. **Run quality gates** (if code changed) — tests, linters, type check
3. **Commit and push:**
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
