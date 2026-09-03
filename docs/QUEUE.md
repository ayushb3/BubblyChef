# Queue

**Updated:** 2026-09-02 22:40 · by an agent session · after opening PR #313 (#304) and finishing #306 through review

> Rewritten whenever queue state changes. It is a checkpoint, not a live feed — nothing
> updates it while no session is running, so trust the timestamp above. If two sessions
> work this queue at once, whichever writes last wins and the other's progress may be missing.

---

## Needs you

Three flags, in the order I'd spend your attention.

### 🔴 Blocked — PR for #306 cannot be opened

The dashboard fix is finished, pushed, and reviewed. The review-gate hook is blocking the
draft PR because **it reads the wrong commit**: it resolves HEAD from the session's working
directory rather than from the branch being proposed, so in a worktree session it gates on an
unrelated commit (here, untouched `main`) that has no marker and never will.

The only marker that satisfies it as invoked is a `thermo-nuclear-review` one, which only you
can produce. **I did not create that file** — forging it would fake the one signal in this
workflow that means a human looked.

To unblock, either run thermo-nuclear-review on `fix/issue-306-dashboard-suggestion`, or, if
two passing code-review axes are enough for a *draft*, record the create-tier marker:

```bash
touch "/Users/I589687/Documents/Personal/BubblyChef/.git/worktrees/caveman-ultra-8ce828/code-review-2b128dc8753cafbeaa753c65327722487ff0288f"
```

The hook bug is filed as **#316**. It blocks every worktree session identically, and the
escape hatch it suggests is one an agent must not take — worth fixing before the next
worktree-based ticket, not after.

### 🟠 Found something worse — #315 outranks most of the queue

While screenshotting #306 I landed on a recipe detail page whose **ingredient list renders
three empty rows** — right row count, no text. Steps render fine.

This is the page you cook from. A saved recipe is unusable at the exact moment it is needed,
and it fails silently: no error, correct row count, so it reads as a styling glitch. Pre-existing,
not caused by any current work. Plausibly higher value than several `ready-for-agent` tickets
sitting ahead of it. Currently `needs-triage`.

### 🟡 Judgment call — #314, mount or delete `BubblesFeed`

`BubblesFeed.tsx` is not imported or rendered anywhere. It reads as a live dashboard surface,
so #306's fix was applied to it — correct, but unexercised and unscreenshottable.

Mount it or delete it is a product-intent question, not a cleanup, so I filed it rather than
picking. Until it's decided, "selection logic exists in one place" has two callers and one
live one.

---

## In flight

| # | What it does for a user | Value | State |
|---|---|---|---|
| **306** | Suggestion card sends you to the recipe it named, and stops saying "tonight" at breakfast | Acting on the suggestion currently loses it | Reviewed, pushed, **PR blocked** ↑ |
| **304** | Mid-cook replies stop offering brainstorm chips that never fire | Wrong chips mid-cook | [PR #313](https://github.com/ayushb3/BubblyChef/pull/313) draft — other session |
| **307** | Approving a pantry proposal actually writes to the pantry | Silent data loss — reported success, saved nothing | [PR #312](https://github.com/ayushb3/BubblyChef/pull/312) draft, **awaiting your merge** |

Merging #312 unblocks #243.

---

## Ready to pick up

Ordered by value, not by number. "Blocks" are load-bearing, not preferences.

| # | What it does for a user | Value | Size |
|---|---|---|---|
| **265** | Chat survives navigating away instead of losing the thread | Every navigation destroys the conversation | S |
| **288** | Stops forcing expiring fruit into savoury dishes ("Chicken Potato Banana Fritters") | Suggestions are embarrassing and unusable | S |
| **224** | Pantry writes populate `quantity_base`/`unit_base` | Silent data gap; **do before #305** | S |
| **305** | Salt/pepper/oil stop showing as "Not in pantry" | Makeable recipes look broken | S |
| **309** | New type errors fail the build | Ratchet — errors grew 73 → 168 in ~5 weeks because nothing gates them; every ticket added first makes this bigger | S |
| **308** | Real OpenFoodFacts lookup instead of the stub | Product scan returns nothing useful | S |
| **182** | Estimated expiry dates distinguishable from real ones | **Must precede #183** — otherwise the backfill is irreversible | S |
| **228** | Pantry filters by expiry and category | Large pantries unusable without them | M |
| **225** | Dashboard tips generated per user, not a hardcoded weekday array | **After #306** — same hero | M |
| **302** | Cooking-mode turns propose structured recipe amendments | Deductions currently run against the wrong recipe | M |
| **291** | Focus trap on modals, landmark structure | Keyboard and screen-reader users blocked | M |
| **259** | Ingest review surface split from its entry point | Refactor; no user-visible change | M |

**Held:**
- **#183** — backfill expiry estimates. Blocked by **#182** (one-way data loss if reversed).
- **#243** — empty pantry should prompt to scan, not invent recipes. Blocked until **#312 merges**.

**Serialize, do not run concurrently:** #224 → #305 (pantry/cook matching) · #306 → #225 (dashboard hero).

---

## Recently filed, awaiting triage

| # | What |
|---|---|
| **315** | Recipe detail page: blank ingredient rows ↑ |
| **314** | `BubblesFeed` dead code: mount or delete ↑ |
| **311** | High-confidence pantry proposals render an approve button that silently no-ops — arguably the more user-visible half of #307 |
| **316** | PR review gate blocks every worktree session and asks for a human-only marker ↑ |

---

## How to read a PR from this queue

Every PR body should let you approve or reject **without opening the diff**: what changed in
plain behaviour, screenshots for anything visual, what was actually verified and how, and an
explicit list of what is *not* covered. If a PR body doesn't do that, it isn't finished.
