# Queue

**Updated:** 2026-09-11 · by the cloud agent session · `main` @ `841027d` ·
handing off to a local session — see `docs/HANDOFF.md`

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🔴 Five merged features have never been seen working

This is the real risk right now, and it outranks everything below. #368, #367,
#362, #371 and #366 all merged on unit tests and code reading alone — no browser,
no screenshots, no human click-through, because the cloud sandbox can't drive one.
**PR #366's OpenFoodFacts lookup has never called the live API even once.**

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

### `ready-for-human`, browser-dependent — the local session's lane

- **[#351](https://github.com/ayushb3/BubblyChef/issues/351)** — *feat(e2e):
  Playwright demo flows — full app happy-path walkthrough.* Highest leverage of
  the three: it produces the demo clips that make every future PR reviewable
  without a live session.
- **[#352](https://github.com/ayushb3/BubblyChef/issues/352)** — *test(e2e): full
  Playwright regression suite, CI-gated, all modules.*
- **[#345](https://github.com/ayushb3/BubblyChef/issues/345)** — *cook-confirm +
  receipt stubbed specs fail on a production server*, masked by dev-server partial
  hydration. Reproducible locally; was not reproducible from the cloud.

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

Merged: **PR #368** (#291 modal focus trap), **PR #377** (#128 slice 1, Supabase
row narrowing), **PR #378** (TL;DR rule rescope), **PR #365** (#309 mypy gate),
**PR #362** (#182 estimated-expiry), **PR #367** (#228 pantry facets), **PR #366**
(#308 barcode lookup), **PR #371** (#259 ReviewSurface), **PR #353** (#341 + #342),
**PR #355** (#302 amendment proposal), plus #372, #373, #374, #359, #354, #349,
#350, #343.

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
