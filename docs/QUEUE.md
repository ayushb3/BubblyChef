# Queue

**Updated:** 2026-09-05 · by an agent session · #182 drafted (needs a migration applied);
found three PRs (#353/#355/#360) already open from another session, not touched here.

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🔴 Migration to apply — #182 (estimated-expiry flag)

[PR #362](https://github.com/ayushb3/BubblyChef/pull/362) adds
`supabase/migrations/00008_add_pantry_estimated_expiry.sql` — additive only
(`ADD COLUMN IF NOT EXISTS estimated_expiry BOOLEAN NOT NULL DEFAULT false`). An agent
session has no credentials to apply it (§3.1). Apply via the Supabase dashboard SQL
Editor or `supabase db push`, then the PR is safe to merge — code on both sides already
defaults a missing/pre-migration column to "not estimated" so nothing breaks if you
merge before applying, but the whole point of the PR won't show up in the UI until the
column exists. Two-axis review done; one real gap (stale flag surviving a date edit)
found and fixed before this PR opened.

### 🟡 Three PRs open from a different session — not reviewed or touched here

Found mid-queue-check, evidently in progress elsewhere (possibly your local session):

- [PR #355](https://github.com/ayushb3/BubblyChef/pull/355) — backend half of #302
  (cooking-mode amendments emit a structured proposal instead of prose-only). Open,
  not draft, **behind `main`** (needs a rebase before merge).
- [PR #360](https://github.com/ayushb3/BubblyChef/pull/360) — frontend half, #303
  (renders the amendment card, lets the user confirm before deduction). **Draft**,
  blocked on #355 merging first, currently **dirty** (real conflict, not just behind).
- [PR #353](https://github.com/ayushb3/BubblyChef/pull/353) — #341 + #342 (resolved
  clarification pills linger on the card; raw internal context note leaked into a
  reply bubble). **Draft**, behind `main`.

Left alone this session to avoid duplicating work in flight. If nobody is actively
driving these, they need a rebase (`#355`, `#353`) and a conflict resolution (`#360`)
before they can move.

---

## Recently landed (confirmed on `main` this session)

- **#347**, **#330**, **#312**, **#336**, **#288**, **#225** + **#168**, **#327**,
  **#306**, **#314**, **#315**, **#322** — all merged; see individual PRs in git log
  if detail is needed. Also since landed: **#243**, **#340**, **#224** + **#305** —
  all merged to `main` per `git log origin/main`.

---

## Ready to pick up

Ordered by value. Checked against open PRs before listing — none of these have one.

| # | What it does for a user | Value | Size |
|---|---|---|---|
| **309** | New type errors fail the build | Ratchet — errors grew 73 → 168; every ticket adds more | S |
| **308** | Real OpenFoodFacts lookup instead of the stub | Product scan returns nothing useful | S |
| **228** | Pantry filter bar: multi-select facets for expiry + category | Large pantries unusable without them | M |
| **291** | Focus trap on modals, landmark structure | Keyboard and screen-reader users blocked | M |
| **259** | Ingest review surface split from its entry point | Refactor; no user-visible change | M |

**Held:**
- **#183** — backfill expiry estimates onto existing null-expiry rows. Blocked by
  **#182** — specifically, blocked until #182's migration is *applied*, not just
  merged (writing unflagged estimates before the column exists loses the distinction
  permanently).

**Taken (open PR, not free to pick up):** #302 (PR #355), #303 (PR #360), #341/#342 (PR #353).

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
| **363** | *(new, filed this session)* Manual "type" pantry-add path (`POST /api/pantry`) never sets `estimated_expiry` on a guessed date — the one add path #182 didn't cover, found during its implementation. |

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
- **`mypy --strict` has ~94 pre-existing errors** (#128), not a CI gate.
- **`npm run lint` has 2 pre-existing `e2e/` errors.** Expected baseline.
- **Multiple sessions are working this repo concurrently right now** (see the three
  PRs above under "Needs you") — check `gh pr list`/`list_pull_requests` for
  in-flight work on an issue before branching, not just this doc, since the doc can
  be stale between writes.

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what changed in
plain behaviour, screenshots for anything visual, what was actually verified and how, and an
explicit list of what is *not* covered. If a PR body does not do that, it is not finished.
