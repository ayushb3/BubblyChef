# Goals

> AgentOps objective function. `/evolve` measures fitness against these gates.

## North Stars

- Users can ask "what can I make tonight?" and get pantry-grounded recipe suggestions
- Scanning a receipt takes < 30 seconds from photo to pantry update
- No wasted food — expiring items always surfaced prominently

## Anti Stars

- Untested changes reaching main
- Business logic leaking into API routes
- AI calls outside AIManager abstraction
- Features that require paid API keys

## Directives

### 1. Fix chat UX regressions

Resolve issues #12 (stub bubble), #13 (streaming speed), #14 (new chat button) — these block core chat quality

**Steer:** increase

### 2. Improve recipe suggestion quality

Implement grounding workflow (#16): constraint extraction, expiry-ranked pantry scoring, structured generation context

**Steer:** increase

### 3. Phase 3 DB foundation

Alembic migrations (#7), pagination (#5), rate limiting (#8) — blockers before any Phase 3 schema work

**Steer:** increase

## Gates

| ID | Check | Weight | Description |
|----|-------|--------|-------------|
| lint | `ruff check bubbly_chef/` | 3 | ruff check bubbly_chef/ clean |
| type-check | `mypy bubbly_chef/ --strict 2>&1 \| tail -1 \| grep -q Success` | 3 | mypy --strict passes with no errors |
| frontend-types | `cd web && npx tsc --noEmit` | 2 | TypeScript compiles with no errors |
| python-tests | `pytest --tb=no -q 2>&1 \| tail -1 \| grep -qv failed` | 5 | All Python tests pass (tracks issues #1 #3 — 2 known failures) |
| chat-streaming-quality | `grep -qE 'throttle\|delay\|sleep' web/src/api/client.ts` | 2 | Streaming token throttle implemented (issue #13) |
| chat-no-stub-bubble | `grep -qE 'handleNewChat\|newChat\|isStreaming' web/src/pages/Chat.tsx` | 2 | Duplicate stub bubble fixed (issue #12) |
| chat-new-button | `grep -qE 'handleNewChat\|newChat' web/src/pages/Chat.tsx` | 1 | New chat button exists (issue #14) |
| chat-markdown | `grep -qE 'react-markdown\|ReactMarkdown' web/src/pages/Chat.tsx` | 2 | Markdown rendering in chat (issue #9) |
| recipe-grounding | `grep -q 'extract_constraints\|score_and_rank\|RecipeConstraints' bubbly_chef/workflows/chat_ingest.py` | 4 | Recipe grounding workflow implemented (issue #16) |
| recipe-crud | `pytest tests/ -k recipe_crud --tb=no -q 2>&1 \| grep -qv 'no tests ran\|error'` | 4 | Recipe CRUD end-to-end (Phase 3) |
| url-ingest | `pytest tests/ -k url_ingest --tb=no -q 2>&1 \| grep -qv 'no tests ran\|error'` | 4 | URL → recipe card (Phase 3) |
| alembic-migrations | `test -f alembic.ini && alembic current 2>&1 \| grep -qv error` | 3 | Alembic migrations in place (issue #7) |
