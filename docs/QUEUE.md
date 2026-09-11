# Queue

**Updated:** 2026-09-11 · by the cloud agent session · `main` @ `841027d` ·
handing off to a local session — see `docs/HANDOFF.md`

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🔴 Five merged features have never been seen working

This is the real risk right now, and it outranks everything below. Five PRs
merged on unit tests and code reading alone — no browser, no screenshots, no human
click-through, because the cloud sandbox can't drive one:

- **PR #368** — *feat(a11y): shared focus trap + dialog semantics for all 8 modals*
  (closes issue #291). Rewires keyboard focus in every modal in the app.
- **PR #367** — *feat(pantry): filter bar → 3 multi-select facets* (closes issue
  #228). Location/category/expiry filtering on `/pantry`.
- **PR #362** — *feat(pantry): estimated-expiry flag* (closes issue #182). Marks a
  guessed expiry date with an "(est.)" suffix so a heuristic isn't mistaken for fact.
- **PR #371** — *refactor(scan): extract ReviewSurface + add the `/scan` route*
  (closes issue #259). Two entry points now share one review UI.
- **PR #366** — *feat(scan): real OpenFoodFacts barcode lookup* (closes issue #308).
  **Its live API has never been called even once** — the sandbox couldn't reach it.

`docs/HANDOFF.md` has the table: what to open, and what "wrong" looks like for each.
A local session can clear all five in well under an hour.

### 🟡 One command, worth doing first — the mypy baseline is stale

`ai-service/mypy-baseline.txt` holds **106 entries**; there are actually **36**
errors. PR #377 fixed more than it claimed (`supabase_repo.py` went 73 → 4) and
nobody re-synced. The gate exits 0 anyway because of `--allow-unsynced`, so
**70 stale entries could mask a genuinely reintroduced error.** The gate prints
the remedy on every run:

```bash
cd ai-service && ./scripts/mypy_gate.sh --sync   # then commit the baseline
```

Do this before anyone picks up the rest of issue #128.

---

## Open PRs (2)

- **[PR #360](https://github.com/ayushb3/BubblyChef/pull/360)** — *feat: render
  "Update what I'm cooking" block for recipe amendments*. The frontend half of the
  cook-flow amendment loop; closes issue #303. **Draft, conflicted, 65 behind main,
  untouched since Sep 5.** Its stated blocker has cleared (PR #355 merged), but it
  has a real conflict in `nextjs/src/app/chat/page.tsx` and — more importantly —
  **this code was merged and reverted once before** (`cde66fa` → `0e68d63`) with no
  reason recorded. Settle that before resuming. You also asked for a demo of this
  flow on Sep 5 and never got one; a local session can finally produce it.

- **[PR #124](https://github.com/ayushb3/BubblyChef/pull/124)** — *docs: plan for
  gamification + the live kitchen*. Design doc only, long-standing draft. Held
  deliberately: high risk, medium value, not MVP. No action needed.

---

## Ready to pick up

### `ready-for-agent` (2)

- **[#375](https://github.com/ayushb3/BubblyChef/issues/375)** —
  *WorkflowState.proposal union doesn't include recipe amendments, and
  `model_dump()` erases the type.* Triaged this session. **Sequence after PR #360**
  — that PR is the consumer of the shape this fixes. Related smell:
  `nextjs/src/hooks/useChat.ts:266` duck-types proposals via
  `!!proposal && proposal.actions.length > 0`.
- **[#183](https://github.com/ayushb3/BubblyChef/issues/183)** — *Backfill expiry
  estimates for existing pantry rows with no expiry date.* **Newly unblocked** —
  it was held until #182's migration was *applied*, not just merged, and that's
  now done.

### Browser-dependent — the local session's lane

(#351 and #352 carry `ready-for-human`; #345 does not — see its note.)

- **[#351](https://github.com/ayushb3/BubblyChef/issues/351)** — *feat(e2e):
  Playwright demo flows — full app happy-path walkthrough.* Highest leverage of
  the three: it produces the demo clips that make every future PR reviewable
  without a live session.
- **[#352](https://github.com/ayushb3/BubblyChef/issues/352)** — *test(e2e): full
  Playwright regression suite, CI-gated, all modules.*
- **[#345](https://github.com/ayushb3/BubblyChef/issues/345)** — *test(e2e):
  cook-confirm + receipt stubbed specs fail on a production server*, masked by
  dev-server partial hydration. Reproducible locally; was not reproducible from
  the cloud. **Labelled `tech-debt`/`frontend`/`module:infra`, not
  `ready-for-human`** — it belongs in this lane by nature of needing a browser,
  but it won't appear in a `ready-for-human` filter.

---

## Awaiting your decision (not agent work)

| # | Kind | What it is |
|---|---|---|
| **376** | issue | *`get_recipe` declares `-> RecipeCard \| None` but returns a raw dict, and every caller works around it.* The fix is easy; the question is whether the contract becomes the declared type or the honest dict. Ripples to every caller. |
| **332** | issue | *The app is a hard login wall* — no landing page, no demo, no guest mode. Product decision. Also makes demo recording harder than it needs to be. |
| **331** | issue | *No way to sign out of the app.* Small, but it blocks multi-user manual testing — which matters more now that testing is local. |
| **202** | issue | *Decide production AI provider(s) + tool-calling parity strategy.* Model is now `gemini-3.1-flash-lite`. Your own prior research: cost is a rounding error at this volume; tool-calling reliability is the real variable. |

---

## Closed out since the last queue write

All merged, all PRs. Titles are exact.

| PR | What it was |
|---|---|
| **#368** | *feat(a11y): shared focus trap + dialog semantics for all 8 modals (#291)* — keyboard focus no longer escapes an open modal |
| **#377** | *fix(types): narrow Supabase rows at the boundary — 96 → 36 mypy errors (#128 slice 1)* |
| **#378** | *docs: TL;DR belongs at stopping points, not on every message* — rescoped a CLAUDE.md rule that was causing summary spam |
| **#365** | *ci(ai-service): gate new mypy errors behind a checked-in baseline (#309)* — new type errors fail CI; pre-existing ones don't |
| **#362** | *feat(pantry): persist estimated_expiry flag, show it in the UI (#182)* — "(est.)" marks a guessed date |
| **#367** | *feat(pantry): multi-select filter facets for location, category, expiry (#228)* |
| **#366** | *feat(ingest): replace stubbed product lookup with real OpenFoodFacts API (#308)* |
| **#371** | *refactor(scan): extract ReviewSurface, add /scan route (#259)* — one shared review UI for both scan entry points |
| **#353** | *fix(chat): resolved clarification pills disappear; strip combined context prefix (#341, #342)* |
| **#355** | *feat: cooking-mode turns emit structured recipe amendment proposals (#302)* — the backend PR #360 was waiting on |

Eight more merged in the same window. **Five of these change behaviour too** —
don't read this as a docs-only tail:

| PR | What it was |
|---|---|
| **#374** | *chore(ai): default to gemini-3.1-flash-lite, refresh model docs (#231)* — **a live model swap.** Every AI response in the app now comes from a different model than when most of this work was written. Unverified against real output. |
| **#354** | *feat(pantry): base-unit backfill on write (#224) + assume culinary staples in recipes (#305)* — user-visible on both the pantry write path and recipe generation |
| **#350** | *feat(chat): inline quantity/unit clarification on pantry proposal cards (#340)* — user-visible chat UI |
| **#349** | *fix(chat): empty pantry prompts to stock, not invent recipes (#243)* — user-visible chat behaviour |
| **#343** | *fix(chat): the active conversation survives navigating away* — user-visible chat behaviour |
| **#372** | *docs(queue): final refresh — ready-for-agent queue cleared this session* — docs only |
| **#373** | *docs: message-format conventions — TL;DR, action items, and unambiguous citations* — docs only |
| **#359** | *docs(queue): refresh after 6 draft PRs opened; file #356/#357/#358* — docs only |

**PR #374's model swap deserves its own look.** Nobody has compared actual model
output before and after. Issue #361's chat symptoms were reported against the old
model; the one symptom that was traced (issue #370) is a deterministic code bug
that a model swap will *not* fix, but the two untraced symptoms could plausibly
have changed behaviour either way.

Issue **#182**'s migration (`00008_add_pantry_estimated_expiry.sql`) is **applied**
in Supabase — confirmed by you.

---

## Still untraced

- **Two of the three symptoms in [#361](https://github.com/ayushb3/BubblyChef/issues/361)**
  — a proposal card not rendering, and a missing "not sure" clarification row.
  The third symptom was traced to a real deterministic bug, filed as
  [#370](https://github.com/ayushb3/BubblyChef/issues/370). These two need a
  browser and were never investigated.
- **[#311](https://github.com/ayushb3/BubblyChef/issues/311)** — cause identified
  (`useChat.ts:426-443` only populates `pendingProposals` when
  `requires_review === true`) but not re-verified recently. Now a 2-minute check.
- **Behavioural eval for expiry-vs-coherence.** #288, #336 and #347 are all
  prompt/weight fixes verified *structurally*. Nobody has measured actual model
  output.
- **Recent-chats list UI.** #265's triage split this out; persistence only, never filed.

---

## Environment notes

- **`ai-service` tests need the venv interpreter**: `./.venv/bin/python -m pytest -q`.
  System `pytest` lacks `httpx` and fails at collection.
- **`nextjs` clean baseline**: `tsc` clean · `eslint src/` **0 errors, 3 warnings**
  (all pre-existing) · `jest` **39 suites / 351 tests**.
- **CI runs eslint and it is a real gate.** PR #368 went red on it with `tsc` and
  jest both clean — `eslint-plugin-react-hooks` v6's `react-hooks/refs` rule is
  strict about render-phase ref access. Run it locally before pushing.
- **`mypy --strict`: 36 errors** (was 96), gated not blocking. Fixing them is #128.
- **The cloud sandbox cannot drive a browser against this app** — Supabase and
  third-party APIs are unreachable from browser traffic specifically, while `curl`
  and the dev server reach both fine. Admin Supabase auth endpoints are separately
  blocked by the permission classifier. Full detail in `docs/HANDOFF.md`.
- **Multiple sessions have worked this repo concurrently.** Check live PR state
  before branching on anything, not just this doc.

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what
changed in plain behaviour, screenshots for anything visual, what was actually
verified and how, and an explicit list of what is *not* covered. If a PR body does
not do that, it is not finished.
