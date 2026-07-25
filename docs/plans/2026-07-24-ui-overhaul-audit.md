# `feat/ui-overhaul` (PR #74) Landing Audit

*Date: 2026-07-25 · Author: qa-reviewer (read-only audit) · Status: findings for PM review*

Scope: is `origin/feat/ui-overhaul` (PR #74, +3081/-197, 44 files, open since
2026-05-05) still safely landable, and what is the real cost? Also covers the
three stacked PRs (#119, #120, #121) and the interaction with the
`get_ai_manager`/`await` fix that just landed on the current working branch.

Commits referenced:
- `feat/ui-overhaul` tip: `e637354` (2026-05-19)
- current branch tip at time of audit: `d5e9b3967` (2026-07-25, "Wire Playwright
  smoke suite into CI") — note the branch moved twice *during* this audit (see
  §7, Moving Target below); the primary build/gate verification below was run
  against `c4b0898` (one commit earlier), with a confirming re-check against
  `d5e9b396`.
- `feat/w2-chat-bubble` tip: `3d20098`, `feat/w2-empty-state` tip: `15e4b65`,
  `feat/w2-action-cluster` tip: `b86fd57`

---

## Verdict: LAND WITH FIXES

`feat/ui-overhaul` merges cleanly (zero conflicts, confirmed by both
`git merge-tree` and an actual `git merge --no-ff` in a throwaway worktree) into
the current branch as of `c4b0898`, and the merged tree **passes `tsc --noEmit`,
`jest`, and `pytest` outright**. It fails `mypy --strict` with 14 errors, all
confined to two files ui-overhaul itself authored (`supabase_repo.py`'s two new
methods, one stale `type: ignore` in `recipes_ai.py`) plus 3 trivial `ruff`
line-length violations — all mechanical, all following a fix pattern (`_as_row`)
already established elsewhere in the file. This is a few hours of focused work,
not a rewrite. The branch does **not** reintroduce or interact with the
`get_ai_manager` bug that was just fixed — ui-overhaul's diff on `recipes_ai.py`
only appends two new endpoints after line 164; the fixed `/generate` and
`/refine` handlers (lines 65–150) are untouched by ui-overhaul and survive the
merge intact.

The three stacked PRs are a different story: **none of them are actually based
on the current tip of `feat/ui-overhaul`** despite declaring it as their GitHub
base. #119 and #120 branch from the point *before* the Chip component even
existed (32 commits behind tip); #121 is one commit closer but still stale.
Each one individually conflicts with `feat/ui-overhaul`'s tip, and #120 and
#121 also conflict *with each other* on the same file. These are real,
substantive, hand-reconciliation conflicts (rewritten `ChatMessage` rendering,
rewritten recipe action-button block), not formatting noise. They need a
rebase-and-manual-merge pass before they can land, and #121 also violates the
frontend/backend ownership boundary by bundling an `ai-service/` bugfix into a
"UI" PR.

Net: PR #74 alone is close to mergeable today. The stack behind it is not, and
is the part that will actually consume the plan's 2-day time-box.

---

## Effort estimate

| Item | Estimate |
|---|---|
| Fix 14 mypy --strict errors in `supabase_repo.py` (apply `_as_row` pattern to `update_recipe_cooked`/`deduct_pantry_item`) + drop 1 stale `type: ignore` | 1–2 hrs |
| Fix 3 ruff E501 line-length violations | 15 min |
| Resolve `jest.config.js` + `package-lock.json` conflict (introduced by concurrent Playwright work landing on the current branch mid-audit) | 30 min |
| Merge PR #74 into `main`, re-run full gate, apply `00006` migration | 1 hr |
| Rebase #119 onto post-merge `main`, resolve `chat/page.tsx` conflict (two independent rewrites of `ChatMessage`) | 2–4 hrs — this is the worst offender, needs a human product call on which chat-bubble behaviors survive (mascot+motion wrapper vs. `isLastMessage`/`PostMessageChips`), not just a text merge |
| Rebase #120 onto that, resolve `RecipeBook.tsx` empty-state conflict (positional only, low risk) | 1 hr |
| Rebase #121 onto that, resolve `RecipeBook.tsx` action-cluster conflict (large rewrite of the same block #120 already touched) + carve the `cook_matcher.py` fix out to a `backend`-owned change | 2–4 hrs |
| Full regression pass (manual smoke: cook flow, chat, recipe library, theme switcher) | 2 hrs |
| **Total** | **~10–15 hrs** |

**Fits the plan's 2-day time-box** (§7 risk: "if it exceeds ~2 days, land it
behind the theme picker as opt-in and fix forward") — but only just, and only
if #119's chat-bubble reconciliation doesn't surface a product-level disagreement
about which behavior wins. That single file is the schedule risk in this
estimate; everything else is mechanical.

---

## Conflict table

### `feat/ui-overhaul` → current branch (`c4b0898`, re-confirmed at `d5e9b396`)

| File | Type | Severity |
|---|---|---|
| *(none at `c4b0898`)* | — | Clean merge, 0 conflicts |
| `nextjs/jest.config.js` (new, at `d5e9b396`) | Trivial — non-overlapping config keys (`testEnvironment`/`setupFilesAfterEnv` vs `testPathIgnorePatterns`) | Low — 2 min manual merge |
| `nextjs/package-lock.json` (new, at `d5e9b396`) | Mechanical — lockfile | Low — regenerate via `npm install` |

Three files are touched by **both** branches but merge cleanly because the
edits land on disjoint line ranges: `ai-service/bubbly_chef/api/routes/recipes_ai.py`,
`ai-service/bubbly_chef/repository/supabase_repo.py`,
`ai-service/bubbly_chef/services/recipe_url_ingestor.py`. Verified by diffing
each side against the merge-base and by inspecting the actual merged blob.

### Stacked PRs → `feat/ui-overhaul` tip (`e637354`)

| Merge | File | Type | Severity |
|---|---|---|---|
| #119 → #74 | `nextjs/src/app/chat/page.tsx` | **Semantic** — both sides independently rewrote `ChatMessage`'s render function and the header bar | **High** — worst offender in this audit |
| #119 → #74 | `nextjs/src/components/chat/MessageBubble.tsx` | Auto-merges clean | — |
| #120 → #74 | `nextjs/src/components/recipes/RecipeBook.tsx` (empty-state block) | Positional — content identical on both sides, conflict is purely from ~220 lines of unrelated insertions shifting the anchor context | Low-medium — easy manual resolve |
| #121 → #74 | `nextjs/src/components/recipes/RecipeBook.tsx` (action-button block) | **Semantic** — #74's own tip already edited the tag-chip rendering immediately above this block (Chip/tagToTone, commit `e637354`); #121 fully rewrites the buttons below it (heart-pop animation, overflow menu, Cook-It repositioning) | **High** |
| #120 ↔ #121 (direct, sibling-to-sibling) | `nextjs/src/components/recipes/RecipeBook.tsx` | Same two hunks as above — confirmed via direct `merge-tree` between the two branches, independent of #74 | High |

`#119`/`#120` share `chat/page.tsx` in their own diffs but don't conflict with
*each other* there (different regions); the risk is entirely each-vs-#74.

---

## Build/test results

All commands run in throwaway `git worktree`s (`/tmp/.../scratchpad/wt/ui-overhaul`
and `/tmp/.../scratchpad/wt/merge-check`), both removed via
`git worktree remove --force` on completion. Main working tree was never
touched — verified `git worktree list` shows only the primary tree afterward
and that the 3 commits the other agent landed mid-audit were not something
this audit produced.

### `feat/ui-overhaul` standalone (`e637354`)

```
npx tsc --noEmit         → clean, no output
npm test -- --ci          → Test Suites: 4 passed, 4 total / Tests: 22 passed, 22 total
pytest -q (ai-service)    → 91 passed, 10 skipped
ruff check bubbly_chef/   → Found 144 errors  (pre-existing repo-wide debt, NOT ui-overhaul-specific —
                             see explanation below)
mypy --strict             → Found 75 errors in 11 files (mostly the same JSON-narrowing class of
                             error the current branch's `_as_row` helper was written to fix — this
                             branch predates that fix entirely)
```

The 144 ruff errors and most of the 75 mypy errors on the standalone branch are
**not new problems ui-overhaul introduces** — they're the state of `ai-service/`
before the current branch's `mypy --strict` CI gate (`b9cbb36`, landed today)
and its JSON-row-narrowing fix (`_as_row`) existed. This is expected: the branch
is two months old and predates that hardening work entirely. What matters is
the number *after* merging with current HEAD, below.

### Merged (`feat/ui-overhaul` + current branch, actual `git merge --no-ff`, at `c4b0898`)

```
git merge --no-ff --no-edit origin/feat/ui-overhaul  → clean, 0 conflicts, exit 0
npx tsc --noEmit (nextjs)   → clean, no output
npm test -- --ci (nextjs)   → Test Suites: 4 passed, 4 total / Tests: 22 passed, 22 total
pytest -q (ai-service)      → 95 passed, 10 skipped
ruff check bubbly_chef/     → Found 3 errors (all E501 line-too-long, in ui-overhaul's own new
                               files: models/cook.py:13, models/cook.py:28,
                               services/recipe_url_ingestor.py:229)
mypy --strict               → Found 14 errors in 2 files:
```

```
bubbly_chef/repository/supabase_repo.py:339  — update_recipe_cooked: `current.get(...)` on
                                                 unnarrowed JSON union (needs _as_row(result.data))
bubbly_chef/repository/supabase_repo.py:374  — deduct_pantry_item: `row["quantity_base"]` /
                                                 `row["quantity"]` on unnarrowed JSON union
                                                 (same fix)
bubbly_chef/api/routes/recipes_ai.py:217     — stale `# type: ignore[assignment]` on
                                                 `recipe_dict: dict[str, Any] = recipe_data` —
                                                 now unnecessary because the current branch's fix
                                                 already narrowed get_recipe's return type to
                                                 dict[str, Any] | None
```

All 14 errors collapse to: apply the exact `_as_row()` pattern the current
branch already introduced, in two more places, and delete one now-redundant
`type: ignore`. This is the entire "backend" side of the fix cost.

**Confirms the CLAUDE.md quality gate would currently fail CI** if ui-overhaul
merged as-is today, specifically on the `mypy --strict` gate that was wired in
as a *required* check this same day (`b9cbb36`) — timing coincidence, not a
ui-overhaul defect, but it does mean this branch cannot land silently; someone
has to touch it.

---

## Migration safety (`00006_add_recipe_cook_tracking.sql`)

```sql
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS last_cooked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS times_cooked integer NOT NULL DEFAULT 0;
```

- **Idempotent** — `ADD COLUMN IF NOT EXISTS` on both columns, safe to re-run.
- **No numbering collision.** The repo's current highest migration is `00005`
  (`00005_add_recipe_source_columns.sql`). `00006` is next in sequence and does
  not exist on disk in the current branch, so applying it is a straight append.
- **No conflict with the planned `00007`/`00008`.** `docs/plans/2026-07-24-gamification-and-live-kitchen.md`
  §5.2–5.3 defines `00007_kitchen_events.sql` (new `kitchen_events` table) and
  `00008_kitchen_progress.sql` (new `kitchen_progress` table) — both net-new
  tables, no overlap with `recipes.last_cooked_at`/`times_cooked`. The plan
  explicitly *depends on* `00006` landing first (§1: "`00006` already adds
  `recipes.times_cooked` and `recipes.last_cooked_at`. The seed of a
  progression system is written but unshipped" — and §5.4c cites
  `recipes.times_cooked` directly as the source for "dishes on the counter").
  Landing `00006` is a hard prerequisite for Phase D of that plan, not a risk
  to it.
- One soft note: the plan's §5.4a also proposes `ALTER TABLE decorations ADD
  COLUMN slot/unlock_level/rarity` with no explicit migration number assigned
  in the doc — whoever writes that migration should number it `00009` (after
  `00007`/`00008`), not reuse `00006`'s slot. Not a current conflict, just a
  sequencing note for whoever picks up Phase D/E.

---

## The broken-endpoint interaction (traced end to end)

Frontend call → route → AI service, for every AI-facing call ui-overhaul's
`nextjs/src/lib/api/recipes.ts` makes:

| Frontend fn | Next.js proxy route | AI service endpoint | Touched by ui-overhaul? | Touched by the `get_ai_manager` fix? |
|---|---|---|---|---|
| `generateRecipe()` | `/api/ai/recipes/generate` (pre-existing, **not** in ui-overhaul's diff) | `POST /v1/recipes/generate` | No — lines 65–96 of `recipes_ai.py` untouched by ui-overhaul | **Yes** — this is the exact function that was broken and just fixed |
| `refineRecipe()` | `/api/ai/recipes/refine` (pre-existing) | `POST /v1/recipes/refine` | No — lines 128–150 untouched | **Yes** — same fix |
| `cookRecipe()` | `/api/ai/recipes/cook` (new, ui-overhaul) | `POST /v1/recipes/cook` (new, ui-overhaul, appended at line 164+) | Yes — but this code never calls `get_ai_manager` at all; it goes straight to `SupabaseRepository` + `cook_matcher.match_ingredients` | No |
| `confirmCook()` | `/api/ai/recipes/cook/confirm` (new, ui-overhaul) | `POST /v1/recipes/cook/confirm` (new) | Yes — same, no AI manager call | No |

**Conclusion: no interaction.** ui-overhaul's new cook feature is a pure
DB-matching workflow (pantry item lookup + unit normalization against
`domain/catalog.py` and `domain/normalizer.py`, both pre-existing and
unmodified) — it never touches `AIManager` or the code path that was broken.
The one place ui-overhaul's frontend *does* call into the previously-broken
code (`generateRecipe`/`refineRecipe`, via the pre-existing, unchanged proxy
routes) is fully covered by the fix already on the current branch, and the
merge preserves that fix untouched (confirmed: the diff regions don't overlap,
and the merged blob was inspected directly).

One adjacent finding worth flagging: `get_recipe`'s return type changed from
`RecipeCard | None` (with a `# type: ignore[return-value]` papering over the
fact it always returned a raw dict at runtime) to the honestly-typed
`dict[str, Any] | None`. ui-overhaul's new `/cook` handler was already written
treating the return value as a dict (`recipe_dict.get("ingredients", [])`), so
behaviorally nothing changes — it's the stale `type: ignore` noted above that
needs deleting, not a logic fix.

---

## Staleness of the stacked PRs — the significant finding

None of #119/#120/#121 are actually built on `feat/ui-overhaul`'s current tip,
despite GitHub showing that as their PR base:

- **#119** (`w2-chat-bubble`) and **#120** (`w2-empty-state`): merge-base with
  `feat/ui-overhaul` is `b6aa74a8` — the commit **before ui-overhaul's own 32
  commits of work**, including the Chip component, ThemePicker, ThemeProvider,
  and `lib/motion.ts`. Verified directly: `git ls-tree` on both branches shows
  **no** `Chip.tsx`, `ThemePicker`, `ThemeProvider`, or `motion.ts` anywhere in
  their trees. GitHub's diff view against `feat/ui-overhaul` is comparing
  against a moving target these branches never actually saw.
- **#121** (`w2-action-cluster`): merge-base is `53cf98a8` ("Chip component +
  tagToTone helper," #117) — one commit closer, but still misses ui-overhaul's
  final tip commit `e637354` ("replace chip render sites with Chip component,"
  #118), which is exactly the commit that edited the lines immediately above
  #121's action-button rewrite.

Practical effect: merging any of these three as a simple "merge PR into base"
today will **not** be a clean fast-forward or trivial 3-way merge — each
produces a real conflict (see table above), and #120/#121 conflict with each
other too (confirmed via direct `merge-tree` between the two branches). These
are not accidental — the diffs show genuinely independent, overlapping
rewrites of the same UI surfaces (chat message rendering, recipe action
buttons), meaning whoever reconciles them needs to make product decisions
about which behavior survives, not just resolve text.

---

## Scope check — ownership boundary violations

Per `docs/agents/roles/`, a "UI" branch should stay inside `nextjs/`. Files
touched outside that boundary:

**`feat/ui-overhaul` (#74):**
```
ai-service/bubbly_chef/api/routes/ingest.py            (trivial — log line only)
ai-service/bubbly_chef/api/routes/recipes_ai.py         (new /cook, /cook/confirm endpoints)
ai-service/bubbly_chef/models/cook.py                   (new file — Pydantic models)
ai-service/bubbly_chef/repository/supabase_repo.py      (new deduct_pantry_item, update_recipe_cooked)
ai-service/bubbly_chef/services/cook_matcher.py         (new file — ingredient matching logic)
ai-service/bubbly_chef/services/recipe_url_ingestor.py  (trivial — log line only)
ai-service/tests/test_cook_matcher.py                   (new)
ai-service/tests/test_cook_routes.py                    (new)
supabase/migrations/00006_add_recipe_cook_tracking.sql  (new migration)
```

**#121 (`w2-action-cluster`):**
```
ai-service/bubbly_chef/services/cook_matcher.py  (bugfix: "parse qty/unit from string
                                                    ingredients; drop fuzzy catalog matching")
```

No branch here touches `.github/`.

This is a real scope-gate hit, not a technicality — `#74` is ~20% backend by
file count (9 of 44 files) and it's not incidental plumbing: it's a complete
feature (cook-a-recipe, pantry deduction, a new DB migration) built end-to-end
by whoever was driving "UI overhaul." The plan document itself acknowledges
this obliquely (§1: "the seed of a progression system is written but
unshipped"). Recommend this get an explicit backend + qa-reviewer sign-off pass
on `models/cook.py` / `cook_matcher.py` / the two new repo methods before
landing — not just a frontend review — precisely because the mypy --strict
failures found above live in exactly this backend slice.

`#121` compounds the problem by bundling a backend bugfix inside a UI PR,
which is the pattern this audit would flag on its own even if the merge
mechanics were clean.

---

## Risks, ordered by severity

1. **`#119`'s `chat/page.tsx` reconciliation is a product decision, not a merge.**
   Both sides independently rewrote `ChatMessage`'s rendering: ui-overhaul adds
   a `motion.div` wrapper + mascot state + mascot avatar next to every message;
   `#119` adds `isLastMessage`/`PostMessageChips`/`handleSendText`. A naive
   "take both" merge is plausible but untested — nobody has seen the mascot
   avatar and the post-message chips rendered together. *Failure scenario:*
   whoever resolves this picks one side's structure and silently drops the
   other's feature (e.g., the mascot renders but `isStreaming` never gets wired
   through, so PostMessageChips flash on every message instead of just the
   last one).

2. **`mypy --strict` will fail on merge unless the two files are fixed first**,
   and this is a newly-required CI gate as of today. *Failure scenario:* someone
   merges #74 into `main`, CI goes red, and the fix gets rushed rather than done
   properly, following the `_as_row` pattern loosely and introducing a real
   `Any`-typed hole in the type system that the strict gate was just added to
   prevent.

3. **`#120`/`#121` conflict with each other on the same `RecipeBook.tsx`
   region**, independent of `#74`. *Failure scenario:* landed in the wrong
   order (say #121 before #120), the second merge silently drops half of one
   PR's changes if resolved carelessly under time pressure — e.g., the
   overflow menu's Edit/Delete buttons survive but the EmptyState swap for the
   "no recipes yet" screen gets reverted back to the old BubblesMascot markup.

4. **The stack is not what GitHub's PR view shows.** A reviewer looking at
   #119/#120's "Files changed" tab today is seeing a diff against a
   `feat/ui-overhaul` tip the branch never incorporated. *Failure scenario:*
   someone approves #119 based on that diff looking clean, then the actual
   merge into the *real* current `feat/ui-overhaul` produces the chat/page.tsx
   conflict above as a surprise post-approval, or worse, gets force-merged
   with `-X ours`/`-X theirs` to make CI pass, silently deleting a feature.

5. **Backend logic shipped inside a "frontend" branch bypassed backend
   review.** `cook_matcher.py`'s unit-matching logic and the two new
   `supabase_repo.py` methods (which do real money-adjacent-ish state mutation:
   deducting pantry quantities) have apparently never had a backend-role pass.
   *Failure scenario:* `deduct_pantry_item`'s proportional-scaling math (`ratio
   = new_base / current_base`) has an edge case at `current_base == 0` that's
   handled (falls to `0.0`), but there's no test in `test_cook_matcher.py` for
   the *repository* method itself (only the matcher), so a future regression
   in the deduction math wouldn't be caught by ui-overhaul's own test suite.

6. **The moving-target problem is structural, not one-time.** This audit
   itself observed the base branch move twice during the investigation (from
   `c4b0898` to `d5e9b396`), which introduced two *new* conflicts
   (`jest.config.js`, `package-lock.json`) that didn't exist an hour earlier.
   Every day #74 stays unmerged, the conflict surface can grow from ongoing
   work on the current branch, independent of anything in ui-overhaul itself.
   This is the strongest argument for landing #74 *now* rather than doing one
   more audit pass later.

---

## Recommended landing sequence

1. **Land `#74` into `main` first, alone.** Before merging:
   - Fix the 14 `mypy --strict` errors in `supabase_repo.py` (apply `_as_row`
     to `update_recipe_cooked`/`deduct_pantry_item`) and `recipes_ai.py`
     (delete the stale `type: ignore` at line ~217).
   - Fix the 3 `ruff` E501 violations in `models/cook.py` (x2) and
     `recipe_url_ingestor.py`.
   - Resolve `jest.config.js` (keep both: `testEnvironment: 'jsdom'` +
     `setupFilesAfterEnv` from ui-overhaul, `testPathIgnorePatterns` from
     current branch) and regenerate `package-lock.json` via `npm install`
     post-merge rather than hand-resolving it.
   - **Verify between this step and the next:** full gate green
     (`pytest && ruff check && mypy --strict` + `tsc --noEmit` + `npm test`),
     then apply `00006` to a staging Supabase instance and confirm
     `recipes.times_cooked`/`last_cooked_at` exist and default correctly on a
     pre-existing row.
   - Get a backend-role pass specifically on `cook_matcher.py` and the two new
     repository methods (risk #5) before merging, since no frontend review
     would have caught the missing repository-level test coverage.

2. **Rebase `#119` onto the newly-merged `main`, not onto old `feat/ui-overhaul`.**
   Resolve `chat/page.tsx` by hand — this needs a product decision (risk #1),
   not a mechanical merge. **Verify:** manually drive the chat flow — mascot
   renders per-message, `isStreaming` correctly gates the mascot's "thinking"
   state, and `PostMessageChips` appear only on the actual last message, not
   every message.

3. **Rebase `#120` onto that result.** The `RecipeBook.tsx` conflict here is
   positional only (identical content, shifted by unrelated insertions) — low
   risk, but still verify by hand: **check** the "no recipes yet" screen still
   renders `EmptyState` with the router-based CTA, not a reverted
   `BubblesMascot` fallback.

4. **Rebase `#121` onto that result last** (it's the most rewritten and most
   likely to break if landed before the other two settle). Resolve the
   `RecipeBook.tsx` action-button conflict by hand, and **split out**
   `cook_matcher.py`'s bugfix into its own backend-reviewed commit rather than
   folding it into the same PR. **Verify:** cook flow end-to-end (open recipe →
   Cook It → confirm → pantry quantities actually decrement), heart-pop
   animation, and the overflow menu's Edit/Delete both work with the
   Chip-based tag rendering already in `main` from step 1.

5. **After all four land**, run the full gate one more time on `main` and do
   one manual smoke pass across: theme switcher (all 5 palettes), chat, recipe
   library (empty state, action cluster, cook flow), and pantry — since this
   is 3,000+ lines touching nearly every screen in the app, a single combined
   regression pass at the end is worth the hour even though each step above
   was verified individually.

Do not attempt to land all four in one combined merge — the conflict surface
is large enough that isolating each step's verification is the only way to
catch a silently-dropped feature (risks #1 and #3) before it reaches `main`.
