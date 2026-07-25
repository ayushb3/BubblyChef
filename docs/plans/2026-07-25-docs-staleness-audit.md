# Docs Staleness Audit — 2026-07-25

Audit of documentation against the code as it stands on
`claude/project-status-gamification-cpn7rg` after the `feat/ui-overhaul` merge,
PR #121, the #119/#120 rewrites, and the CI/skills work. Every claim below was
checked against the actual source (file + line cited), not assumed from prior
docs. Read-only audit — no code or other docs were modified.

---

## Summary Table

| File | Severity | One-line issue |
|---|---|---|
| `CLAUDE.md` | CRITICAL | AI microservice endpoint list is almost entirely wrong — real routes live under `/v1/*` with different paths/names |
| `README.md` | CRITICAL | Stack + architecture diagram still say "Tesseract OCR"; Tesseract was removed, OCR is Gemini Vision only |
| `docs/ARCHITECTURE.md` | CRITICAL | Same Tesseract claim (4 places), plus stale directory tree (`bubbly_chef/`, `web/` legacy dirs no longer exist) |
| `README.md` / `CLAUDE.md` / `docs/ARCHITECTURE.md` | CRITICAL | All reference `bubbly_chef/` (legacy monolith) and/or `web/` (legacy Vite app) at repo root — neither directory exists anymore |
| `CLAUDE.md` | CRITICAL | "Two API surfaces, never mix" is now false — `nextjs/src/app/api/ai/*` proxy routes exist and call the AI microservice server-side |
| `MODEL-OPTIONS-SUMMARY.md` | CRITICAL | Confirmed bad as flagged — recommends `gemini-2.0-flash-exp`, claims Gemini 3.0 doesn't exist; code is pinned to `gemini-2.5-flash` |
| `CLAUDE.md` | CRITICAL | Known Limitations lists `mutating`/no-error-feedback in RecipeBook as open — both are fixed in code |
| `README.md` / `ai-service/.env.example` / `.env.example` / `docs/SUPABASE_SETUP.md` | CRITICAL | Documented env var `BUBBLY_SUPABASE_SERVICE_ROLE_KEY` doesn't match the field `config.py` actually reads (`BUBBLY_SUPABASE_SECRET_KEY`) — pre-existing, not part of this batch, but still live and misleading |
| `docs/MATTPOCOCK-SKILLS-GUIDE.md` | CRITICAL (recommend deletion) | Describes 12 skills under old/removed names (`to-prd`, `to-issues`, `zoom-out`, `diagnose`, `caveman`, `write-a-skill`); none of these slash commands exist in the vendored 27 |
| `ROADMAP.md` | MODERATE | Stamped 2026-05-02, "Phase 7 Complete" header omits everything since — PM is already rewriting this one |
| `CONTEXT.md` | MODERATE | `router.py` line count (1391) stale — actual is 1209; no mention of cook feature / `cook_matcher.py` / `CookProposal` at all |
| `CONTEXT.md` | MODERATE | References `docs/plans/2026-04-29-active-work-items.md` as the live "API routes" doc — that plan is a frozen, now-wrong snapshot |
| `docs/agents/issue-tracker.md` | MODERATE | Says skills `to-issues`, `to-prd`, `diagnose` interact with the tracker — all three are old names, current skills are `to-tickets`, `to-spec`, `diagnosing-bugs` |
| `docs/agents/triage-labels.md` | MODERATE | Same old-name issue: "used by `triage`, `to-issues`, `diagnose`" |
| `docs/README.md` | MODERATE | Describes `MATTPOCOCK-SKILLS-GUIDE.md` as "grill→PRD→issues→TDD" — perpetuates the old naming; tied to that file's fate |
| `docs/2026-04-08-architecture-old-vs-new.md` | MODERATE | "Migration Status (as of 2026-04-08)" table has 4 rows marked TODO that are long since done (all shipped per ROADMAP.md Phase 4-7) — historically fine as a dated snapshot but not in `docs/archive/`, easy to mistake for current |
| `docs/MIGRATION_SUMMARY.md` | MODERATE | "What's Remaining" (Phases 4/6/7 "NOT STARTED") is long superseded — same archive-candidate issue |
| `docs/SUPABASE_SETUP.md` | MODERATE | Mixes "Publishable key"/"Secret key" Supabase terminology with `BUBBLY_SUPABASE_SECRET_KEY`, inconsistent with the anon/service_role naming used everywhere else |
| `docs/design/v0-prompts.md` | MINOR | No factual claims about running code, just design prompts — still usable as-is |
| `nextjs/AGENTS.md` | MINOR (unverifiable) | Generic Next.js warning, no BubblyChef-specific claims to go stale |
| `docs/architecture/2026-03-30-workflow-diagrams.md`, `docs/architecture/2026-05-03-recipe-workflow.md` | MINOR | Chat-router internals (`workflows/router.py`, sub-graph shape) still match code structurally; only the line-count/date-adjacent details drift |

---

## CRITICAL — full detail

### 1. `CLAUDE.md` — AI microservice endpoint list (lines ~140–158)

**Claims:**
```
GET   /health | /health/ai
POST  /v1/chat
GET   /v1/chat/history
GET   /scan/ocr-status
POST  /scan/preprocess
POST  /scan/receipt
POST  /scan/confirm
POST  /recipes/generate
GET   /recipes/suggestions
POST  /ingest/chat | /ingest/receipt | /ingest/product | /ingest/recipe
POST  /apply
```

**Actual** (verified in `ai-service/bubbly_chef/main.py:83-87` and each router's
`APIRouter(prefix=...)` + `@router.get/post` decorators):

| Router file | Prefix | Actual paths |
|---|---|---|
| `api/routes/chat.py` | `/v1/chat` | `POST /v1/chat/stream`, `POST /v1/chat` (path `""`), `GET /v1/chat/history/{conversation_id}`, `GET /v1/chat/sessions` |
| `api/routes/scan.py` | `/v1/scan` | `POST /v1/scan/receipt` only |
| `api/routes/recipes_ai.py` | `/v1/recipes` | `POST /v1/recipes/generate`, `POST /v1/recipes/refine`, `POST /v1/recipes/cook`, `POST /v1/recipes/cook/confirm` |
| `api/routes/ingest.py` | `/v1/ingest` | `POST /v1/ingest/recipe-url` only |
| `api/routes/workflows.py` | `/v1/workflows` | `POST /v1/workflows/apply` |

`GET /health` and `GET /health/ai` (root-mounted, `main.py:64,68`) are the only
part of the documented list that's correct as-is.

Everything else is wrong: no bare `/scan/*`, `/recipes/*`, `/ingest/*`, or
`/apply` paths exist — they're all under `/v1/`. `/scan/ocr-status`,
`/scan/preprocess`, `/scan/confirm`, `/recipes/suggestions`, and three of the
four documented `/ingest/*` variants (`chat`, `product`, `recipe`) don't exist
at all — the real ingest router has exactly one endpoint, `/v1/ingest/recipe-url`.
Undocumented-but-real endpoints: `/v1/chat/sessions`, `/v1/recipes/refine`,
`/v1/recipes/cook`, `/v1/recipes/cook/confirm` (the new cook-a-recipe feature).

**Severity: CRITICAL** — anyone integrating against this list, including a
fresh agent session, will call endpoints that 404.

### 2. `README.md` and `docs/ARCHITECTURE.md` — Tesseract OCR claim

**Claims:** `README.md:25` ("FastAPI + LangGraph + Gemini API + Tesseract OCR"),
`README.md:101` (diagram: "Tesseract OCR"); `docs/ARCHITECTURE.md:18`
("Tesseract" in the box diagram), `:26` (stack table), `:80` ("Tesseract OCR"
comment), `:100` (diagram), `:108` (diagram), `:247` ("Receipt OCR |
`ai-service/` | Tesseract binary dependency").

**Actual:** `ai-service/bubbly_chef/services/ocr.py` defines only `GeminiOCR`
(Gemini Vision, "no system dependencies required" per its own docstring).
`ai-service/pyproject.toml` and `ai-service/Dockerfile` have no `pytesseract`/
`tesseract-ocr` dependency. `ROADMAP.md:90` and `CLAUDE.md` (Phase 7 note) both
already correctly say Tesseract was replaced with Gemini Vision during
deployment.

**Severity: CRITICAL** — this is directly contradicted by the project's own
`ROADMAP.md`, so it's not even a case of ambiguity; two of the audited files
are simply out of sync with a fact the third file already documents correctly.

### 3. `bubbly_chef/` and `web/` legacy directories no longer exist

**Claims:** `CLAUDE.md` project structure tree: `bubbly_chef/  # [LEGACY]
Original monolith — reference only`. `README.md:133`: same line. `docs/ARCHITECTURE.md:99-100`:
`bubbly_chef/  # [LEGACY] Original monolith (reference only)` and `web/ #
[LEGACY] Original Vite frontend (reference only)`.

**Actual:** confirmed via `ls` at repo root — neither `bubbly_chef/` nor `web/`
exists. Only `nextjs/`, `ai-service/`, `supabase/`, `docs/`, `scripts/` are
present at top level.

**Severity: CRITICAL** — someone told to check the legacy monolith "for
reference" will find nothing there; this should either be removed from the
tree diagrams or explicitly noted as deleted (with a pointer to the commit/tag
where it was removed, if that matters for archaeology).

### 4. `CLAUDE.md` — "Two API surfaces... Never mix" is now inconsistent with the code

**Claims:** `CLAUDE.md` Architecture section: "**Two API surfaces** — CRUD
goes through Next.js routes (same-origin); AI ops go direct to microservice.
Never mix." Same framing in `CONTEXT.md` ("API: Two surfaces... AI ops →
`http://localhost:8888`... direct browser calls for SSE").

**Actual:** `nextjs/src/app/api/ai/` now contains five route handlers that are
Next.js API routes proxying to the AI microservice:
`recipes/cook/route.ts`, `recipes/cook/confirm/route.ts`,
`recipes/generate/route.ts`, `recipes/refine/route.ts`, `scan/route.ts`,
`workflows/apply/route.ts`. `nextjs/src/lib/api/ai-proxy.ts` implements this
explicitly — its own docstring says "Chat streaming goes direct (browser → AI
service)... only non-streaming calls are proxied here." This is a real,
intentional pattern (server-side JWT forwarding for non-streaming AI ops), not
a bug — but it directly contradicts the "never mix" framing in both `CLAUDE.md`
and `CONTEXT.md`, which still describe a strict CRUD-vs-AI split with no
proxy layer. `docs/2026-04-08-architecture-old-vs-new.md:179-184` actually
already anticipated this exact pattern under "AI Non-streaming (scan, recipe
gen — future)" — it's just never been reconciled back into `CLAUDE.md`/`CONTEXT.md`.

**Severity: CRITICAL** — this is an architecture-level statement a dev role
would rely on when deciding where to add a new AI-touching feature.

### 5. `MODEL-OPTIONS-SUMMARY.md` — confirmed bad as flagged

Confirmed: recommends `gemini-2.0-flash-exp` (`:7,27`), claims "Gemini 3.0 —
Doesn't exist yet (Gemini 2.0 is latest)" (`:39`). Actual pinned model per
`ai-service/bubbly_chef/config.py:18` (`gemini_model: str = "gemini-2.5-flash"`)
and `ai-service/bubbly_chef/ai/gemini.py:30` (default param
`model: str = "gemini-2.5-flash"`). The doc is also undated relative to this
being provably wrong — 2.5-flash predates this batch entirely, so this file
has been stale for some time, not just since the recent merge.

**Severity: CRITICAL** — actively wrong technical recommendation; would send
someone backwards to an inferior/deprecated model.

### 6. `CLAUDE.md` Known Limitations — two items are already fixed

**Claims:** "`mutating` state in RecipeBook — buttons not yet
`disabled={mutating}`" and "No error feedback on failed recipe mutations."

**Actual:** `nextjs/src/components/recipes/RecipeBook.tsx` — `mutating` state
(`:76`) is wired to `disabled={mutating}` on at least 7 buttons (`:483, 496,
515, 607, 620, 639`) and `deleting={mutating}` (`:564, 689`). Error feedback
exists via `errorMessage` state (`:79`), surfaced in a dismissible banner
(`:696-712`, with `aria-label="Dismiss error"`).

**Severity: CRITICAL** in the sense that it actively misdirects — an agent
picking up "known tech debt" would spend time on something already done, or
worse, "fix" it a second time and introduce a conflicting implementation.

### 7. Supabase key env var name mismatch (pre-existing, not part of this batch)

**Claims:** `README.md`, `.env.example` (root), `ai-service/.env.example`, and
`docs/SUPABASE_SETUP.md` (partially) all document `BUBBLY_SUPABASE_SERVICE_ROLE_KEY`
as the AI microservice's Supabase key env var.

**Actual:** `ai-service/bubbly_chef/config.py:13` defines
`supabase_secret_key: str = ""` with `env_prefix = "BUBBLY_"` (`:43`) and no
alias — pydantic-settings will only populate this from an env var literally
named `BUBBLY_SUPABASE_SECRET_KEY`. Confirmed via `git blame` this field name
dates to the original migration commit (`4ba198e`, 2026-04-15) — it is not
something this batch touched. `repository/supabase_repo.py:43` reads
`settings.supabase_secret_key` directly, confirming the field (not just its
name) is what's live.

**Severity: CRITICAL** for anyone actually running setup from these docs —
following `.env.example` literally will leave `supabase_secret_key` empty and
the AI service will fail Supabase auth silently (empty-string default, no
validation). Flagging this even though it predates the current batch, per the
instruction to verify against code rather than assume; it's a real, current
mismatch. `docs/SUPABASE_SETUP.md:34` reasonably says `BUBBLY_SUPABASE_SECRET_KEY`
in one place then contradicts itself with `BUBBLY_SUPABASE_SERVICE_ROLE_KEY`
in the Step 6 code block (`:121`) — so even that file disagrees with itself.

### 8. `docs/MATTPOCOCK-SKILLS-GUIDE.md` — old skill names throughout

Describes 12 skills as the current toolkit: `/setup-matt-pocock-skills`,
`/grill-with-docs`, `/grill-me`, **`/to-prd`**, **`/to-issues`**, **`/zoom-out`**,
`/tdd`, **`/diagnose`**, `/improve-codebase-architecture`, `/triage`,
`/caveman`, `/write-a-skill`.

Checked against the actual vendored set (`.claude/skills/`, 27 entries,
confirmed by directory listing and `skills-lock.json`'s 19 mattpocock + 8
cursor/plugins split, matching `WORKFLOW.md` §9's count exactly):
- `to-prd` → renamed `to-spec` (present)
- `to-issues` → renamed `to-tickets` (present)
- `zoom-out` → renamed `wayfinder` (present)
- `diagnose` → renamed `diagnosing-bugs` (present)
- `caveman` and `write-a-skill` — not present at all under any name
- `setup-matt-pocock-skills`, `grill-with-docs`, `grill-me`, `tdd`,
  `improve-codebase-architecture`, `triage` — present, names unchanged

`WORKFLOW.md` §9.1 already documents these exact four renames as the reason
the old lockfile-only setup was broken — so the project has already fixed this
once in the doc-of-record and just never touched this guide.

**Recommendation: delete, don't patch.** `WORKFLOW.md` §9 (skill map table)
and §9.1 (rename history) already supersede this file's content more
accurately and more concisely. Patching four command names in place would
leave a second, redundant source of truth for the same information — the kind
of duplication `WORKFLOW.md` itself warns against. If any of the "Phase"
prose (grill → PRD → issues → TDD narrative arc) is worth keeping, fold the
useful bits into `WORKFLOW.md` §3 and delete this file rather than maintaining
both.

---

## MODERATE / MINOR

- **`ROADMAP.md`** (PM already rewriting — noting only, not exhaustive):
  `:21` "Phase 7 Complete" header predates the theme switcher, cook feature,
  6-gate CI, 27 vendored skills, and issue #125. `:101-105` tech debt table
  still lists the RecipeBook `mutating`/error-feedback items as open (see
  CRITICAL #6 above — same fix needed here).
- **`CONTEXT.md:89`** — "Router (router.py, 1391 lines)" is now 1209 lines
  (`wc -l ai-service/bubbly_chef/workflows/router.py`). Minor drift, but also:
  no mention anywhere in `CONTEXT.md` of the cook-a-recipe feature
  (`cook_matcher.py`, `models/cook.py`, `CookProposal`, `/v1/recipes/cook`) —
  a whole new domain concept absent from the domain glossary.
- **`CONTEXT.md:190`** — "API routes: `docs/plans/2026-04-29-active-work-items.md`
  (endpoints section)" points at a plan that describes `web/` as still
  existing and component migration as unstarted — both long since resolved.
  The plan itself is fine as a frozen historical snapshot (per
  `docs/agents/domain.md`'s own "Plans Are Frozen Snapshots" rule), the
  problem is `CONTEXT.md` citing it as the live reference for current
  endpoints, which it no longer is.
- **`docs/agents/issue-tracker.md:7`** and **`docs/agents/triage-labels.md:3`**
  — both say `to-issues`, `to-prd`, `diagnose` interact with the tracker/labels.
  Same rename issue as the skills guide (see CRITICAL #8) — current names are
  `to-tickets`, `to-spec`, `diagnosing-bugs`.
- **`docs/README.md:22`** — describes the skills guide as "grill→PRD→issues→TDD
  methodology," perpetuating the old naming; its fate should follow whatever
  happens to `MATTPOCOCK-SKILLS-GUIDE.md`.
- **`docs/2026-04-08-architecture-old-vs-new.md:188-199`** — "Migration Status
  (as of 2026-04-08)" table marks "Wire remaining AI endpoints," "Port UI
  components," "Next.js → AI proxy routes," "Deployment," and "CI/CD pipeline"
  as TODO — all done now per `ROADMAP.md`'s own Phase 4-7 completion notes.
  Reads fine as a dated snapshot but isn't under `docs/archive/`, so it's easy
  to open this expecting current status.
- **`docs/MIGRATION_SUMMARY.md:88-106`** — "What's Remaining" section
  (Phases 4/6/7 all "NOT STARTED") is the same kind of dated-snapshot risk —
  not itself wrong for 2026-04-02, but a reader unaware of the date could take
  it as current state.
- **`docs/SUPABASE_SETUP.md`** — internally inconsistent on the AI service's
  Supabase key env var name (`BUBBLY_SUPABASE_SECRET_KEY` at `:34` vs
  `BUBBLY_SUPABASE_SERVICE_ROLE_KEY` at `:121`); see CRITICAL #7 for the
  deeper issue this surfaces.

No `~/Code/.agents/skills/` or other local-home-directory references were
found in any audited doc except `WORKFLOW.md`'s own §9.1, which explicitly
describes that as the *old, broken* state being fixed (not a live
instruction) — so that one reference is intentional and accurate, not stale.

---

## Recommended deletions

1. **`docs/MATTPOCOCK-SKILLS-GUIDE.md`** — superseded by `WORKFLOW.md` §9/§9.1;
   describes 4 renamed and 2 no-longer-vendored skills under old names. Delete
   rather than patch (see CRITICAL #8 rationale).
2. **`MODEL-OPTIONS-SUMMARY.md`** — factually wrong about the current model
   landscape and about what's actually pinned in code; superseded by
   `CLAUDE.md`'s env var reference (`BUBBLY_GEMINI_MODEL`) and the code's own
   default. No unique content worth preserving.

Candidates for `docs/archive/` (not deletion — still useful as historical
record, just shouldn't sit alongside current docs implying currency):
- `docs/MIGRATION_SUMMARY.md`
- `docs/2026-04-08-architecture-old-vs-new.md`
- `docs/plans/2026-04-29-active-work-items.md` (at minimum, `CONTEXT.md`'s
  pointer to it should be redirected or removed)

---

## Docs that are still accurate — don't touch

- **`AGENTS.md`** (root) — only non-interactive-shell guidance + a pointer to
  `CLAUDE.md`; nothing here has gone stale.
- **`nextjs/AGENTS.md`** / **`nextjs/CLAUDE.md`** — generic Next.js
  version-drift warning; no BubblyChef-specific claims to check.
- **`WORKFLOW.md`** — verified against the actual vendored skill count (27,
  19+8 split) and it's exactly right; the rename history in §9.1 is also
  accurate and matches what's really in `.claude/skills/`.
- **`docs/agents/roles/*.md`** (pm, backend, frontend, ui-ux, qa-reviewer,
  `_role-template.md`) — ownership boundaries described (backend owns
  `ai-service/`, frontend owns `nextjs/src/app/**` + `lib/**`, ui-ux owns
  `nextjs/src/components/**`) match the actual directories where the recent
  work landed (e.g. `CookModal.tsx` in `components/recipes/`, `ai-proxy.ts` in
  `lib/api/`).
- **`docs/adr/0001-url-import-scraper-plus-llm-fallback.md`** — describes a
  design decision (recipe-scrapers + LLM fallback), not a moving implementation
  detail; still the accurate rationale.
- **`docs/design/v0-prompts.md`** — static design prompts, nothing to go stale.
- **`.env.example`** (root) — internally consistent with itself and with
  `CLAUDE.md`'s documented names (the mismatch is against the *code*, not
  between these two docs — see CRITICAL #7).
- **Chat-router architecture docs** (`docs/architecture/2026-03-30-workflow-diagrams.md`,
  `docs/architecture/2026-05-03-recipe-workflow.md`) — the sub-graph shape,
  file layout (`workflows/router.py`, `workflows/{chat,pantry,recipe}/nodes.py`),
  and intent-routing logic described still match the code structurally; only
  cosmetic details (line counts) drift.
