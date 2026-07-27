# Plan: unblock the stack, fix the cook flow, land the ready-for-agent queue

*Drafted 2026-07-27. Supersedes the scoping in `ROADMAP.md` (stale — see §2).*

---

## Status (updated 2026-07-27, mid-execution)

| Phase | State |
|---|---|
| 0 — quality gates executable | **Done.** Also surfaced a live production bug — see below. |
| 1a — merge PR #121 | **Done.** Rescued the cook fixes `eb596a4` / `5ac6482`. |
| 1b — re-implement #119/#120 | **Done.** Both closed as superseded rather than rebased. |
| 1c–e — residual #74 findings | **Done** except the `chip-demo` route (kept — see below). |
| 1f — visual review artifact | **Blocked** on Supabase credentials; every route redirects to `/login`. |
| 2 — #125 over-deduction | **Done**, with a scope change (see below). |
| 3 — #123, 4 — #122, 5 — cheap wins | Not started. |

### Found during execution, not anticipated by this plan

- **`/v1/recipes/generate` and `/refine` were returning HTTP 500 in production.** Both imported `get_ai_manager` from `bubbly_chef.ai.manager`, where it does not exist, and awaited it though it is synchronous. A blanket `except Exception` turned the `ImportError` into an opaque 500. Fixed in PR #126 with regression tests. Found by running `mypy --strict`, which `CLAUDE.md` calls a gate but CI does not run.
- **PR #74's "green CI" from May would not be green today.** `ruff` was pinned `>=0.4` with no upper bound; 0.16 expanded its default rule set to 144 findings on unchanged code. Pinned to `>=0.15,<0.16` in PR #126; migration tracked in #129.
- **`mypy --strict` reports 73 pre-existing errors** and is not in CI despite being documented as a gate — #128.
- **`tenacity` is imported but undeclared**, resolving transitively through langchain — #130.
- **The stack is on Next.js 16.2.2**, not the Next.js 14 that `CLAUDE.md` and this plan's §Stack claim. Docs need correcting.

### Deviations from the plan as written

- **Phase 2 no longer sums duplicate pantry rows.** §Phase 2 proposed summing rows rather than taking the max. That is wrong without a multi-row deduction model: `IngredientMatch` carries one `pantry_item_id`, so a match claiming the summed quantity would floor at 0 on its single row and silently drop the remainder. The running-consumption accumulator (the actual #125 bug) landed; row aggregation is filed as #127.
- **An adjacent bug was fixed alongside #125.** The matcher normalized names for identity but passed the raw name to `normalize_to_base_unit`, so synonyms ("cheddar") missed `INGREDIENT_CANONICAL_UNIT`, fell back to a `count` default, and produced a spurious `unit_conflict` on gram quantities.
- **`chip-demo` was kept, not deleted.** §Phase 1 called for removing it as a dev route that would ship to production. It is a live component gallery and directly serves the visual-review goal in §5; it is auth-gated by the middleware matcher like every other route. Flagged for the reviewer rather than removed.
- **CI trigger fix widened.** Rather than adding branches to the `pull_request` filter, the filter was removed entirely so any PR gets checks regardless of base.

---

## 1. Context

BubblyChef's `main` branch has not received a feature merge since **2026-05-04**. The
only commit since is `1c0d802`, a docs/governance reconcile with zero application
code. Meanwhile `feat/ui-overhaul` sits **33 commits ahead / 1 behind** with
+3081/−197 across 44 files.

The investigation turned up one fact that reorders everything:

> **The entire cook flow exists only on `feat/ui-overhaul`.** `cook_matcher.py`,
> `models/cook.py`, `CookModal.tsx`, the `/api/ai/recipes/cook` routes, and migration
> `00006_add_recipe_cook_tracking.sql` are all absent from `main`.

Every issue in the `ready-for-agent` queue (#125, #123, #122) targets that code. So
landing the UI overhaul is not one option among several — it is a **hard prerequisite
for the entire queue**. Nothing else can be built or even verified until it merges.

The design system is in the same position: `motion.ts`, `Chip.tsx`, `ThemeProvider`,
the five `[data-theme]` palettes and the semantic expiry tokens exist only on that
branch. `main`'s `globals.css` is 45 lines with a single hardcoded `:root`.

**Intended outcome:** `main` regains three months of stranded work, the cook flow
becomes correct, and the two ready-for-agent features land on a base that can
actually run them.

---

## 2. Stale facts this plan corrects

Findings that contradict the tracker and `ROADMAP.md`. Worth knowing before reading
the phases.

| Claim | Reality |
|---|---|
| #5 (pantry pagination) is an open Phase-3 blocker | **Closed `not_planned`.** Its body references `bubbly_chef/api/routes/pantry.py` and `repository/sqlite.py` — neither exists; pantry CRUD moved to Next.js + Supabase. |
| #8 (AI rate limiting) is an open Phase-3 blocker | **Closed `completed`** — on the strength of reactive 429 degradation in `gemini.py`, not the proposed token bucket. No limiter exists. |
| PRs #119/#120 are stacked on `feat/ui-overhaul` | **They were cut from `main`.** Merge-base is `b6aa74a`, 33 commits behind. Both import components that don't exist on their own base; neither has ever been typechecked. |
| PR #74 was reviewed | One `COMMENTED` self-review from 2026-05-07, **26 commits stale**. Zero line-level comments across all four PRs. |
| CI covers the PR stack | `ci.yml` triggers on `pull_request: branches: [main]` only. **PRs targeting `feat/ui-overhaul` get zero GitHub Actions coverage.** #119/#120/#121 have never been built or tested. |
| Frontend state uses Zustand (per `CLAUDE.md` and issue #122) | **Zustand is not a dependency.** No hits in `package.json` or `src/`. |

---

## 3. Decisions taken (correct me at approval if any are wrong)

1. **Land `feat/ui-overhaul`** rather than restart it. It merges clean into current
   `main` (`git merge-tree` exits 0, zero conflicted paths) and its last CI run was
   fully green.
2. **Kitchen Hub renderer = DOM + Framer Motion**, overriding PRD #67's Phaser 3.
   Recorded as an ADR; the epic itself (#67–#75) is **out of scope this session**.
3. **Scope = bugs + tech debt + UI stack + the ready-for-agent features** (#125,
   #123, #122). Not the kitchen hub.
4. **Per-issue branches** (`feat/issue-<n>-<slug>`) per `WORKFLOW.md` §4, one PR
   each — not one lump branch. This diverges from the session's assigned branch
   `claude/status-check-xdgnnh`; I'll use per-issue branches as the convention
   requires.
5. **Rewrite #119/#120 rather than salvage them.** Together they are 182 added lines
   across 6 files; rebasing #119 in particular is a re-implementation, not a conflict
   resolution (it deletes the mascot avatar and pop-in animation that ui-overhaul
   added, because it never had them).
6. **Feature-level PRs stop for your sign-off** (`WORKFLOW.md` §6). PR #74 is the
   clearest example — I drive it to green and hand it over, I don't merge it.

---

## 4. Phases

Each phase is independently shippable. Phase 0 and 1 gate everything after them.

### Phase 0 — Make the quality gates executable *(prerequisite, no PR)*

Nothing can be verified today: `nextjs/node_modules` is absent, Python deps are not
installed (`pytest` collects 9 errors — all `ModuleNotFoundError`), and four of the
open issues carry `npx tsc --noEmit` as an acceptance criterion.

- `cd nextjs && npm ci`
- `cd ai-service && pip install -e ".[dev]"`
- Confirm all five gates run: `tsc --noEmit`, `npm test`, `pytest`, `ruff check`,
  `mypy --strict`
- Fix the one packaging bug found: **`tenacity` is imported by
  `ai-service/bubbly_chef/tools/llm_client.py:152` but is missing from
  `pyproject.toml` dependencies.**

### Phase 1 — Land the UI overhaul stack *(the unblock)*

1. **Merge PR #121 into `feat/ui-overhaul` first.** It is correctly based, has one
   trivial import conflict in `RecipeBook.tsx`, and carries the newest cook fixes
   (`eb596a4` parse qty/unit from string ingredients + drop fuzzy catalog matching;
   `5ac6482` fix str-ingredient crash). **If ui-overhaul lands without it, those
   fixes are lost** and #123's premise breaks.
2. **Close #119 and #120 as superseded**, re-implementing their substance fresh on
   top of ui-overhaul: `EmptyState.tsx` (47 lines, using the real `Chip`) and the
   chat bubble tail + `PostMessageChips` — the latter re-applied *additively* so the
   mascot and pop-in survive, and with the duplicated inline `Chip` primitives torn
   out in favour of `components/ui/Chip.tsx`.
3. **Merge `main` into `feat/ui-overhaul`** — docs-only, free.
4. **Clear the residual #74 findings:**
   - Delete `nextjs/src/app/chip-demo/page.tsx` (179-line dev route that would ship
     to production).
   - `ThemePicker` dots are 28×28px — below the WCAG 2.5.5 44×44 minimum. Fix.
   - Sanity-check the global Jest `node` → `jsdom` switch against the two existing
     pure-logic tests.
5. **Fix the CI trigger** so stacked PRs are covered — widen
   `pull_request: branches:` beyond `[main]`. This is the process bug that let
   three untested PRs accumulate.
6. Produce the **visual review artifact** (§5), then hand PR #74 over for your merge
   sign-off.

Critical files: `nextjs/src/app/globals.css`, `nextjs/src/lib/motion.ts`,
`nextjs/src/components/ui/{Chip,ThemePicker}.tsx`,
`nextjs/src/components/recipes/RecipeBook.tsx`, `.github/workflows/ci.yml`.

### Phase 2 — Fix #125, duplicate-ingredient over-deduction *(bug, on the landed base)*

Root cause is precisely located and has **three** independent defects, not one:

- **`cook_matcher.py:147-153`** builds `pantry_index` once, then the loop at `:159`
  re-reads the *original* `pantry_item.quantity_base` at `:206-207` on every
  iteration. There is no running-consumption accumulator, so two recipe lines that
  normalise to the same key both compare against the full quantity and both return
  `status="ready"`. Synonym collapse widens this well past literal duplicates —
  `normalizer.py:18` maps cheddar/mozzarella/parmesan → `cheese`.
- **`CookModal.tsx:90-107`** maps matches → `DeductionItem[]` with no aggregation, so
  two matches sharing a `pantry_item_id` emit two deductions.
- **`cook_matcher.py:152`** keeps only the *highest-quantity* row when the pantry has
  duplicates, silently discarding the rest — an independent under-reporting bug.

Fix all three: accumulator in `match_ingredients()`, aggregate by `pantry_item_id`
in `CookModal`, sum duplicate pantry rows rather than max. Add a server-side
aggregation guard in `cook_confirm()` (`recipes_ai.py:259-265`) so the DB is
defended regardless of client behaviour. Also fix the shared-override-input
collision at `CookModal.tsx:248-253`.

Tests: no existing test uses a duplicate or synonym-colliding name, and the confirm
tests assert call *shape* only (`assert_called_once_with`), never resulting
quantities. Add both, plus the first behavioural tests for `deduct_pantry_item()`.

*The issue's `NULL` quantity concern is unfounded — `quantity` is `NOT NULL DEFAULT
1.0` per `00001_initial_schema.sql:31`. I'll note that on the issue rather than
write a guard for it.*

### Phase 3 — #123, LLM ingredient matching with substitutions

Seam is the `missing` branch at `cook_matcher.py:176-179`: keep the deterministic
path first, fall back to the LLM only for unmatched ingredients — the same shape as
ADR 0001's scraper-then-LLM pattern. Requires making `match_ingredients()` `async`
(callers at `recipes_ai.py:217-222` are already async).

Contract to freeze before parallel work: a new `substitute` arm on
`IngredientMatch.status` (`models/cook.py:27` + its TS mirror at
`types/recipes.ts:66`), plus a `substitute_note`. **Precedent already exists** —
`types/chat.ts:45-50` has exactly this shape and `ChatRecipeCard.tsx:30-34` already
renders it. Reuse, don't reinvent. `statusColor()`/`statusLabel()` in `CookModal.tsx`
are exhaustive switches needing the new arm.

Call the LLM via `AIManager.complete(prompt, response_schema=..., temperature=...)`
with a Pydantic schema and the standard `isinstance` guard — pattern at
`workflows/router.py:371-391`.

### Phase 4 — #122, cook → chat handoff with recipe context

Most of the plumbing is **already built and dormant**:

- `SessionMode.COOKING` (`models/session.py:12-19`) is read at `router.py:267` but
  **never set** by `update_session_node()`.
- `session.pinned_recipe_id` is persisted (`supabase_repo.py:363`) but only ever
  *cleared*, never populated.
- `ChatRequest.context` (`models/requests.py:95-97`) is accepted and **never read** —
  `routes/chat.py:86-93` drops it.

So this is mostly wiring existing hooks: populate them on handoff from
`CookModal.tsx:111-116`, read `context` through into the workflow, and inject the
pinned recipe into `cooking_help_response()` (`workflows/chat/nodes.py:224`), which
currently builds a free-text prompt with no recipe injection. Frontend needs
`context` added to the TS `ChatRequest` (`types/chat.ts:101-106`) and
`useChat.ts:87`. **Use URL params or React context for the handoff — not Zustand,
which the issue assumes but the project doesn't have.**

### Phase 5 — Cheap wins *(each a small independent PR)*

- **#105 — typing while streaming.** Single line: `disabled={isStreaming}` at
  `chat/page.tsx:209`. The issue's premise is partly wrong in our favour — the Enter
  guard it asks for already exists at `useChat.ts:56`. Also revisit the
  `RotatingPlaceholder` condition at `:212`.
- **#110 — pantry category tinting.** Unblocked only once Phase 1 lands (`CATEGORY_BG`
  and the `[data-theme]` blocks don't exist on `main`). Add 6 dedicated category
  tokens × 5 themes, contrast-checked against `--color-text`.
- **ADR + issue hygiene:** write `docs/adr/0002-kitchen-hub-dom-not-phaser.md`,
  update #67 and its children to match, and correct `ROADMAP.md`'s stale
  #5/#8 blocker entries.

**Deliberately not started:** the Kitchen Hub epic (#67–#75), #106 (needs splitting
into a backend `suggestions[]` emitter and a frontend renderer — the field doesn't
exist in `ChatResponse` today), and #10 accessibility (blocked on refactoring
`SpringButton.tsx`, which accepts no `aria-label` and has no rest-spread, and two of
its five sub-tasks require a human with VoiceOver/NVDA).

---

## 5. Visual validation

You asked for screenshots or an HTML review page rather than reading diffs. One
honest constraint: **there is no `nextjs/.env.local` and no `ai-service/.env`**, so
there are no Supabase credentials in this environment and authenticated pages cannot
be rendered against real data.

What I'll deliver instead, in descending order of fidelity:

1. **A published HTML review Artifact** — the real `globals.css` token system
   rendered across all five palettes (sakura / mint / lavender / yuzu / bluebell),
   every `Chip` tone, the semantic expiry tokens, `EmptyState`, and the cook-flow
   status states. Built from the actual branch CSS, viewable on a phone.
2. **Playwright screenshots** (Chromium is pre-installed) of the routes that render
   without a live Supabase session — `/login`, and each theme applied — booted with
   placeholder env vars.
3. **The existing Vercel preview** for PR #74
   (`bubbly-chef-git-feat-ui-overhaul-*.vercel.app`) for interactive checking, which
   is the only path to authenticated pages.

If you can drop test credentials into `nextjs/.env.local`, I can screenshot the full
authenticated app — pantry, recipes, chat, and the cook modal — instead of just the
design system. Worth saying explicitly: **the cook-flow fix in Phase 2 is the one
change I cannot show you visually without those credentials**; it'll be evidenced by
tests instead.

---

## 6. Verification

Per phase, before any PR:

```bash
cd ai-service && pytest -q && ruff check bubbly_chef/ && mypy bubbly_chef/ --strict
cd nextjs && npx tsc --noEmit && npm test
```

Phase-specific:

- **Phase 1** — CI green on PR #74 against current `main`; the merged result
  typechecks (neither #119 nor #120 ever did); visual artifact reviewed.
- **Phase 2** — new tests fail before the fix and pass after (reproduce first, per
  `WORKFLOW.md` §8 *fix-root-causes*). Cases: literal duplicate ingredient, synonym
  collision (cheddar + parmesan → `cheese`), duplicate pantry rows, and a
  behavioural `deduct_pantry_item()` assertion on resulting quantity — not call
  shape.
- **Phase 3** — deterministic path still handles everything it does today with the
  LLM stubbed out; substitutions appear only for genuinely unmatched ingredients;
  `NoProviderAvailableError` degrades to today's `missing` behaviour.
- **Phase 4** — cooking a recipe then opening chat carries the recipe; asking a
  follow-up references it; the exit phrase clears `SessionMode.COOKING`.

---

## 7. Risks

- **The 3k-line merge is the single biggest risk.** It is clean and CI-green, but it
  is three months of unreviewed work landing at once, and the only human review is 26
  commits stale. The visual artifact in §5 exists specifically to make that
  reviewable.
- **A migration ships with it** — `00006_add_recipe_cook_tracking.sql` needs applying
  to the production Supabase project when #74 merges. I'll flag it in the PR body; I
  won't run it.
- **`main` has been static for three months**, so the merge risk is not growing — but
  it also means nothing is currently validating that `main` still deploys.
- Phases 3 and 4 cross the `backend`/`frontend` role boundary. Per `pm.md` I'll
  freeze the JSON contract before delegating either.
