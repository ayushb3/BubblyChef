# Queue

**Updated:** 2026-09-05 · by an agent session · after #306/#314/#315/#322 landed; #334 (dashboard frontend) and #335 (#288) opened; auth audit filed #330–#332

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🔴 Local-session work — #330 and #334 need a real browser

Neither can be finished from a cloud session.

**#330 — sign-up may fail silently.** Step one is checking whether email confirmation is
enabled on the Supabase project. If it's **on**, signup succeeds with no session, bounces the
user back to `/login` with no message, and their second attempt errors "User already
registered" — looks broken, is actually nearly-successful. If it's **off**, this drops to a
low-priority robustness fix. **Unverified either way.**

**#334 — dashboard needs eyes.** Tests are green but nothing has been visually confirmed. The
thing to watch: whether the suggestion card ever contradicts the greeting above it ("Good
morning" over a card saying "tonight"). That's the #306 regression risk and no test can settle
it — the copy is LLM-written and the prompt constraint is a preference, not a guarantee.

Supabase/Gemini creds are container env vars, not `nextjs/.env.local` — `npm run dev` works
as-is.

### 🟡 Awaiting review

| PR | What | Note |
|---|---|---|
| [#334](https://github.com/ayushb3/BubblyChef/pull/334) | Dashboard tip + suggestion wired to `/v1/dashboard/daily` | `Fixes #225` + `#168`. Needs thermo-nuclear. |
| [#335](https://github.com/ayushb3/BubblyChef/pull/335) | Expiring stock becomes a preference, not a requirement | `Fixes #288`. No blockers in review. |

---

## In flight

| # | What it does for a user | State |
|---|---|---|
| **265** | Chat survives navigating away instead of losing the thread | Starting now |
| **336** | Recipe card stops forcing expiring items into an otherwise coherent dish | Starting now |

---

## Recently landed

- **#225** + **#168** — dashboard tip is per-user and pantry-grounded; suggestion is ranked, not
  random. Backend [#328](https://github.com/ayushb3/BubblyChef/pull/328) merged; frontend in
  [#334](https://github.com/ayushb3/BubblyChef/pull/334).
- **#306** — suggestion card opens the recipe it names and matches the clock. [PR #318](https://github.com/ayushb3/BubblyChef/pull/318).
- **#314** — `BubblesFeed` and its orphaned `BubbleMessage` deleted (330 lines that never
  rendered). [PR #325](https://github.com/ayushb3/BubblyChef/pull/325).
- **#315** — recipe detail page rendered blank ingredient rows for string-shaped ingredients.
  [PR #323](https://github.com/ayushb3/BubblyChef/pull/323).
- **#322** — editing a recipe destroyed `preparation`/`optional` on every row, including
  untouched ones. [PR #324](https://github.com/ayushb3/BubblyChef/pull/324).
- **#304**, **#307** — earlier session.

---

## Ready to pick up

Ordered by value, not by number. "Blocks" are load-bearing, not preferences.

| # | What it does for a user | Value | Size |
|---|---|---|---|
| **224** | Pantry writes populate `quantity_base`/`unit_base` | Silent data gap; **do before #305** | S |
| **305** | Salt/pepper/oil stop showing as "Not in pantry" | Makeable recipes look broken | S |
| **309** | New type errors fail the build | Ratchet — errors grew 73 → 168 in ~5 weeks because nothing gates them | S |
| **308** | Real OpenFoodFacts lookup instead of the stub | Product scan returns nothing useful | S |
| **182** | Estimated expiry dates distinguishable from real ones | **Must precede #183** — otherwise the backfill is irreversible | S |
| **311** | High-confidence pantry proposals render an approve button that silently no-ops | More user-visible half of #307 | S |
| **228** | Pantry filters by expiry and category | Large pantries unusable without them | M |
| **302** | Cooking-mode turns propose structured recipe amendments | Deductions currently run against the wrong recipe | M |
| **291** | Focus trap on modals, landmark structure | Keyboard and screen-reader users blocked | M |
| **259** | Ingest review surface split from its entry point | Refactor; no user-visible change | M |

**Held:**
- **#183** — backfill expiry estimates. Blocked by **#182** (one-way data loss if reversed).
- **#243** — empty pantry should prompt to scan, not invent recipes. Blocked until **#312 merges**.

**Serialize, do not run concurrently:** #224 → #305 (pantry/cook matching).

---

## Awaiting triage

| # | What |
|---|---|
| **330** | Sign-up appears to fail silently — user bounces back to `/login` with no message, though the account exists. **Unverified**; check the Supabase email-confirmation setting first. |
| **331** | There is no sign-out anywhere in the app. Also blocks manual verification of anything per-user, since you cannot switch accounts without clearing storage. |
| **332** | The app is a hard login wall — no landing page, no demo, no guest mode. A visitor sees nothing before creating an account. Product decision, not a bug. |
| **336** | Recipe-card generation still says expiring items should be used "first". #335 fixes the brainstorm list; this is the dish still arriving with banana in it. Two paths reach it: the direct `recipe_card` intent, and a coherent chosen idea. |
| **337** | The `middleware` file convention is deprecated. That file *is* the auth layer — on a future Next.js upgrade it silently stops running and every protected route opens. Fails open. |
| **316** | PR review gate. Diagnosed: it fires correctly when the marker matches real HEAD; the false positive is **worktree-specific**. Avoidable by working in the main checkout. |

---

## Not yet filed

- **A "recent chats" list UI.** #265's triage split this out deliberately — that issue is
  persistence-only. Browsing and switching between past conversations is a larger UX surface
  and needs designing before it is ticketed.
- **A real behavioural eval for the expiry-vs-coherence prompts.** Both #288 and #336 are
  prompt-level fixes verified only by asserting on the rendered prompt — LLM behaviour cannot
  be pinned deterministically. One eval across both prompts would answer the open question in
  #288's body: whether prompt-level is sufficient, or a compatibility signal in
  `score_and_rank` is genuinely needed. **Nobody has measured yet.**

---

## Notes for the next session

- **`ai-service` tests need the venv interpreter**: `./.venv/bin/python -m pytest -q`. The
  system `pytest` lacks `httpx` and fails at collection — that is the environment, not the code.
- **`mypy --strict` has ~94 pre-existing errors** (#128), not run in CI. Do not fix them;
  confirm new files add none.
- **`npm run lint` has 2 pre-existing `e2e/` errors.** Expected baseline.
- **`nextjs/e2e/` has no auth spec at all** — relevant to #330, #331 and #337.
- **Supabase/Gemini creds are container env vars**, not `nextjs/.env.local`. The app runs.

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what changed in
plain behaviour, screenshots for anything visual, what was actually verified and how, and an
explicit list of what is *not* covered. If a PR body does not do that, it is not finished.
