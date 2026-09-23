# Spec A — Manual Test Plan (Cook-with-me flow)

**Parent:** Spec A (issue #412) — the "Cook with me" flow chain.
**Status:** none of these have merged yet. This is a **pre-merge** test plan — run each
phase against its PR branch before merging that PR.

**Hard root dependency:** Spec A is rooted on **Spec 0 (#410)**. In particular PR #360
(the amendment UI) is the frontend half of bug #279, which is blocked by #410. **Do not
merge any Spec A PR until Spec 0 is fully in** (PR #436 / #416 + #417). See
`2026-09-13-spec-0-manual-test-plan.md` for Spec 0 itself.

**Baked-in sequence** (from the tickets):
`#273✅ → #279/#303 (PR #360) → #263 (PR #431) → #281 → #222+#298 → #284 → #209 (PR #430) → #264 (PR #429)`

## What exists vs what's built

| Merge phase | PR | Issue | UI-facing? | Built? |
|---|---|---|---|---|
| A-1 | #432 | #424 compound-sub schema | no (test-only) | ✅ |
| A-1 | #433 | #425 say-why-no-substitute | no (test-only) | ✅ |
| A-1 | #434 | #426 assume-seasonings | no (test-only) | ✅ |
| A-2 | #360 | #303 (+#279) amendment UI | **yes** | ✅ |
| A-3 | #431 | #263 guided cook flow | **yes** | ✅ |
| A-4 | #281 | 'Not in pantry' dead-end | yes | ❌ not built |
| A-4 | #222 + #298 | piece-unit over-deduct | yes | ❌ not built |
| A-4 | #284 | deduct compound subs | yes | ❌ needs #432 first |
| A-5 | #430 | #209 unit-conflict fallback | **yes** | ✅ |
| A-6 | #429 | #264 expired precook warning | **yes** | ✅ |

> **A-1 is CI-only.** #432/#433/#434 are pure test coverage — no production behaviour
> change. There is **nothing to click**. Their "manual test" is: the CI suite passes and
> `./scripts/mypy_gate.sh` shows 0 new. They pin schema/messaging contracts so later
> refactors can't drift them silently. Merge them whenever; they gate nothing behavioural.

---

## Setup (do once)

Same as the Spec 0 plan: backend on 8888, frontend on 3000, sign in as `test@bubbly.local`,
seed the pantry (`python scripts/seed_pantry.py`), keep devtools Network open.

For these flows you specifically need a pantry with:
- at least one **expired** item that a recipe will match (for A-6),
- an item whose **display unit differs from its base unit** — e.g. a "1 dozen" eggs row or
  a "1 kg" row (for A-5),
- a recipe with an ingredient in an **unconvertible unit** vs your pantry (e.g. "2 handful"
  vs "1 bag") (for A-5).

---

## Phase A-2 — PR #360: "Update what I'm cooking" amendment UI (#303 / #279)

**Pre-merge gate:** run `cd nextjs && npx tsc --noEmit && npm test` in the **primary
checkout** first (the worktree had no env). Recheck the PR shows mergeable — it read
`UNKNOWN` last I looked. Backend emitter #355 is already merged, so the render path will
activate.

- [ ] Pick a recipe and enter cooking mode ("Cook with me").
- [ ] Send a mid-cook amendment — **"no cream, use a roux"**.
  - [ ] **Expect:** a **`CookingAmendmentCard`** renders in-thread: 🍳 header with a change
        summary, the **full amended ingredient list** (name / qty / unit rows), and two
        buttons — **"Update what I'm cooking"** and **"Keep Original"**.
- [ ] Click **"Update what I'm cooking"**.
  - [ ] **Expect:** the card moves to an "applied" terminal state; the in-memory cooking
        recipe now uses the amended ingredient list.
- [ ] Finish cooking → deduct.
  - [ ] **Expect:** the deduction uses the **amended** list, not the original.
        *(No DB write to the library recipe row — the amendment lives in the cook session.)*
- [ ] Repeat, but click **"Keep Original"**.
  - [ ] **Expect:** card goes to "dismissed"; deduction uses the original list.
- [ ] **Last-wins note:** sending a second amendment silently supersedes the first (no
      sequencing UI — expected, out of scope). Confirm it doesn't stack or error.

---

## Phase A-3 — PR #431: step-by-step guided cook flow (#263)

Depends on #273 (✅ closed) and #410 (Spec 0). "Cook with me" / Variant E from the library.

- [ ] From the recipe **library**, start "Cook with me" on a recipe.
  - [ ] **Expect:** a **prep screen** first, then **one instruction step per screen** with
        **progress dots**, forward/back navigation between steps.
- [ ] On any step, open **"Ask Bubbles"**.
  - [ ] **Expect:** the help overlay opens; ask a step-specific question and the answer
        streams. **Regression to watch:** in devtools, the outgoing chat request must
        **not** carry `mode: 'cooking_help'` (that's a 422 — invalid mode). Step context is
        folded into the message body instead. Confirm a valid mode and a real streamed
        answer, not a silent failure.
- [ ] Navigate to the **done state** (advance past the last step).
  - [ ] **Expect:** the done state offers **"Update my pantry"** and **"Skip for now"**.
  - [ ] Click **"Update my pantry"** → **Expect:** hands off to the existing **deduction
        modal** for the same recipe (the guided flow must NOT bypass deduction — that was a
        fixed defect).
  - [ ] Click **"Skip for now"** on a fresh run → **Expect:** exits **without** deducting.
- [ ] Switch to a different recipe mid-flow → **Expect:** guided state **resets** (no stale
      step/progress carried over).
- [ ] A recipe with **empty instructions** → **Expect:** short-circuits straight to the
      done state (no blank step screen).

---

## Phase A-4 — #281 / #222 + #298 / #284 (NOT BUILT YET)

No PRs, no branches. Listed for sequence completeness — nothing to test.

- **#281** — 'Not in pantry' is a dead end (no substitute, no explanation). *ux slice.*
- **#222 + #298** — piece-unit deductions over-deduct ("4 slices" removes a whole loaf);
  #298 stamps the imprecisely-consumed row. *paired.*
- **#284** — deduct compound substitutions, not just suggest them. **Needs #432 (compound
  schema) merged first.**

When these are built, add their checklists here in sequence order.

---

## Phase A-5 — PR #430: unit-conflict soft-fallback must not corrupt stock (#209)

Merge **after** PR #434 (#426, the seasoning half of #209). This is a **data-integrity**
fix — the important test is that stock is **not silently corrupted**.

- [ ] Cook a recipe with an ingredient whose unit is **unresolvable** against the pantry
      row (e.g. recipe "2 handful" vs pantry "1 bag" — neither convertible).
  - [ ] **Expect:** that ingredient is routed to **"skipped"** with a **"can't tell how
        much"** notice — **not** silently deducted. Status is `imprecise`, `deduct_qty` is
        null.
- [ ] **The corruption regression:** cook against a row whose display unit ≠ base unit —
      e.g. a **"1 dozen"** eggs row (base 12) or a **"1 kg"** row (base 1000 g) — hitting
      the unresolvable-unit path.
  - [ ] **Expect:** **no phantom deduction.** The old bug deducted `1.0` in display units
        then read it back as base units (a "1 dozen" row lost 12, a "1 kg" row lost 1000 g)
        while the UI claimed the item was "left as it is". After this fix, stock is
        **unchanged** on that row. **Verify the actual pantry quantity before and after** —
        this is the one flow where the UI copy alone is not trustworthy evidence.
- [ ] Genuine **dimension mismatches** (mass vs count, mass vs volume) still **hard-block**
      as `unit_conflict` (unchanged) — confirm those still block rather than soft-skip.

---

## Phase A-6 — PR #429: warn before cooking with expired matched ingredients (#264)

Last in the sequence.

- [ ] Have a pantry with an **expired** item that a recipe matches. Start the cook flow for
      that recipe.
  - [ ] **Expect:** a **warning banner** listing each **expired matched** item, prompting to
        clear them before proceeding. Fresh matched items are **not** flagged.
  - [ ] Expired items render in the design-system **expired colour token** (not ad-hoc red).
- [ ] Dismiss the banner, then **switch to a different recipe**.
  - [ ] **Expect:** the dismissed state **resets** — the new recipe re-evaluates its own
        matches rather than carrying the stale dismissal.
- [ ] A pantry with a **duplicated** row of the same expired item → **Expect:** the list
      dedupes (no React key collision, no double-listing).
- [ ] Confirm the banner **only warns** — it does not auto-remove or auto-substitute; the
      cook still decides and can proceed.

---

## Sign-off (per phase, in merge order)

- [ ] A-1 (#432/#433/#434) — CI green, 0 new mypy. Merge.
- [ ] A-2 (#360) — tsc+npm-test clean in primary, amendment flow passes → merge.
- [ ] A-3 (#431) — guided flow passes, Ask-Bubbles has no 422, deduction not bypassed → merge.
- [ ] A-4 — build #281 / #222+#298 / #284 (needs #432), then extend this doc.
- [ ] A-5 (#430) — **verify real pantry quantities**, no corruption → merge.
- [ ] A-6 (#429) — expired-warning flow passes → merge.

**Reminder:** every merge here is gated on Spec 0 being fully landed first, and each merge
needs a `thermo-nuclear-review` marker (main auto-deploys prod).
