# Handoff — cloud session → local session

**Written:** 2026-09-11 · by the cloud agent session · `main` @ `841027d`

This exists because the cloud sandbox **cannot drive a browser against this app**
(see *Why this handoff exists* below). A local session can. Everything below is
written so a fresh local session can start cold without reading the old transcript.

---

## Paste this into the local session

> You're picking up BubblyChef from a cloud agent session that could not run a
> browser. Read `CLAUDE.md`, `WORKFLOW.md`, and `docs/QUEUE.md` first, then
> `docs/HANDOFF.md` (this file) for what the previous session actually learned.
>
> Your advantage over the previous session is that you can run a real browser
> against a real Supabase. Lead with that. The priorities, in order:
>
> 1. **Verify the merged UI work actually behaves** — five user-visible features
>    landed in the last few days with zero click-through verification. They are
>    listed under *Unverified merged work* below, each with what to look at and
>    what "wrong" looks like. This is the single highest-value thing you can do
>    that the previous session could not.
> 2. **Issue #351** (*feat(e2e): Playwright demo flows — full app happy-path
>    walkthrough*) and **issue #352** (*test(e2e): full Playwright regression
>    suite — CI-gated, all modules*). Both are labelled `ready-for-human`
>    precisely because they need a working browser. They are now unblocked for
>    you. #351 first — it produces the demo clips that make every future PR
>    reviewable without a live session.
> 3. **Issue #345** (*cook-confirm + receipt stubbed specs fail on a production
>    server*) — existing e2e specs pass against the dev server and fail against a
>    production build, currently masked by dev-server partial hydration. You can
>    actually reproduce this; the previous session could not.
>
> Follow the repo's process: PM delegates implementation to the dev-role
> subagents (`backend`, `frontend`, `ui-ux`, `qa-reviewer`), two-axis
> `/code-review` before opening any PR, `thermo-nuclear-review` before merging.
> Don't implement directly and don't review your own work.

---

## Why this handoff exists

The cloud sandbox's browser **cannot reach Supabase or any live third-party API**,
even though `curl` and the Next.js dev server reach both fine from the same
sandbox. Tried explicit Playwright proxy config, a localhost bypass, and
`--ignore-certificate-errors` — all hit `ERR_CONNECTION_RESET` on the actual
auth call. This is a browser-traffic-specific restriction in the environment's
proxy, not an app bug. `curl "$HTTPS_PROXY/__agentproxy/status"` shows the raw
denials.

Consequence: **no cloud session can produce a screenshot, a demo clip, or any
click-through verification of this app.** Behavioural changes there get verified
by reading code and calling the real backend functions directly. That is a real
gap, not a formality — see below.

Separately, admin-level Supabase auth endpoints (listing/minting users) are
blocked by the cloud session's permission classifier. Don't try to route around
either restriction.

---

## Unverified merged work — the actual backlog risk

Five user-visible features merged in the last few days. **Every one was verified
by unit tests and code reading only.** None has been seen working by a human or a
browser. If something is quietly broken in the app right now, it is most likely
one of these.

| Merged | What to look at | What "wrong" looks like |
|---|---|---|
| **#368** — modal focus trap + dialog semantics, all 8 modals | Open each modal, Tab through it, press Escape, close it | Focus escapes to the page behind; Escape doesn't close; after closing, focus is on `<body>` instead of the button you opened it with. **The riskiest of the five** — it rewires focus in 8 places and its trigger-restore mechanism was rewritten late (see below). |
| **#367** — pantry filter bar → 3 multi-select facets | `/pantry`, combine location + category + expiry filters | OR-within-facet / AND-across-facets is wrong; an empty facet filters everything out instead of nothing |
| **#362** — `estimated_expiry` flag + "(est.)" suffix | Add an item without an expiry date, see if the badge reads "(est.)"; then edit the date by hand | The "(est.)" suffix survives a manual correction (it shouldn't) |
| **#371** — `ReviewSurface` extraction + the `/scan` route | `/scan` and `/pantry?add=scan` — both mount the same review surface | The two paths diverge; confirm semantics differ between them |
| **#366** — real OpenFoodFacts barcode lookup | Scan/enter a real barcode | **The live API was never called even once** — the sandbox couldn't reach it. This is untested against the real service, full stop. |

**On #368 specifically.** It shipped, but its focus-restore mechanism changed at
the last minute and only jsdom has ever exercised the new path. The hook
originally captured "what had focus before the modal opened" by reading/writing
refs in the render body; CI's `react-hooks/refs` lint rule rejected that, so it
now uses a module-level `focusin` tracker (`nextjs/src/hooks/useModalFocusTrap.ts`).
The jsdom test for it was proven non-vacuous (the fallback was deliberately broken
and the test failed), but jsdom is not a browser. **Real-browser focus behaviour
for this hook has never been observed.** Worth 10 minutes with a keyboard.

Also never verified anywhere: **screen-reader announcement** (VoiceOver/NVDA) for
the `role="dialog"` / `aria-modal` / `aria-labelledby` wiring. Only the DOM
attributes were asserted.

---

## Live state — 2026-09-11

### Open PRs (2)

- **PR #360** — *feat: render 'Update what I'm cooking' block for recipe
  amendments*. Frontend half of the cook-flow amendment loop; closes issue #303.
  **Draft, `mergeable_state: dirty`, untouched since Sep 5, 65 commits behind
  main.** Three things to know before touching it:
  1. Its stated blocker **has cleared** — PR #355 (issue #302, the backend that
     emits the amendment proposal) merged as `2739038`.
  2. Real merge conflict in `nextjs/src/app/chat/page.tsx`, which has changed a
     lot on main since. Not a trivial import collision.
  3. **This code was merged to main once and reverted** — `cde66fa` then
     `0e68d63`, and the revert commit gives **no reason**. Nobody has established
     why. It may simply have landed ahead of its backend dependency, which is now
     resolved — but that's inference, not record. Settle this before merging.
  4. You asked for a demo of this flow on Sep 5 and never got one, because of the
     browser restriction above. **You can now actually produce it.**

- **PR #124** — *docs: plan for gamification + the live kitchen*. Long-standing
  draft, design doc only. Held: high risk, medium value, not MVP. No action.

### `ready-for-agent` queue (2)

- **Issue #375** — *WorkflowState.proposal union doesn't include recipe
  amendments, and model_dump() erases the type*. Triaged this session. **Sequence
  after PR #360**, since #360 is the consumer of the proposal shape this fixes.
  Related: `nextjs/src/hooks/useChat.ts:266` duck-types proposals via
  `!!proposal && proposal.actions.length > 0` — a different proposal kind on the
  same path is exactly what breaks.
- **Issue #183** — *Backfill expiry estimates for existing pantry rows*.
  **Newly unblocked.** It was held on #182's migration being *applied*, not just
  merged — and you applied `00008_add_pantry_estimated_expiry.sql` on your
  machine. Nothing is stopping this now.

### Open issues: 48 total

Two `ready-for-agent` (above), three `ready-for-human` that specifically need a
browser (#351, #352, #345 — the local session's lane), the rest triaged or
awaiting decisions.

**Awaiting your decision, not agent work:**
- **Issue #376** — *`get_recipe` declares `-> RecipeCard | None` but returns a raw
  dict, and every caller works around it.* The fix is easy; the question is
  whether the contract should become the declared type or the honest dict. Your
  call, it ripples to every caller.
- **Issue #332** — *the app is a hard login wall* — product decision on guest/demo
  mode. Also blocks easy demo recording.
- **Issue #331** — *no way to sign out of the app.* Small, but it blocks
  multi-user manual testing, which matters more now that you're testing locally.

---

## Tech-debt finding: the mypy baseline is badly stale

Found while writing this handoff, not previously reported.

`ai-service/mypy-baseline.txt` holds **106 entries**. Actual current errors:
**36**. PR #377 fixed far more than its own slice claimed — `supabase_repo.py`
went **73 → 4** — and the baseline was never re-synced afterward.

The gate still exits 0, because `scripts/mypy_gate.sh` passes `--allow-unsynced`.
That flag is there deliberately (without it, *resolving* a baselined error fails
CI, which is absurd), but the cost is now visible: **70 stale entries mean a
genuinely reintroduced error could match one of them and pass silently.** The
gate itself prints the remedy on every run:

```
Great work! Please, run `mypy . | mypy-baseline sync`
```

**Fix:** `cd ai-service && ./scripts/mypy_gate.sh --sync`, then commit the
regenerated baseline. One command, no code change. Worth doing before anyone
picks up the rest of issue #128.

Remaining 36 errors for #128 slice 2, by file:

```
6  workflows/router.py            3  workflows/chat/nodes.py     2  api/routes/ingest.py
5  workflows/product_ingest.py    3  api/routes/scan.py          2  api/ingest_dispatcher.py
4  repository/supabase_repo.py    2  workflows/recipe/nodes.py   1  services/url_extractor.py
3  workflows/receipt_ingest.py    2  workflows/ingest_spine.py   1  api/auth.py
                                  2  main.py
```

Note issue #128's title still says "73 errors" — stale, it's 36 now.

---

## Findings worth not re-deriving

Things the previous sessions established at real cost. Don't spend the time again.

- **Issue #370** — *a cleanly-resolved pantry-add turn wipes item continuity.*
  This is the root cause of one of the three symptoms in your issue #361 report.
  It is a **deterministic code bug, not LLM behaviour** — `router.py:812`, in
  `update_session_node`: the whole `pending_proposal` block is gated on
  `if state.get("requires_review")`, and the `else` branch sets
  `session.pending_proposal = None`, wiping the only place cross-turn item memory
  lives. **A model swap will not fix this.** The other two symptoms in your
  screenshots (a proposal card not rendering, a missing clarification row) were
  never traced — they need a browser, so they're yours now.

- **`deduct_pantry_item`'s missing-name fallback is NOT a bug.** It looks
  unreachable and it is: `pantry_items.name` is `TEXT NOT NULL`
  (`00001_initial_schema.sql:27`). Recorded so nobody investigates it a third time.

- **Issue #311** — *high-confidence pantry proposals render a card whose approve
  button silently no-ops.* Cause is identified: `useChat.ts:426-443` only
  populates `pendingProposals` when `requires_review === true`. Not re-verified
  recently — worth confirming it's still live before picking it up, which is now
  a 2-minute browser check for you.

- **Gemini model** is now `gemini-3.1-flash-lite` (`ai-service/bubbly_chef/config.py:18`),
  up from `gemini-2.5-flash`. Your own prior research (in your worknotes repo)
  concluded cost is a rounding error at this volume ($0.55–$6/month across all
  options) and that **tool-calling reliability, not price, is the real decision
  variable** — and that self-hosting is a privacy/learning choice, not an
  economic one. Issue #202 is where that decision lives.

- **`mypy-baseline`'s exit code** is `new_count + fixed_count` unless
  `--allow-unsynced` is passed. This is not documented anywhere obvious and it
  cost a full debugging cycle: the gate failed when an error was *fixed*. See
  `ai-service/scripts/mypy_gate.sh`, and don't remove that flag without also
  keeping the baseline synced.

---

## Environment notes

- **`ai-service` tests need the venv interpreter**: `./.venv/bin/python -m pytest -q`.
  System `pytest` lacks `httpx` and dies at collection.
- **`nextjs` gates**: `npx tsc --noEmit`, `npx eslint src/ --max-warnings=-1`,
  `npx jest`. Current clean baseline: tsc clean, eslint **0 errors / 3 warnings**
  (all pre-existing — an unused var in `assumed-staples.test.tsx`, a stale
  disable in `PantryProposalCard.tsx`, an `<img>` LCP warning in `RecipeBook.tsx`),
  jest **39 suites / 351 tests**.
- **CI runs eslint**, and it is a real gate — PR #368 went red on it while `tsc`
  and jest were both clean. `eslint-plugin-react-hooks` v6's `react-hooks/refs`
  rule is strict about render-phase ref access. Run eslint locally before pushing.
- **Multiple sessions have worked this repo concurrently.** Always check live PR
  state before branching on anything; `docs/QUEUE.md` is a checkpoint, not a feed.

---

## Process reminders that bit us

- **Never cite a bare issue/PR number** — say whether it's an issue or a PR, give
  the title, and add a plain-language line on what it actually is. `CLAUDE.md`
  has the full rule.
- **TL;DR at stopping points, not every message** (PR #378 rescoped this after
  the original rule caused TL;DR spam).
- **Drafts cannot be merged while draft.** A "merge them all" pass silently skips
  every draft PR; check state rather than assuming.
- **The review gate is two-tier**: `/code-review` (agent-invocable) allows opening
  a PR; `thermo-nuclear-review` (human-only) is required to merge. An agent must
  never record the thermo-nuclear marker.
