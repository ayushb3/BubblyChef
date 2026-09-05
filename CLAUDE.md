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
| Frontend + CRUD | Next.js 16 (App Router), React, TypeScript, Tailwind CSS v4 (port 3000) |
| Auth + Database | Supabase (Postgres 15 + Row Level Security) |
| AI Microservice | FastAPI + LangGraph + Gemini API + Ollama fallback (port 8888) |
| State (frontend) | React Query (server state), React hooks/context (client state) |
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
- **Two API surfaces** — CRUD goes through Next.js routes (same-origin); AI ops go direct to microservice. Never mix.
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
│           ├── api/                 # per-domain clients: chat, pantry,
│           │                        #   recipes, scan, ai-proxy
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
│       ├── models/                  # base, cook, pantry, proposals, recipe,
│       │                            #   requests, session, user
│       └── repository/supabase_repo.py  # SupabaseRepository (30+ methods, service_role)
│
├── supabase/migrations/             # SQL migrations (schema + RLS policies)
├── bubbly_chef/                     # [LEGACY] Original monolith — reference only
└── docs/                            # Architecture, setup, plans
```

---

## Frontend Routes

| Path | Page | Notes |
|---|---|---|
| `/` | Dashboard | Expiring items widget, quick actions |
| `/pantry` | Pantry | Browse/manage all items |
| `/recipes` | Recipe library | Search, save, edit, favourite |
| `/chat` | Chat | AI assistant — general or recipe mode |
| `/profile` | Profile | User settings, dietary preferences |
| `/login` | Auth | Sign in / sign up (Supabase) |
| `/scan` | Scan | Receipt OCR upload + review flow |

Receipt scanning has two entry points that share the same review UI and the
same confirm semantics (nothing is written without an explicit confirm):
the full-page `/scan` route (`app/scan/page.tsx`) and the quick path inside
the pantry add sheet (`components/pantry/PantryAddSheet.tsx`, tabs `scan` and
`type`, reached as `/pantry?add=scan`). Both mount the presentation-only
`components/scan/ReviewSurface.tsx` for the tiered review; `ScanTab.tsx` still
owns the sheet's own upload/processing state machine, and `/scan` owns its own
(issue #259).

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

Every AI-service route sits under a `/v1` prefix except the health checks.

```
GET   /health | /health/ai

# Chat (LangGraph intent router)
POST  /v1/chat/stream                    # SSE — the path the UI actually uses
POST  /v1/chat                           # non-streaming fallback
GET   /v1/chat/history/{conversation_id}
GET   /v1/chat/sessions

# Scan (OCR + AI parse)
POST  /v1/scan/receipt

# Recipes (generation + cook/deduction)
POST  /v1/recipes/generate
POST  /v1/recipes/refine
POST  /v1/recipes/cook
POST  /v1/recipes/cook/confirm

# Pantry estimation helpers (called by the Next.js write paths)
POST  /v1/pantry/estimate-expiry
POST  /v1/pantry/estimate-category

# Unified ingest dispatcher (receipt + barcode + URL)
POST  /v1/ingest

# Apply proposal (human-reviewed → DB)
POST  /v1/workflows/apply
```

---

## Core Workflows

### Receipt Scanning
```
Upload image → (optional) preprocess → Gemini Vision OCR
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
- Phase 1 + 2: pantry CRUD, receipt scanning, recipe generation, chat intent router, 454+ tests
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
- React Query for server state; React hooks/context for client state (Zustand is NOT a dependency)
- All API calls through the per-domain clients in `nextjs/src/lib/api/`
  (`chat.ts`, `pantry.ts`, `recipes.ts`, `scan.ts`) — no ad hoc `fetch` in components
- Every API route calls `requireAuth()` — never access DB without extracting user

---

## Working with Claude Code

**Session orientation:** Read `ROADMAP.md` for current phase + open issues.

**Never cite a bare issue or PR number.** Every time you mention an issue or PR
in conversation — in a status table, a recommendation, a batch summary, a merge
suggestion — give a one-line summary of what it actually is alongside the number,
in plain language rather than the title verbatim. `#288` is useless on its own;
"#288 — brainstorming forces expiring fruit into savoury dishes" is reviewable
without leaving the terminal. For a PR, say what the change does and what it
affects, so a merge decision can be made from the message itself. This applies
however many you list: a table of ten issues gets ten summaries. The point is
that the human never has to open GitHub to follow what you're proposing.

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

**Linking issues in PRs — auto-close is by design.** Every PR that resolves an
issue must use a GitHub closing keyword in the **PR body**, one per issue, each
on its own line:

```markdown
Fixes #239
Fixes #240
Closes #241
```

Accepted keywords: `Fixes` / `Closes` / `Resolves` (GitHub treats them
identically). Rules that make this actually work:

- **One keyword per issue.** `Fixes #239, #240` only closes #239 — the second
  number is plain text. Comma-separated lists silently half-work.
- **The keyword must be in the PR body**, not the commit message alone, and not
  only in prose like "addresses the expiry bug (#239)". A bare `#239` links but
  never closes.
- **Only issues in the same repo** auto-close on merge to the default branch.
- **Partial fixes don't get a keyword.** If a PR only lands part of an issue,
  reference it *without* a keyword (`Related to #242`) and leave a comment
  saying what shipped and what remains — closing it would lose the rest.

Getting this wrong is a silent failure: #251 fixed six issues with the numbers
only in prose, so all six stayed open after merge and had to be closed by hand.
Prefer the keyword over manual closing — a merged PR should leave the tracker
correct with no follow-up step.

**The PR body is the review surface — write it as if the diff will not be read,
because it usually won't be.** The issue and the PR body get read; the diff does
not. So a body must let someone approve or reject without opening it: what changed
in plain behavioural language, before/after screenshots or a clip for anything
visual, what you actually verified and how (reproducing the original bug and
watching it stop is evidence; "tests pass" alone is not), and what the change
explicitly does *not* cover. An unstated gap reads as a claim it was handled.
Full rules in `WORKFLOW.md` §4.

**Review tiers are enforced by a hook, and they differ.** Opening a PR needs a
`/code-review` marker (agent-invocable). Merging needs a `thermo-nuclear-review`
marker — `main` auto-deploys, so every merge gets the deep pass; on a small fix
it's quick. See `WORKFLOW.md` §7.

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
BUBBLY_SUPABASE_SECRET_KEY=...          # NOT ..._SERVICE_ROLE_KEY — see note below
BUBBLY_SUPABASE_JWT_SECRET=...
BUBBLY_GEMINI_API_KEY=...
BUBBLY_GEMINI_MODEL=gemini-2.5-flash    # optional
BUBBLY_OLLAMA_BASE_URL=http://localhost:11434   # optional
BUBBLY_AUTO_ADD_CONFIDENCE_THRESHOLD=0.8
BUBBLY_REVIEW_CONFIDENCE_THRESHOLD=0.5
BUBBLY_CORS_ORIGINS=["http://localhost:3000"]
```

Every name here must match a field on `Settings` in `ai-service/bubbly_chef/config.py`
(prefix `BUBBLY_`). That model forbids extra keys, so a stray or misspelled
`BUBBLY_*` variable does not get ignored — the service dies at import with
`extra_forbidden`. The Next.js side uses `SUPABASE_SERVICE_ROLE_KEY`; the
ai-service field is `supabase_secret_key`, so the two halves of the stack spell
the same credential differently.

---

## Known Limitations / Tech Debt

- `mypy --strict` is listed as a quality gate below but reports 73 errors and is
  not run by CI — issue #128
- `tenacity` is imported by `tools/llm_client.py` but not declared in
  `ai-service/pyproject.toml`; it resolves transitively through langchain — issue #130
- Duplicate pantry rows under-report available stock in the cook flow — issue #127
- `ruff` is pinned `<0.16`; the newer default rule set reports 144 findings — issue #129
- No unit conversion (can't deduct "3 eggs" from "1 dozen eggs") — issue #6
- `mutating` state in RecipeBook — buttons not yet `disabled={mutating}`
- iOS Safari bottom nav bug — issue #4
- Recipe generation ignores constraint modifications from chat follow-up — BubblyChef-747
- The `decorations` table and `GET /api/decorations` exist, but nothing in
  `nextjs/src` consumes them and there is no kitchen-scene component — the
  milestone/decoration feature is a backend stub with no UI. The gamification
  and live-kitchen design that would build on it is held (high risk, medium
  value, not MVP) — see PR #124
- Chat can't be told to ignore the pantry, and the instruction is lost on the
  next turn — issue #287
- Expiring items are forced into every suggestion regardless of whether they
  suit the dish — issue #288
- Chat only ever proposes a single all-in-one dish; there is no notion of a
  meal with separate components — issue #289

---

## Agent skills

**Installed skills live in `.claude/skills/`, committed to the repo** — so they work
in a fresh clone, in CI, and in cloud sessions, not just on a configured laptop.
27 skills vendored — 19 from `mattpocock/skills`, 8 from `cursor/plugins`.
`skills-lock.json` records each upstream commit and per-skill hashes for drift
detection. See `WORKFLOW.md` §9.

Most-used: `/implement-issue` (this project's pickup skill — grab the next
`ready-for-agent` issue, branch, delegate, gate, open a draft PR),
`/implement` (build from a ticket — wraps `tdd` + `code-review`),
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
`thermo-nuclear-review` fires automatically as a `PreToolUse` hook when a PR is
about to be created or merged — via the `gh` CLI *or* the GitHub MCP tools. It is a
gate: the call is denied until the review is recorded for the current HEAD. Hook
script `.claude/hooks/pr-review-gate.sh`, registered in `.claude/settings.json`.
See `WORKFLOW.md` §7.

---

*Last updated: 2026-08-30*


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
