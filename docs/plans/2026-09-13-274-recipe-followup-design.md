---
type: design
created: 2026-09-13
updated: 2026-09-13
issue: 274
---

# #274 Resolved Design — chat state machine for picked-recipe follow-ups

Outcome of a `/grilling` session on issue #274 (*Decision: follow-up on a picked
recipe — modify vs new brainstorm*). This is the decided behavior; it feeds
**Spec 0** (foundation) implementation. Parent map: #272. Directly fixes #266;
implicitly fixes the #408 generation→brainstorm downgrade.

## The problem #274 asks to solve

When a recipe has been picked in chat and the user sends a follow-up ("make it
spicier", "no dairy", "actually something else"), what happens? Today (#266) *any*
follow-up restarts brainstorm and destroys the pick, because `router.py`'s
mode→intent forcing table pins `RECIPE_EXPLORING → recipe_brainstorm` and the
user's real intent is never read.

## Relevant code facts (from recon, with file:line)

- **A modification check already exists** but is brittle: `router.py:313-338` has a
  hardcoded prefix list (`"no "`, `"less "`, `"more "`, `"without "`, `"add "`,
  `"make it "`, `"swap "`, `"replace "`, `"substitute "`, `"change "`,
  `"remove the "`, `"skip the "`, `"drop the "`). "make it spicier" matches; "add a
  fig glaze?" and "spicier please" miss and fall through to forced brainstorm.
- **A picked recipe is NOT pinned by id.** `router.py:710` sets
  `pinned_recipe_id = None` on a recipe card; only COOKING pins a real id
  (`:680`). Identity lives in `metadata["last_recipe_title"]` (a string).
- **`/v1/recipes/refine` exists and works** (`recipes_ai.py:119-166`) — takes a
  recipe dict + prompt, returns a revised recipe — but **chat never calls it**;
  only the recipe-library modal does (`RecipeRefinementModal.tsx:55`).
- **`_detect_amendment`** (`chat/nodes.py:447`) is **COOKING-mode only** — the
  narrow "swap one ingredient mid-cook" detector, unrelated to RECIPE_EXPLORING
  refinement.
- **Signals already available:** `intent_confidence` on every branch;
  `extract_selected_recipe` name-match; `metadata["brainstorm_ideas"]` /
  `["last_recipe_title"]` / `["recipe_constraints"]`; `Intent.RECIPE_CARD` carries
  `selected_recipe_name`.

## The 6 decisions

### Q1 — Primary routing signal
**Classifier-primary**, replacing the brittle prefix list at `router.py:313-338`.
Explicit chips (e.g. `[Edit this recipe]`) act as a deterministic override for
users who want certainty. **Session mode biases the classifier, never hard-locks
it** — this is the Spec 0 "escape-hatch": an intent can override the forced
mode→intent mapping.

### Q2 — Exit affordance (back to open brainstorm)
Classifier can exit to brainstorm **and** an always-present `[Start over]` chip
guarantees it. Classifier **biased conservative**: ambiguous → stay on the recipe.
Rationale — accidental-modify is cheap (recipe still there, tweak again);
accidental-brainstorm *destroys* the pick, which is exactly #266. Old recipe
remains **recoverable via scrollback**; no explicit undo state.

### Q3 — Interaction with guided-cooking (COOKING) mode
COOKING mode allows **narrow amendments only** — via the existing
`_detect_amendment` — which update the pinned recipe + deductions (satisfies
#279). Full modify / brainstorm is **RECIPE_EXPLORING / pre-cook only**. Matches
how the code already splits the two paths. Real behavior: mid-cook you make small
swaps ("no cream, use a roux"), you don't re-brainstorm with the pan hot.

### Q4 — How a modify renders
**In-place card replacement + a lightweight "updated" indicator** (not a silent
swap). Reuses `/v1/recipes/refine` as the engine; new work is wiring chat to call
it and rendering the update marker. **Consequence:** in-place replacement requires
the picked recipe to be a real referenced object → **Spec 0 must start pinning the
picked recipe by id** (today `router.py:710` nulls it). Avoids the "three pasta
cards, which is active?" confusion (#358/#266).

### Q5 — The modify-vs-new-dish boundary (the fuzzy middle)
Bias toward refine (non-destructive) with an escape chip, **and confirm — "tweak
this recipe / start fresh" — whenever confidence is low OR medium.** Only auto-act
on **high** confidence. A confirm costs one tap; a wrong guess destroys the recipe
or refines when the user wanted fresh options — the asymmetry favors asking.
Hangs off the existing `intent_confidence`; exact high-confidence cutoff tuned in
implementation. Principle: **when in doubt, ask — don't guess.**

### Q6 — Brainstorm-set lifecycle
**Retain** the brainstorm idea list in `metadata["brainstorm_ideas"]`; a later
"show me the pesto one instead" **re-picks from the stored set** via
`extract_selected_recipe` with **no regeneration**. **Invalidate the set only when
a genuinely new brainstorm runs** (never re-pick from a stale menu). Surfacing the
un-picked ideas as tap-to-switch chips is **Spec B #317** polish, not Spec 0.

## Feed-forward to Spec 0

1. **Fix the generation→brainstorm downgrade (#408).** Logs show the classifier
   returns `recipe_generation` at confidence 1.0 but the turn is served as
   `recipe_brainstorm`. The Q1 escape-hatch rework is where this is fixed.
2. **Pin the picked recipe by real id** — a hard requirement (Q4), not optional.
3. The classifier replaces the `router.py:313-338` prefix list; `intent_confidence`
   drives the Q5 confirm band.

## Out of scope for this design (noted, not decided here)

- Un-picked-ideas-as-chips UI → Spec B #317.
- Full amendment-proposal typing (`CookProposal` missing from the
  `WorkflowState.proposal` union) → #375, part of Spec 0's proposal work but a
  distinct slice.
