---
type: spec
created: 2026-09-13
updated: 2026-09-13
spec: A
status: draft
parent-map: 272
depends-on: [spec-0]
---

# Spec A — Cook flow coherence

Second spec of the 5-spec master roadmap
(`docs/plans/2026-09-13-issue-triage.md`). Depends on **Spec 0** (#410) for the
typed proposal + pinned-recipe-by-id foundation. `#272` (`wayfinder:map`) is the
master map this spec formalizes.

Makes cook-along coherent end to end along the #272 spine:
**brainstorm → pick → refine → check pantry/expiry → guided cook → correct
deduction → clean done-state.** The bugs here come from state-management
shortcuts, not a wrong framework — Spec 0 fixed the chat-state roots; Spec A
fixes the cook-flow surface built on top.

Sequence: **#273 (prototype, keystone) → #279 → #303 + PR #360 → #263 → #281 →
#222 + #298 → #284 → #209 → #264.**

---

## Problem Statement

"Cook with me" enters a mode but the experience falls apart along the way:

- Tapping "Cook with me" pins the recipe and drops the user into general chat
  with **no step UI** — a COOKING banner appears but nothing else changes, so
  it's unclear what the feature did (#263, #272 baseline).
- A **mid-cook amendment is lost.** Told there's no cream, Bubbles suggests a
  roux and even produces a corrected 12-item ingredient list — but only as chat
  prose. The pinned recipe is never touched, the banner still reads the old
  count, and "Finished cooking" deducts against the recipe the user *didn't*
  cook (phantom cream shortfall, un-deducted butter/milk) (#279, #303).
- The **deduction numbers are wrong or read as broken.** A `unit_conflict`
  badge fires on nearly every matched ingredient, forcing manual entry
  everywhere (#209); "4 slices bread" against a "1 item" loaf would remove the
  whole loaf (#222); basic seasonings show as blocking shortfalls (#209/#281).
- **"Not in pantry" is a dead end** — bare warning chips with no substitute and
  no explanation, even when Bubbles just suggested a swap for that exact
  ingredient in chat moments earlier (#281).
- **Expired items are used silently** in grounding and cooking, with no warning
  to clear them first (#264).

The user perceives: "I don't know what cooking mode does," "it forgot my
substitution," "the deduction is broken," and "it's telling me I'm short on a
full loaf of bread."

## Solution

The cook flow becomes a legible, correct end-to-end experience:

- **Guided cooking is a real flow** — an optional prep screen then
  step-by-step instruction screens (shape decided by the #273 prototype), with
  Bubbles answerable about the current step, a clear done-state that exits the
  mode cleanly, and the source recipe card locked once cooking starts.
- **A mid-cook amendment updates what you're cooking** — rendered as a distinct
  "Update what I'm cooking" block (not a new recipe card), which PATCHes the
  pinned recipe's ingredients **in place** (same row, same cook session) so the
  banner and the later deduction both follow the amended list.
- **The deduction is honest** — a clean deduct is the common path, not the
  exception; piece-against-package resolves to `imprecise` (nothing deducted,
  row stamped) per ADR 0003 rather than destroying a package; basic seasonings
  are assumed on hand; compound substitutions actually deduct their components.
- **"Not in pantry" offers a path** — a substitute (including compound swaps)
  or, when there's none, a one-line reason.
- **Expired items are flagged before cooking**, with a prompt to clear them.

## User Stories

1. As a cook, I want a step-by-step guided flow after "Cook with me", so that I
   can follow the recipe without scrolling a wall of text.
2. As a cook, I want an optional prep/mise-en-place screen I can skip, so that I
   can prep ahead or as I go, my choice.
3. As a cook, I want to ask Bubbles about the current step, so that I get help
   in context without losing my place.
4. As a cook, I want a clear "finished cooking" done-state, so that the mode
   exits cleanly and the COOKING banner doesn't linger afterward.
5. As a cook, I want the source recipe card to lock once I start cooking, so
   that I don't accidentally start a second recipe or a second deduction.
6. As a cook, I want a mid-cook substitution ("no cream, use a roux") to update
   the recipe I'm cooking, so that the banner and deduction reflect what I
   actually made.
7. As a cook, I want the amendment shown as an "Update what I'm cooking" block
   with a single action, so that it's clear this changes my active recipe, not
   an offer to start a new one.
8. As a cook, I want the post-amendment suggestion chips to be cook-context
   ("What can I substitute?", "How do I prep this?"), not brainstorm chips
   ("Try another"), so that I'm not invited back into brainstorm mid-cook.
9. As a cook, I want "Mark as cooked" to show clean deduct amounts for
   obviously-matched ingredients, so that I'm not forced to hand-type a quantity
   for nearly every row.
10. As a cook, I want basic seasonings (salt, pepper, oil, water) assumed on
    hand, so that staples I don't track aren't flagged as blocking shortfalls.
11. As a cook cooking "4 slices bread" against a one-loaf pantry row, I want the
    deduction to not remove the whole loaf, so that a small use doesn't destroy
    a package I still have.
12. As a cook, I want a pantry row I used imprecisely to be stamped (which
    recipe, when), so that I can see its count may have drifted and correct it.
13. As a cook, I want a missing ingredient to show a substitute where one
    exists, so that "not in pantry" is a path forward, not a dead end.
14. As a cook, I want a compound substitute (cream ← butter + milk + flour) to
    actually deduct its components when I cook, so that my pantry reflects what
    I used.
15. As a cook, I want a one-line reason when there's no good substitute ("no
    stand-in — the sauce will be thinner"), so that a bare warning chip isn't
    the whole answer.
16. As a cook, I want to be warned about expired matched ingredients before
    cooking and offered to clear them, so that I don't cook with spoiled items.
17. As a cook, I want the deduction to run against the recipe I actually cooked
    (amended, seasoning-assumed, imprecise-safe), so that my pantry is right
    afterward in both directions.

## Implementation Decisions

**Depends on Spec 0 (#410):** the amendment work (#279/#303) needs the typed
proposal + `CookProposal`-in-union from #375, and the in-place refine/amendment
render needs the picked recipe pinned by real id. Do not start #303 until Spec 0
lands #375.

### Keystone — #273 prototype (do first, HITL)

`#273` is a `wayfinder:prototype` ticket, not implementation. Run `/prototype`
to produce a cheap artifact deciding, for mobile-first / max-width 480px:

- **Step presentation:** all-steps-scrollable vs one-step-advanceable card.
- **Deduction-preview placement:** before cooking (#267), inline, or at the end.
- **Done-state:** what "finished cooking" looks like and how it exits the mode
  cleanly (#268).
- **Recipe-card lock:** the locked/active state once "Cook with me" is tapped
  (#269).
- **Timers:** in or out of v1 (timers themselves are Spec B / #45).

The prototype seeds #263, #267, #268, #269. **#263 cannot be built precisely
until #273 is resolved** — its ticket is blocked on the prototype outcome. Link
the artifact from #273 on resolution.

### #279 + #303 — amendment updates the pinned recipe (backend done, wire the rest)

- Backend already emits a structured amendment proposal (PR #355 / #302 merged):
  amendment flag, full amended ingredient list, change summary, marked
  `requires_review`, nothing written until confirmed.
- **#303 / PR #360** (OPEN, branch `feat/issue-303-cooking-amendment-ui`) renders
  it as a `CookingAmendmentCard` — an in-thread "Update what I'm cooking" block,
  **not** a recipe card (no Cook/Save/Try-Another). Confirming updates the
  in-memory cooking recipe so the deduction uses the amended list.
- **The apply write path** (open question from #303): applying the amendment
  PATCHes the **pinned** recipe's ingredients in place — same row, same cook
  session. Decide draft-row vs saved-library-recipe behavior; a saved library
  recipe should not be silently mutated by a one-off cook amendment.
- **Cook-context chips** replace brainstorm chips on this path — `COOKING_SUGGESTIONS`
  already exists but isn't used here (#279 "also wrong").
- Open sub-decisions to settle in the ticket: full amended list vs only-changed;
  whether a second amendment stacks on the first; declining = inert block vs
  explicit dismiss.

### #263 — guided step-by-step flow (blocked on #273)

- Optional prep/mise-en-place screen (skippable) → one-step-per-screen
  instruction UI with Bubbles answerable about the current step. Exact shape
  from the #273 prototype. Replaces today's "pin + drop into general chat".

### #281 — "Not in pantry" gets a path

Three separable problems (per the issue):
1. **Compound substitutions expressible** — `IngredientMatch` can resolve to
   more than one pantry item (the suggestion half shipped in PR #284). Schema
   move; enables #284's deduct work.
2. **Say why when there's no sub** — surface the model's already-generated
   under-15-word note instead of discarding it for `match_type: "none"`.
3. **Separate "missing" from "assumed"** — staples (salt/pepper/oil/water) are
   assumed on hand, not blocking shortfalls (shared with #209).

### #222 + #298 — piece-unit deduction correctness (respects ADR 0003)

- ADR 0003 is decided: piece-against-package is **incommensurable**; the flow
  reports `imprecise` (ingredient satisfied, nothing deducted, row stamped)
  rather than a `shortfall` that destroys a package. Genuine conversion via
  `PIECE_WEIGHTS_G` still runs first when the row has a real mass base.
- **#222 safety half landed** (PR #297): `status="imprecise"`, `PIECE_UNITS` /
  `PACKAGE_UNITS` exported, cook review distinguishes imprecise from shortfall.
- **#298 (remaining):** a migration adding an imprecise-use stamp column
  (recipe + timestamp) with RLS matching existing pantry policies; the cook
  confirm path writes the stamp on a confirmed `imprecise` match (still
  deducting nothing); the pantry UI surfaces the stamp on the row; model +
  repository plumbing. `pieces_per_package` and backfill are explicitly out of
  scope (ADR closing paragraph). #222 stays open until #298 lands.

### #284 — deduct compound substitutions

- Suggestion half shipped; the deduct half breaks the one-pantry-item-per-
  ingredient assumption across `match_ingredients` (`consumed` keyed on a single
  id), `IngredientMatch` (single `pantry_item_id`/`deduct_qty` → list),
  `DeductionItem` / `/cook/confirm` (one row per match), and `summariseDeductions`
  / the modal table.
- **Settle first (open question, currently `needs-info`):** per-component
  quantities. Options: model returns per-component quantities (validated like
  component names), user confirms amounts in the modal like `unit_conflict`
  inputs, or treat compound swaps as always-unresolved and let the user type
  quantities (reuses existing machinery). **Recommend the third to start** —
  lowest new machinery, reuses the unit-conflict input path.

### #209 — unit-conflict UX + assume seasonings (`ready-for-agent`)

- Root cause confirmed at `cook_matcher.py:347`: `unit_conflict` fires whenever
  `normalize_to_base_unit` returns `(None, None)` (unknown units `bag`/`bunch`/
  `loaf`, unregistered names) or dimensions differ, with no cross-dimension
  bridge. The clean-deduct path is the exception, not the rule.
- Two fixes: (a) a fallback when normalization fails so obvious matches don't
  degrade to manual entry; (b) assume basic seasonings on hand rather than
  first-class deductible/missing (shared with #281 item 3). Cross-dimension
  conversion generally is #6 (out of scope here).

### #264 — expired-item pre-cook warning (`ready-for-agent`)

- Before entering cook mode, flag expired **matched** ingredients and offer to
  navigate to pantry to clear them. Sits at the pre-cook pantry-check step of
  the spine.

## Testing Decisions

Good tests assert external cook-flow behavior, not routing internals. Seams,
highest-value first:

1. **Cook deduction (`match_ingredients` / cook confirm) — master backend seam.**
   Given (recipe lines, pantry rows) assert the resolved match status and
   deduction per line. Covers #209 (clean deduct vs unit_conflict, seasonings
   assumed), #222/#298 (piece-vs-package → `imprecise`, nothing deducted, stamp
   written on confirm), #284 (compound swap deducts its components). Table-driven
   over the unit/package/piece/compound cases. Prior art: existing cook_matcher
   tests + PR #297's imprecise cases.
2. **Amendment apply → pinned recipe.** Confirming an amendment updates the
   pinned recipe's ingredients in place and the subsequent deduction runs
   against the amended list (no phantom shortfall for the removed item, the
   substitute's components deducted). Covers #279/#303. Depends on Spec 0's typed
   proposal round-trip. Prior art: PR #360's `cooking-amendment-card.test.tsx`
   (frontend) + cook confirm tests (backend).
3. **Pre-cook expired-item gate (#264).** Given a recipe matching an expired
   pantry row, the pre-cook check flags it and offers the clear path. Fold into
   the pre-cook pantry-check tests rather than a new seam.
4. **Guided-cook UI (#263).** Component/interaction tests for step advance,
   skip-prep, and clean done-state (banner cleared). Shape gated on #273; write
   after the prototype resolves. Prior art: existing chat/cook component tests.

Prefer existing seams; add none where these suffice.

## Out of Scope

- **Chat state machine / escape-hatch / typed session** — Spec 0 (#410).
- **General cross-dimension unit conversion** (count↔weight↔volume) — #6.
- **`pieces_per_package` on pantry rows + backfill** — deferred by ADR 0003.
- **Timers as a feature** — Spec B / #45 (the #273 prototype only decides
  whether v1 steps *carry* a timer affordance).
- **Saved-recipe lookup, grocery list, notification center, context-aware
  chips, meals-not-one-dish** — Spec B.
- **Ingest / pantry-add correctness** — Spec C.
- **Silent mutation of a saved library recipe** by a one-off cook amendment —
  explicitly avoided; a cook amendment targets the cook-session/draft row.

## Further Notes

- **#272 stays open as the map** until its child tickets land; it is not itself
  implemented. This spec is its formalization; `/to-tickets` on the published
  Spec A issue produces the vertical slices.
- **PR #360 is real and open** on `feat/issue-303-cooking-amendment-ui`; its
  blocker (#302 backend) merged as PR #355. It needs a rebase onto Spec 0's
  typed proposal before it can land cleanly.
- **ADR 0003** governs the piece-vs-package decision — do not re-litigate;
  implement to it.
- Build order after Spec A: Spec B / Spec C in parallel → Spec D. Alternative:
  pull #45 (timers) and #186 (saved-recipe lookup) forward from Spec B alongside
  Spec A for demo value.
