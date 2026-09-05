# Queue

**Updated:** 2026-09-05 · by an agent session · ready-for-agent queue fully cleared this
session (#182, #309, #308, #228, #291, #259) — all in PRs. Also verified #353 (another
session's PR) and found the real root cause behind part of #361.

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🟢 Ready to merge — green CI, no blockers

- [PR #364](https://github.com/ayushb3/BubblyChef/pull/364) — docs: queue refresh.
- [PR #366](https://github.com/ayushb3/BubblyChef/pull/366) — **#308**: real OpenFoodFacts
  barcode lookup. Live API itself untested (this sandbox's browser/network can't reach it —
  see environment notes below) — worth a manual check before relying on it in prod.
- [PR #367](https://github.com/ayushb3/BubblyChef/pull/367) — **#228**: pantry filter bar →
  3 multi-select facets (location/category/expiry).
- [PR #353](https://github.com/ayushb3/BubblyChef/pull/353) — **#341 + #342** (another
  session's PR, verified this session): resolved clarification pills disappear, raw context
  prefix stripped from replies. Rebased onto current `main` (was behind), verified correct —
  690 pytest / 301 jest, `tsc` clean. **Does not fix #361** — see below.
- [PR #371](https://github.com/ayushb3/BubblyChef/pull/371) — **#259**: extracts
  `ReviewSurface` (presentation-only tiered scan review) out of the pantry-add sheet, adds
  the `/scan` route `CLAUDE.md` already claimed existed. CI still running as of this write —
  check before merging.

### 🟡 Draft, needs a migration applied — #182

[PR #362](https://github.com/ayushb3/BubblyChef/pull/362) adds
`supabase/migrations/00008_add_pantry_estimated_expiry.sql` (additive). Needs the Supabase
dashboard SQL Editor or `supabase db push` — an agent session can't do this. Safe to merge
before applying; the UI feature just won't show up until the column exists.

### 🟡 Draft, CI-config change — #309

[PR #365](https://github.com/ayushb3/BubblyChef/pull/365) adds a mypy baseline gate to CI.
Held as draft on purpose — CI-pipeline changes are treated as feature-level here regardless
of how green they are.

### 🟡 Draft, feature-level (8-component scope) — #291

[PR #368](https://github.com/ayushb3/BubblyChef/pull/368) — shared focus trap wired into all
8 modals. Two review passes (one specifically re-scrutinizing the shared hook's React
correctness) found and fixed two latent risks before this PR existed. Held as draft: worth
`/interrogate` before merge given the scope. Screen-reader behavior (VoiceOver/NVDA)
couldn't be verified headlessly.

---

## #361 — investigated, root cause filed separately

You filed #361 with screenshots showing inconsistent chat pantry-add behavior. Traced one of
the three symptoms ("lost the previous context of apples and eggs") to a real bug: a
cleanly-resolved pantry-add turn (nothing left unclear) explicitly wipes
`session.pending_proposal = None` in `router.py`, which is the only place item-name
continuity across turns lives — so a later vague turn genuinely has no memory of what was
just added. **Filed as [#370](https://github.com/ayushb3/BubblyChef/issues/370)**, with the
exact trace and a suggested fix shape. Confirmed this is *not* something PR #353 touches or
was ever meant to fix — #353's own body flags the adjacent territory as #307-followup,
out of scope. The other two symptoms in your screenshots (a proposal card not rendering, a
missing "not sure" clarification row) look like separate frontend issues — not traced, no
visual repro possible in this sandbox (see below).

---

## Ready to pick up

**Empty.** Everything that was on this list at the start of the session (#309, #308, #182,
#311, #228, #302, #291, #259) is now merged, drafted, or claimed by another session —
except #311, which wasn't re-verified this session (worth a quick check that it's still
real before anyone picks it up next).

**Held:**
- **#183** — backfill expiry estimates. Blocked by **#182**, specifically until its
  migration is *applied*, not just merged.

**Taken (open PR from another session, verified or left as noted):**
- **#341 + #342** → [PR #353](https://github.com/ayushb3/BubblyChef/pull/353) — verified
  correct this session, see above. Ready to merge.
- **#302** → [PR #355](https://github.com/ayushb3/BubblyChef/pull/355) — not touched, was
  behind `main` last checked.
- **#303** → [PR #360](https://github.com/ayushb3/BubblyChef/pull/360) — not touched, was
  dirty (real conflict) last checked, blocked on #355 anyway.

---

## New tickets filed this session

- **#363** — the manual "type it in" pantry-add path never sets `estimated_expiry` on a
  guessed date. Blocked on #182's migration landing.
- **#370** — the `pending_proposal = None`-on-clean-turn bug behind part of #361 (see above).

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
| **361** | Chat pantry-update loses context / inconsistent card rendering. Root cause of one symptom filed as #370; two others (card not rendering, missing clarification row) still untraced. |
| **363** | *(new — see above)* |
| **370** | *(new — see above)* |

---

## Not yet filed

- **Recent-chats list UI.** #265's triage split this out — persistence only.
- **Behavioural eval for expiry-vs-coherence.** #288, #336, #347 are all prompt/weight
  fixes verified structurally. Nobody has measured the actual model output yet.
- **Stale `priority_items` label in `GROUNDED_RECIPE_SYSTEM_PROMPT`.** Cosmetic only,
  post-#347.

---

## Environment notes for the next session

- **`ai-service` tests need the venv interpreter**: `./.venv/bin/python -m pytest -q`.
  System `pytest` lacks `httpx` and fails at collection.
- **`mypy --strict` has 94 pre-existing errors** (#128), gated (not blocking) once #309
  merges. Until then, still not run in CI at all.
- **`npm run lint` has 2 pre-existing `e2e/` errors.** Expected baseline.
- **This sandbox's browser can't reach Supabase or the live OpenFoodFacts API**, even
  though `curl` and the Next.js dev server reach both fine from the same sandbox. Tried
  explicit Playwright proxy config, localhost bypass, and `--ignore-certificate-errors` —
  all hit `ERR_CONNECTION_RESET` on the actual auth/API call. This looks like a
  browser-traffic-specific restriction in this environment's proxy, not an app bug. Means:
  no interactive click-through verification is possible from a cloud session here —
  verify behavioral changes by reading the code + running the real backend functions
  directly (as this session did for #353/#361), not by trying to drive a browser.
  `curl "$HTTPS_PROXY/__agentproxy/status"` shows the raw proxy denials if you hit the
  same wall.
- **Admin-level Supabase auth endpoints (listing/minting users) are blocked by this
  session's permission classifier**, on top of the browser issue above — don't try to work
  around either restriction; report the limitation and verify some other way instead.
- **Multiple sessions are working this repo concurrently.** Check live PR state before
  branching on anything, not just this doc.

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what changed in
plain behaviour, screenshots for anything visual, what was actually verified and how, and an
explicit list of what is *not* covered. If a PR body does not do that, it is not finished.
