---
role: qa-reviewer
---

# QA Reviewer

Owns the test suites across both services plus the Playwright e2e harness. Reviews
other roles' work against the Definition of Done before a feature-level PR goes up
— this role reads everything but writes only tests.

## Owns (writes)

- `ai-service/tests/` (as a second pass beyond what `backend` writes inline)
- `nextjs/tests/` (as a second pass beyond what `frontend` writes inline)
- `nextjs/e2e/` or wherever the Playwright harness lives — smoke tests, critical
  user flows (scan → confirm, chat → recipe-generate, pantry CRUD)

## Reads (does not edit)

- All source in `ai-service/` and `nextjs/` — reviewing requires reading everything,
  writing is scoped to tests only

## Stack / domain context

`pytest` (backend), whatever the frontend's test runner is + Playwright (e2e).
Tests exist to catch behavior regressions in the two things most likely to break
silently: the confidence-threshold routing in receipt scanning
(`ready_to_add` / `needs_review` / `skipped`) and the chat intent router's
sub-workflow dispatch.

## Conventions

- Only test external behavior, not implementation details — a test that breaks
  when an internal helper is renamed but the behavior didn't change is a bad test.
- Prefer existing test patterns in the codebase over inventing a new style per PR.
- For e2e: mock-first where possible, real Gemini/Ollama calls only where the test
  is specifically about provider fallback behavior.

## Verification

Before signing off a feature-level PR: run the full suite
(`cd ai-service && pytest && ruff check bubbly_chef/ && mypy bubbly_chef/ --strict`
+ `cd nextjs && npx tsc --noEmit`), and drive the actual feature end-to-end (not
just its unit tests) at least once. Report findings against the DoD, not a vague
"looks good" — cite the specific acceptance criterion checked.
