# Queue

**Updated:** 2026-09-05 · by an agent session · after #312/#334/#335/#339 merged; #347/#348 filed; #330 fixed

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🔴 Local-session work — #334 still needs eyes

**#334 — dashboard needs eyes.** Tests are green but nothing has been visually confirmed.
Watch whether the suggestion card ever contradicts the greeting above it ("Good morning" over
a card saying "tonight"). That's the #306 regression risk — no test can settle it because
the copy is LLM-written and the prompt constraint is a preference, not a guarantee.

Supabase/Gemini creds are container env vars, not `nextjs/.env.local` — `npm run dev` works
as-is.

---

## In flight

| # | What it does for a user | State |
|---|---|---|
| **347** | Expiry weighting root cause — `score_and_rank` and dashboard hero | [PR #348](https://github.com/ayushb3/BubblyChef/pull/348) open, thermo-nuclear review passed, ready to merge |
| **265** | Chat survives navigating away instead of losing the thread | Ready to pick up |

---

## Recently landed

- **#347** — expiry demoted from dominant axis to tiebreaker in `score_and_rank` (±10/±5 → ±4/±2);
  dashboard hero now leads with the AI suggestion instead of the expiry headline; prompt context
  partitioning fixed to use date window instead of stale score threshold.
  [PR #348](https://github.com/ayushb3/BubblyChef/pull/348), thermo-nuclear review passed.
- **#330** — sign-up no longer silently bounces when Supabase email confirmation is on; user sees
  a "check your inbox" message instead of landing back at login with no feedback.
  [PR #346](https://github.com/ayushb3/BubblyChef/pull/346), merged 2026-09-05.
- **#312** — pantry proposal approval actually writes to the pantry (was routing to the wrong endpoint).
  [PR #312](https://github.com/ayushb3/BubblyChef/pull/312), merged 2026-09-05.
- **#336** — recipe-card generation stops forcing expiring items into a coherent dish.
  [PR #339](https://github.com/ayushb3/BubblyChef/pull/339), merged 2026-09-05.
- **#288** — expiring stock becomes a preference, not a requirement, in brainstorm.
  [PR #335](https://github.com/ayushb3/BubblyChef/pull/335), merged 2026-09-05.
- **#225** + **#168** — dashboard tip is per-user and pantry-grounded; suggestion is ranked, not
  random. Backend [#328](https://github.com/ayushb3/BubblyChef/pull/328) merged; frontend
  [#334](https://github.com/ayushb3/BubblyChef/pull/334) merged 2026-09-05.
- **#327** — chat gates vague pantry terms ("veggies", "dairy") instead of silently adding them;
  remembers pending items across turns; clarification pills now multi-select and stage text in
  the input instead of auto-sending; Skip renamed Dismiss.
  [PR #327](https://github.com/ayushb3/BubblyChef/pull/327), merged.
- **#306** — suggestion card opens the recipe it names and matches the clock. [PR #318](https://github.com/ayushb3/BubblyChef/pull/318).
- **#314** — `BubblesFeed` and its orphaned `BubbleMessage` deleted. [PR #325](https://github.com/ayushb3/BubblyChef/pull/325).
- **#315** — recipe detail page rendered blank ingredient rows for string-shaped ingredients.
  [PR #323](https://github.com/ayushb3/BubblyChef/pull/323).
- **#322** — editing a recipe destroyed `preparation`/`optional` on every row. [PR #324](https://github.com/ayushb3/BubblyChef/pull/324).
- **#304**, **#307** — earlier session.

---

## Ready to pick up

Ordered by value, not by number. "Blocks" are load-bearing, not preferences.

| # | What it does for a user | Value | Size |
|---|---|---|---|
| **243** | Empty pantry prompts to scan, not invent | Unblocked by #312 merge | XS |
| **341** | Clarification pills for already-resolved terms disappear from the card | Stale pills persist after user resolves them | XS |
| **342** | Strip `(still with…; still don't know…)` prefix — frontend regex + backend `unclear_terms` cleanup | Raw context note leaks into reply bubbles | S |
| **340** | Inline editable quantity/unit on action rows where backend defaulted to `unit: "item"` | Card shows "Eggs 1 item" even when user said "a dozen" | S |
| **224** | Pantry writes populate `quantity_base`/`unit_base` | Silent data gap; **do before #305** | S |
| **305** | Salt/pepper/oil stop showing as "Not in pantry" | Makeable recipes look broken | S |
| **309** | New type errors fail the build | Ratchet — errors grew 73 → 168; every ticket adds more | S |
| **308** | Real OpenFoodFacts lookup instead of the stub | Product scan returns nothing useful | S |
| **182** | Estimated expiry dates distinguishable from real ones | **Must precede #183** — backfill is irreversible; also reduces false urgency on expiry surfaces | S |
| **311** | High-confidence pantry proposals render an approve button that silently no-ops | More user-visible half of #307 | S |
| **228** | Pantry filters by expiry and category | Large pantries unusable without them | M |
| **302** | Cooking-mode turns propose structured recipe amendments | Deductions run against the wrong recipe | M |
| **291** | Focus trap on modals, landmark structure | Keyboard and screen-reader users blocked | M |
| **259** | Ingest review surface split from its entry point | Refactor; no user-visible change | M |

**Held:**
- **#183** — backfill expiry estimates. Blocked by **#182**.

**Serialize, do not run concurrently:** #224 → #305 · #341 → #342 (same pending_proposal flow).

---

## Awaiting triage

| # | What |
|---|---|
| **331** | No sign-out anywhere in the app. Also blocks manual per-user testing. |
| **332** | Hard login wall — no landing page, no demo, no guest mode. Product decision. |
| **337** | `middleware` file convention deprecated — on next Next.js upgrade it silently stops running and every protected route opens. Fails open. |
| **316** | PR review gate. Worktree-specific false positive. Avoidable by working in main checkout. |

---

## Not yet filed

- **Recent-chats list UI.** #265's triage split this out — persistence only. Browsing and
  switching past conversations is a larger UX surface that needs designing first.
- **Behavioural eval for expiry-vs-coherence.** #288, #336, and now #347 are all prompt/weight
  fixes verified structurally — LLM behaviour can't be pinned by unit tests. One eval would
  answer whether the changes are sufficient in practice.
- **Stale `priority_items` label in `GROUNDED_RECIPE_SYSTEM_PROMPT`.** After the #347 reweight,
  bare expiring items no longer reach `priority_items` (they land in `supporting`); the prompt
  label "Priority ingredients (expiring soon…)" is now misleading. Cosmetic only — no impact on
  output — but should be cleaned up.

---

## Notes for the next session

- **`ai-service` tests need the venv interpreter**: `./.venv/bin/python -m pytest -q`. System
  `pytest` lacks `httpx` and fails at collection — that is the environment, not the code.
- **`mypy --strict` has ~94 pre-existing errors** (#128), not run in CI. Do not fix them;
  confirm new files add none.
- **`npm run lint` has 2 pre-existing `e2e/` errors.** Expected baseline.
- **`chat-deep-links.test.tsx:156`** — 1 pre-existing Jest failure on `main` (unrelated to recent
  work). Do not treat as a regression.

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what changed in
plain behaviour, screenshots for anything visual, what was actually verified and how, and an
explicit list of what is *not* covered. If a PR body does not do that, it is not finished.
