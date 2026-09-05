# Queue

**Updated:** 2026-09-05 · by an agent session · cleared 5 tickets (#182, #309, #308, #228,
#291) to PRs; three are green and ready to merge, two are drafts waiting on you for
different reasons.

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🟢 Ready to merge — green CI, no blockers

- [PR #364](https://github.com/ayushb3/BubblyChef/pull/364) — docs: queue refresh.
- [PR #366](https://github.com/ayushb3/BubblyChef/pull/366) — **#308**: real OpenFoodFacts
  barcode lookup replaces the 4-item mock. One caveat: the live API itself couldn't be
  reached from this sandbox (network policy blocks it) — the implementation follows
  OpenFoodFacts' documented response shape and passed two review passes, but nobody has
  pointed it at the real API yet. Worth a quick manual check before leaning on it in prod.
- [PR #367](https://github.com/ayushb3/BubblyChef/pull/367) — **#228**: pantry filter bar
  becomes three multi-select facets (location/category/expiry) instead of one single-select
  location row. Not interactively tested (headless env, no auth session) — recommend a
  quick click-through of the three dropdowns before merge.

### 🟡 Draft, needs a migration applied — #182

[PR #362](https://github.com/ayushb3/BubblyChef/pull/362) adds
`supabase/migrations/00008_add_pantry_estimated_expiry.sql` (additive, `ADD COLUMN IF NOT
EXISTS ... DEFAULT false`). An agent session can't apply it — needs the Supabase dashboard
SQL Editor or `supabase db push`. Code on both sides already tolerates the column not
existing yet, so merging before applying won't break anything — the UI feature just won't
show up until you apply it.

### 🟡 Draft, CI-config change — #309

[PR #365](https://github.com/ayushb3/BubblyChef/pull/365) adds a mypy baseline gate to CI
(94 pre-existing errors snapshotted, only new ones fail the build). Held as draft
deliberately — a CI-pipeline change, even a green one, is treated as feature-level here
rather than auto-flipped to ready.

### 🟡 Draft, feature-level (8-component scope) — #291

[PR #368](https://github.com/ayushb3/BubblyChef/pull/368) — every modal in the app
(`AddItemModal`, `PantryAddSheet`, `CookModal`, `RecipeEditModal`, `RecipeImportModal`,
`RecipeRefinementModal`, `RecipeDeleteConfirm`, `ThemePicker`) gets a shared focus trap:
Tab-cycling, Escape-to-close, focus restore on close, dialog ARIA. Two review passes (the
second specifically re-scrutinizing the shared hook's React correctness under concurrent
rendering) found and fixed two latent — not live — risks before this PR existed. Held as
draft: cross-cutting, 8 components, worth `/interrogate` before merge per its own checklist.
Screen-reader behavior (VoiceOver/NVDA) couldn't be verified headlessly — worth a manual
pass.

---

## Recently landed (confirmed on `main` this session, before the batch above)

#347, #330, #312, #336, #288, #225+#168, #327, #306, #314, #315, #322, #243, #340, #224+#305
— see `git log origin/main --oneline` for the merge commits if detail is needed.

---

## Ready to pick up

Everything that was "ready to pick up" at the start of this session is now either merged,
drafted, or taken by another session — except one:

| # | What it does for a user | Value | Size |
|---|---|---|---|
| **259** | Ingest review surface split from its entry point (container/presenter split) | Refactor; no user-visible change | M |

**Held:**
- **#183** — backfill expiry estimates onto existing null-expiry rows. Blocked by **#182**
  — specifically, blocked until #182's migration is *applied* (writing unflagged estimates
  before the column exists loses the distinction permanently).

**Taken (open PR from another session, not touched here):**
- **#302** → [PR #355](https://github.com/ayushb3/BubblyChef/pull/355) (behind `main`, needs
  rebase)
- **#303** → [PR #360](https://github.com/ayushb3/BubblyChef/pull/360) (dirty — real
  conflict, blocked on #355 anyway)
- **#341 + #342** → [PR #353](https://github.com/ayushb3/BubblyChef/pull/353) (behind
  `main`, needs rebase)

None of these three were touched this session, to avoid duplicating in-flight work. If
nobody is actively driving them, they need attention before they can move.

---

## New tickets filed this session

- **#363** — the manual "type it in" pantry-add path (`POST /api/pantry`) never sets
  `estimated_expiry` on a heuristically-guessed date, unlike every other add path. Found
  while implementing #182; the fix is small but depends on #182's migration landing first.

---

## Awaiting triage

| # | What |
|---|---|
| **331** | No sign-out anywhere in the app. Also blocks manual per-user testing. |
| **332** | Hard login wall — no landing page, no demo, no guest mode. Product decision. |
| **337** | `middleware` file convention deprecated — fails open on next Next.js upgrade. |
| **316** | PR review gate. Worktree-specific false positive. Avoidable by working in main checkout. |
| **356** | Pantry merge-on-add collapses distinct lots, discards new lot's expiry; unit-blind sum. |
| **357** | Non-blocking expiry field on the chat/scan add card — supplies #356's needed input. |
| **358** | Unapproved pantry proposal cards vanish on chat remount (history restore gap from #265). |
| **363** | *(new — see above)* |

---

## Not yet filed

- **Recent-chats list UI.** #265's triage split this out — persistence only.
- **Behavioural eval for expiry-vs-coherence.** #288, #336, #347 are all prompt/weight
  fixes verified structurally. Nobody has measured the actual model output yet.
- **Stale `priority_items` label in `GROUNDED_RECIPE_SYSTEM_PROMPT`.** Cosmetic only,
  post-#347.

---

## Notes for the next session

- **`ai-service` tests need the venv interpreter**: `./.venv/bin/python -m pytest -q`.
  System `pytest` lacks `httpx` and fails at collection.
- **`mypy --strict` has 94 pre-existing errors** (#128), gated (not blocking) once #309
  merges — until then it's still not run in CI at all. Once #309 lands, use
  `cd ai-service && ./scripts/mypy_gate.sh` (same command CI runs) instead of raw
  `mypy --strict`.
- **`npm run lint` has 2 pre-existing `e2e/` errors.** Expected baseline.
- **This sandbox's network policy blocks `world.openfoodfacts.org`** (confirmed via the
  proxy status endpoint — a policy denial, not a bug). #308's implementation is untested
  against the live API for that reason; check `curl "$HTTPS_PROXY/__agentproxy/status"` if
  you hit the same wall on a different host.
- **Multiple sessions are working this repo concurrently.** Check live PR state
  (`list_pull_requests`) before branching on anything, not just this doc — it can be stale
  between writes, and three PRs from another session (#353/#355/#360) were found mid-session
  this way.

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what changed in
plain behaviour, screenshots for anything visual, what was actually verified and how, and an
explicit list of what is *not* covered. If a PR body does not do that, it is not finished.
