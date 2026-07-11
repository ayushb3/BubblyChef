---
role: backend
---

# Backend

Owns the FastAPI + LangGraph AI microservice — chat, receipt scanning, recipe
generation, and everything that talks to an AI provider or writes to Supabase via
the service-role key.

## Owns (writes)

- `ai-service/bubbly_chef/main.py` — FastAPI app, AI endpoints only
- `ai-service/bubbly_chef/api/` — auth (JWT validation via `get_current_user_id`)
- `ai-service/bubbly_chef/workflows/` — LangGraph workflows (`chat_ingest`,
  `receipt_ingest`, `recipe/nodes`)
- `ai-service/bubbly_chef/ai/` — provider abstraction (`manager.py`, `gemini.py`,
  `ollama.py`, `provider.py`)
- `ai-service/bubbly_chef/services/` — OCR, receipt parsing, image preprocessing
- `ai-service/bubbly_chef/domain/` — normalizer, expiry logic, food catalog
- `ai-service/bubbly_chef/models/` — Pydantic models (pantry, recipes, proposals)
- `ai-service/bubbly_chef/repository/supabase_repo.py` — all DB access, service_role key
- `ai-service/tests/`

## Reads (does not edit)

- `nextjs/src/lib/api/client.ts` — the contract the frontend calls against; read to
  keep response shapes in sync, don't edit
- `supabase/migrations/` — schema/RLS policies; propose new migrations for the PM
  to freeze, don't apply schema changes unilaterally

## Stack / domain context

FastAPI + LangGraph + Gemini API (Ollama fallback), port 8888. Non-obvious
constraints that are load-bearing, not stylistic:

- **AI Provider Abstraction** — `AIManager` picks the first available provider.
  Never call the Gemini SDK directly from a workflow or route.
- **Repository Pattern** — all DB access goes through `SupabaseRepository`. Every
  method takes `user_id` as its first param.
- **LangGraph workflows** — complex multi-step AI ops live in `workflows/`, not
  inlined in routes.
- **Proposal pattern** — AI workflows return `ProposalEnvelope` with confidence
  scores. Nothing writes to the DB without explicit user confirmation via `/apply`.
- **Structured output** — always a Pydantic response schema, never a parsed raw
  string from the model.

## Conventions

- `ruff` (line length 100), `mypy --strict`, `pytest` — all three must pass before
  reporting done.
- Type hints on all public functions.
- `raise ... from e` to preserve stack traces; never a bare `except:`.
- Business logic lives in `services/` or `workflows/` — routes stay thin.

## Verification

Run `pytest`, `ruff check bubbly_chef/`, `mypy bubbly_chef/ --strict` — all green.
For anything touching a workflow or the confidence-threshold logic, exercise the
actual endpoint (`curl` or the AI service's own test client) rather than trusting
unit tests alone; the proposal/confidence-threshold behavior is exactly the kind of
thing that passes a mocked unit test while being wrong end-to-end.
