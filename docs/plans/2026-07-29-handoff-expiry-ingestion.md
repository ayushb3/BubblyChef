# Session Handoff — 2026-07-29 (expiry loop + live ingestion testing)

_Written with clean context for the next session. Supersedes nothing — this is a
fresh day's work following the 2026-07-28 demos handoff (#156). The through-line:
drove the app live with `playwright-cli`, which surfaced a major latent bug (#158),
fixed it end-to-end, and shipped the #155 context fix from the prior plan._

---

## TL;DR

- **Two PRs opened and verified this session, both against `main`:**
  - **#157** — #155 cook→chat context race (server-side recipe resolution).
  - **#159** — #158 default-expiry bug (the big one; found live, fixed end-to-end, verified).
- **The headline finding:** every pantry add (scan / manual / chat) was landing with
  `expiry_date: null`, so the entire expiry→cook→waste loop was **dead** — no badges,
  no "Cook this", nothing. This is why those features looked missing in the app. **#159
  fixes it and the loop is now visibly alive** (verified via live receipt scan).
- **Both bugs were found by *running the app*, not reading code** — the runtime write
  path differed from what the source suggested. Prefer live tracing for this codebase.

## Dev environment

- **Frontend on port 3100** (3000 is taken by the user's _ExperienceGeneration_ project):
  `cd nextjs && npm run dev -- -p 3100`.
- **AI service on 8888:** `cd ai-service && .venv/bin/uvicorn bubbly_chef.main:app --port 8888`.
  ⚠️ **It runs WITHOUT `--reload`** — you must restart it manually to pick up Python
  changes. This bit me: a code fix looked broken until I restarted the service. Command
  used: `pkill -f "uvicorn bubbly_chef.main"; (cd ai-service && .venv/bin/uvicorn bubbly_chef.main:app --port 8888 > /tmp/bubbly-ai-service.log 2>&1 &)`.
- Login: `test@bubbly.local` / `password`.
- **Python is `.venv/bin/python` / `.venv/bin/pytest` / `.venv/bin/ruff`** — bare `python`
  is not on PATH, and `cd ai-service` fails if the shell is already there (it silently was).

## ⚠️ Two-user gotcha (cost me time — know this)

There are **two Supabase auth users** with pantry data:
- `1136277c-9ee3-4fbc-a8c5-448d7a835237` — **the one the browser/app is logged in as** (`test@bubbly.local`). Operate on this one.
- `5e7f4c31-659d-41dc-a1d2-9fc58ee8f429` — a different account. Early in the prior session I set demo expiry dates on **this** user, which is a second reason the user never saw badges (wrong account entirely).

Always confirm which user the app is using before poking the DB. The app's own
`GET /api/pantry` (run in the browser via `page.evaluate(fetch)`) reveals `user_id`.

## Direct DB access (read + admin) — how

The ai-service `.env` holds `BUBBLY_SUPABASE_URL` + `BUBBLY_SUPABASE_SECRET_KEY` (note:
**SECRET_KEY**, the newer Supabase naming — NOT `SERVICE_ROLE_KEY`). Probe/mutate prod
via REST:
```bash
URL=$(grep '^BUBBLY_SUPABASE_URL=' ai-service/.env | cut -d= -f2- | tr -d '"'"'"'"')
KEY=$(grep '^BUBBLY_SUPABASE_SECRET_KEY=' ai-service/.env | cut -d= -f2- | tr -d '"'"'"'"')
curl -s "$URL/rest/v1/pantry_items?select=name,expiry_date&user_id=eq.<uid>" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
This is **live prod** (the app has no separate dev DB). Be deliberate with writes.

## PR #159 — #158 default-expiry fix (the main work)

**The bug:** all pantry adds produced `expiry_date: null`. The expiry heuristic
(`ai-service/bubbly_chef/tools/expiry.py`, `get_expiry_heuristics().estimate_expiry`)
existed and is the single source of truth, but **three write paths discarded it**:
1. `POST /api/pantry/bulk` — **scan-confirm + manual Type add** (the path the user hit).
2. `POST /api/pantry` — single manual add.
3. `SupabaseRepository.apply_pantry_proposal` (`supabase_repo.py`) — chat-add; hardcoded `expiry_date=None`.

**Key trap:** reading `scan.ts` suggested confirm went through `/v1/workflows/apply` →
`apply_pantry_proposal`. **It does not.** Runtime logs showed the confirm button
(`PantryAddSheet.handleConfirm`) posts to **`/api/pantry/bulk`** (a Next.js CRUD route,
direct Supabase insert). Always verify the runtime path via ai-service logs.

**The fix (kept one heuristic, reused everywhere):**
- New ai-service endpoint `POST /v1/pantry/estimate-expiry` (`api/routes/pantry.py`)
  wraps the heuristic so the TS routes don't fork the table.
- Both Next.js routes call it via a new `estimateExpiry()` in `lib/api/ai-proxy.ts`
  when no date is supplied — **graceful null fallback on any error, never blocks an add**.
- `apply_pantry_proposal` now honours `action.expiry_date`, else estimates.

**Verified live:** cleared pantry → re-scanned `grocery-mart.png` → all 8 items got
sensible dates (chicken 2d, produce ~1wk, milk 10d, eggs ~3wk, pasta 1yr); pantry tiles
render badges + "Cook this"; manual "greek yogurt" add → 2026-08-12. Backend tests +
ruff + tsc clean (bar the 5 known e2e tsc errors). New test:
`tests/test_pantry_estimate_expiry.py`.

**Pantry state left populated** with 9 real ingested/estimated items on user
`1136277c` so the working loop is visible — NOT reset to empty.

## PR #157 — #155 cook→chat context race

Server-side recipe resolution from `?cooking=<id>`: frontend sends
`{cooking_recipe_id}` synchronously (no fetch race); backend resolves via
`repo.get_recipe` before pinning; legacy full-dict still accepted. Ingredient objects
now flatten to strings in `normalize_cooking_recipe`. 41 backend tests green + new
frontend `cooking-context.test.ts`. Full write-up in the PR.

## Open PRs (all → main)

| PR | What | Action |
|---|---|---|
| **#159** | #158 default-expiry fix — **verified live** | Review + merge. Then run a one-off backfill of any remaining null-expiry rows in prod (see plan doc). |
| **#157** | #155 cook→chat context race | Review + merge. Then re-record demo `02` (it demonstrated routing, not working context). |
| **#156** | This-day-minus-one handoff (demos) | Superseded context-wise by THIS doc; keep or close as you like. |
| **#154** | 5 demo videos | Merge, but annotate `02` re: #155 (or re-record after #157). |
| **#150** | DRAFT — expiry loop (#139/#140/#147) + lint gates. Adds migration `00007`. | Review + merge, then apply `00007` to prod. **Unblocks #146's "Toss it" half (#140).** |
| **#124** | DRAFT — gamification/live-kitchen plan | Defer until kitchen-hub epic prioritized. |

## Now-unblocked / next steps, in order

1. **Merge #159** (default expiry — the loop is dead without it).
2. **Merge #157** → re-record demo `02`.
3. **#146 gate fix** — now that items have dates, expired items visibly show the
   incoherent "Expired badge + Cook this". User's decision (confirmed this session):
   **don't offer "Cook this" on expired items; keep the Expired badge and add a
   "Toss it?" affordance.** One-line stop-gap: `pantry/page.tsx` `isUrgent` gate
   `days <= 3` → `days >= 0 && days <= 3`. The "Toss it?" strip depends on #140 (in
   draft #150). Mockup: `docs/plans/146-affordance-flow.html`.
4. **Backfill prod null-expiry rows** — one-off idempotent pass with the estimator.
5. **Live receipt-ingestion e2e test** — fixtures are committed at
   `nextjs/e2e/fixtures/receipts/{grocery-mart,city-harvest}.png`; Part 3 of the plan
   describes a stubbed CI test + opt-in live variant.
6. Minor: manual add doesn't auto-categorize (yogurt → "other" not "dairy").

## Plans / artifacts produced this session

- `docs/plans/2026-07-29-ingestion-e2e-and-default-expiry.md` — the full plan; **its
  root-cause section was corrected mid-session** after live tracing (the bug is at the
  shared bulk write path, not just manual add).
- `docs/plans/146-affordance-flow.html` — the real pantry-tile mockup (open in browser).
- Receipt fixtures (both committed on #159's branch).
- Issue **#158** filed with a comment correcting the runtime path.

## Carried-forward facts (still true)

- **Next.js 16** (App Router, Turbopack); read `nextjs/AGENTS.md` before Next code.
- **Zustand is NOT a dependency.** React hooks/context for client state; React Query for server.
- Quality gates: `cd ai-service && BUBBLY_RUN_LIVE_TESTS=0 .venv/bin/pytest && .venv/bin/ruff check bubbly_chef/`; `cd nextjs && npx tsc --noEmit`. **tsc reports 5 pre-existing `e2e/*` + `playwright.config.ts` errors (missing `@playwright/test`/`dotenv` types, from the #59 harness) — filter them out, they're not regressions.** Overlaps the other agent's widened #149 — don't double-fix.
- GitHub: repo is `ayushb3/BubblyChef` (public) — always `GH_HOST=github.com`.
- **playwright-cli quirk:** `run-code` return values sometimes don't surface as `### Result` with a large/animated modal open — screenshots + direct DB queries are the reliable signal. Session used: `playwright-cli -s=bubbly ...`. The playwright session's cwd was `ai-service/` this session (screenshots to explicit `/tmp/*.png` paths avoids confusion).
