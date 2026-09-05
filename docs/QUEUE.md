# Queue

**Updated:** 2026-09-04 · by an agent session · after #315, #322 landed on `main`; #325 (delete `BubblesFeed`) and #328 (`/v1/dashboard/daily` backend) opened

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

### 🟢 Ready to merge — #325 (delete dead dashboard component)

[PR #325](https://github.com/ayushb3/BubblyChef/pull/325) deletes `BubblesFeed` and its
orphaned `BubbleMessage` — 330 lines that never rendered. Clean deletion, reviewed, gates
green, retargeted to `main`. Closes #314.

### 🟡 Needs your review — #328 (dashboard daily endpoint, backend half)

[PR #328](https://github.com/ayushb3/BubblyChef/pull/328) — `GET /v1/dashboard/daily`.
Backend for #225 (AI-generated tip) and #168 (pantry-aware suggestion). Two review passes
found and fixed four blockers before this PR existed (UTC-only meal bucket, a hand-rolled
clock rule that disagreed with the recipe tagger 7 hours in 24, a tip prompt that wasn't
actually pantry-grounded, and a cache that kept suggesting a deleted ingredient) — details
in the PR body. `Related to`, not `Fixes`, on both issues: no UI change lands here, so the
user-visible bug is still present until the frontend PR follows.

**Frontend contract to remember:** the caller must send
`tz_offset_minutes = -date.getTimezoneOffset()` — negated, not raw.

---

## In flight

| # | What it does for a user | Value | State |
|---|---|---|---|
| **225** + **168** | Dashboard tip becomes AI-generated and pantry-grounded; suggestion becomes ranked, not random | Same tip for everyone forever; suggestion ignores pantry | Backend: [PR #328](https://github.com/ayushb3/BubblyChef/pull/328). Frontend (wires `HeroHome`, deletes `pickRandomRecipe`) not started. |
| **314** | Remove a dead second dashboard surface carrying duplicate tip/greeting logic | Correctness tax on every future dashboard change | [PR #325](https://github.com/ayushb3/BubblyChef/pull/325), ready to merge |

---

## Recently landed (since the 2026-09-02 queue)

- **#306** — dashboard suggestion opens the right recipe, matches the clock, shares one
  picker. [PR #318](https://github.com/ayushb3/BubblyChef/pull/318), merged.
- **#315** — recipe detail page rendered blank ingredient rows for string-shaped
  ingredients (the shape `RecipeEditModal` writes). [PR #323](https://github.com/ayushb3/BubblyChef/pull/323), merged.
- **#322** — editing a recipe destroyed `preparation`/`optional` on every save, even
  untouched rows. [PR #324](https://github.com/ayushb3/BubblyChef/pull/324), merged.
- **#304** — mid-cook brainstorm chips that never fired. [PR #313](https://github.com/ayushb3/BubblyChef/pull/313).
- **#307** — pantry proposal approval silently no-op'd. [PR #312](https://github.com/ayushb3/BubblyChef/pull/312).

## New tickets filed this session

- **#322** (now landed, see above) — split from #315's triage.

---

## Ready to pick up

Ordered by value, not by number. "Blocks" are load-bearing, not preferences.

| # | What it does for a user | Value | Size |
|---|---|---|---|
| **265** | Chat survives navigating away instead of losing the thread | Every navigation destroys the conversation | S |
| **288** | Stops forcing expiring fruit into savoury dishes ("Chicken Potato Banana Fritters") | Suggestions are embarrassing and unusable | S |
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
| **316** | PR review gate blocks every worktree session and asks for a human-only marker. Diagnosed this session: it fires correctly when the marker path matches real HEAD; the false-positive is worktree-specific (HEAD resolves from the session's working directory, not the branch being proposed). Avoidable today by not using a worktree — worth fixing before the next worktree-based ticket. |

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what changed in
plain behaviour, screenshots for anything visual, what was actually verified and how, and an
explicit list of what is *not* covered. If a PR body doesn't do that, it isn't finished.
