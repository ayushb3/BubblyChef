---
type: spec
created: 2026-09-13
updated: 2026-09-13
spec: 0
status: ready-for-agent
---

# Spec 0 — Foundation: Chat state machine + typed session

The foundation spec of the 5-spec master roadmap
(`docs/plans/2026-09-13-issue-triage.md`). Ships first; unblocks Specs A–D.
Kills the "follow-up does the wrong thing / app forgets context" class by
fixing the two structural roots identified in the 2026-09-13 architecture
assessment. Backend-only (`ai-service/`); no frontend feature work (the
frontend duck-type is noted as a downstream beneficiary, not fixed here).

Folds in the resolved #274 design
(`docs/plans/2026-09-13-274-recipe-followup-design.md`).

---

## Problem Statement

When cooking with BubblyChef's chat, the app does the wrong thing on
follow-ups and forgets what it just did:

- After picking a recipe, saying "make it spicier" or "add a fig glaze?"
  restarts a brand-new brainstorm and destroys the pick (#266). Cooks use
  follow-ups constantly, so the assistant fights the most natural interaction.
- A mid-cook ingredient swap ("no cream, use a roux") doesn't update the
  recipe the app thinks you're cooking, so the pantry deduction is computed
  from the original (#279).
- The classifier can correctly detect that you want a fresh recipe
  (`recipe_generation` at confidence 1.0) and the app silently serves it as a
  brainstorm anyway (#408).
- Proposals the assistant offers can lose their type when the session is
  saved and reloaded, so an amendment proposal can't be reliably rendered or
  applied (#375).

The user perceives this as: "it doesn't listen to my follow-up," "it forgot
what I was cooking," and "the confirm button did nothing."

## Solution

The chat becomes context-aware and honest about its own state:

- A **modification or exit follow-up reaches the right handler in any mode.**
  Picking a recipe and then tweaking it refines the pick in place instead of
  restarting; asking for something genuinely new starts fresh — and when the
  intent is ambiguous the assistant asks a one-tap "tweak this / start fresh"
  question rather than guessing wrong.
- The **picked recipe is remembered by identity**, so refinements land on the
  right recipe and mid-cook swaps update the recipe the app is actually
  cooking (correcting the deduction).
- **Proposals survive save/reload with their type intact**, so the approve
  button and the amendment card always act on a well-formed proposal.

## User Stories

1. As a cook, I want "make it spicier" after picking a recipe to refine *that*
   recipe, so that my follow-up improves the dish instead of throwing it away.
2. As a cook, I want "add a fig glaze?" (a modification phrased as a question)
   to be treated as a modification, so that natural phrasing isn't punished by
   a brittle prefix list.
3. As a cook, I want "actually, something else" to start a fresh brainstorm, so
   that I can back out of a pick when I change my mind.
4. As a cook, I want an always-present "Start over" affordance, so that I can
   guarantee a fresh brainstorm even if the classifier is unsure.
5. As a cook, I want the assistant to *ask* "tweak this recipe or start fresh?"
   when my follow-up is ambiguous, so that a wrong guess never silently
   destroys my picked recipe.
6. As a cook, I want the assistant to only auto-act without asking when it is
   highly confident, so that the cheap case (one extra tap) is preferred over
   the expensive case (losing my recipe).
7. As a cook, I want a mid-cook ingredient swap ("no cream, use a roux") to
   update the recipe I'm cooking, so that the pantry deduction reflects what I
   actually used.
8. As a cook, I want the recipe I picked to be remembered by identity, so that
   refinements and deductions always target the right recipe even when several
   recipes have been discussed.
9. As a cook, I want "show me the pesto one instead" to re-pick from the ideas
   already brainstormed, so that switching between suggestions doesn't cost a
   regeneration.
10. As a cook, I want a genuinely new brainstorm to replace the old idea set,
    so that I never re-pick from a stale menu.
11. As a cook mid-recipe, I want small amendments only (not a full re-brainstorm)
    while guided cooking is active, so that the flow matches having the pan hot.
12. As a user, I want an approve button on a proposal to actually add the item,
    so that saying "I bought apples" reliably updates my pantry.
13. As a user, I want a proposal I was offered to still be valid after I
    navigate away and come back, so that the pending action isn't silently lost.
14. As a developer, I want the session's proposal to carry a real, discriminated
    type through save/reload, so that the workflow and the frontend can act on
    it without duck-typing.
15. As a developer, I want a cook amendment to be a first-class proposal type in
    the workflow state union, so that the cook-amendment UI (Spec A) has a typed
    payload to render.
16. As a developer, I want session state to be a typed model instead of
    `dict[str, Any]` blobs, so that a drifted key fails loudly instead of
    silently.
17. As a developer, I want `get_recipe` to declare the type it actually returns,
    so that callers stop carrying `type: ignore` workarounds.
18. As a developer, I want session-mode to *bias* the intent classifier rather
    than *lock* it, so that a correctly-detected intent is never overridden by a
    hardcoded mode→intent table.

## Implementation Decisions

**Sequence (build order):** #375 → typed `SessionContext` → escape-hatch → #376.

### 1. Proposal union + serialization (#375)

- Add `CookProposal` to the `WorkflowState.proposal` union so a cook amendment
  is a first-class workflow proposal, not something that only exists on the
  `/v1/recipes/cook` route.
- Make the proposal round-trip through session persistence **type-preserving**:
  a serialized-then-reloaded proposal must deserialize back to the correct
  concrete type (discriminated union), not a shape-erased dict. This is the fix
  for the approve-button no-op and the vanishing pending proposal.

### 2. Typed `SessionContext` (replaces the blobs)

- Replace `ConversationSession.metadata: dict[str, Any]` and
  `pending_proposal: dict[str, Any] | None` with a typed Pydantic
  `SessionContext` model. The existing-but-unused `PendingProposalMemory`
  TypedDict is the seed of the pending-proposal shape.
- The magic-string keys currently living in `metadata` become typed fields:
  `brainstorm_ideas`, `recipe_constraints`, `last_recipe_title`, and the
  cooking-recipe reference. A key that drifts must fail at the type boundary,
  not silently read `None`.
- **Acceptance:** no `dict[str, Any]` remains in session state.

### 3. Session-mode escape-hatch (root fix for #266 / #279 / #408)

Governed by the resolved #274 design — do not re-derive it.

- **Classifier-primary routing.** The hardcoded mode→intent forcing table (the
  `mode_intent_map`) stops *forcing* intent. Session mode **biases** the
  classifier; it never hard-locks it. An intent outside the previously-forced
  one is reachable while a mode is active. This replaces the brittle hardcoded
  modification-prefix list.
- **Explicit chips are a deterministic override.** An explicit `[Edit this
  recipe]` / `[Start over]` chip forces its route regardless of classifier
  output, for users who want certainty. `[Start over]` is always present as the
  guaranteed exit to open brainstorm.
- **Conservative bias.** When ambiguous, stay on the picked recipe
  (accidental-modify is cheap and recoverable; accidental-brainstorm destroys
  the pick — the #266 failure).
- **Confirm band (#274 Q5).** Auto-act only on **high** confidence. On **low OR
  medium** confidence for the modify-vs-new-dish decision, emit a one-tap
  confirm ("tweak this recipe / start fresh") via the envelope's review/confirm
  path rather than guessing. Exact high-confidence cutoff tuned in
  implementation; it hangs off the existing `intent_confidence`.
- **#408 downgrade fix.** The `recipe_generation`→`recipe_brainstorm` silent
  downgrade is fixed as part of this rework — a high-confidence
  `recipe_generation` is served as generation, not brainstorm.
- **COOKING-mode amendments** stay narrow: mid-cook, only small
  amendments are allowed (via the existing amendment detector), which update
  the pinned recipe and its deduction (#279). Full modify / brainstorm is
  RECIPE_EXPLORING / pre-cook only.
- **Note / correction to the #274 design doc:** that doc described
  `_detect_amendment` (`chat/nodes.py`) as COOKING-mode-only. Recon shows it in
  fact runs on **any** cooking-help turn that has a pinned recipe. The
  implementation must gate amendment-vs-refine on the *mode + pinned state*
  explicitly rather than assuming the detector is COOKING-scoped.

### 4. Pin the picked recipe by real id (#274 Q4 — hard requirement)

- A recipe picked in RECIPE_EXPLORING must set `pinned_recipe_id` to the
  recipe's real id (today only the COOKING handoff pins a real id; the
  RECIPE_CARD path nulls it). Identity currently lives in a
  `last_recipe_title` string, which is why "which of these three pasta cards is
  active?" is ambiguous.
- In-place card replacement on refine (Spec A / #303 rendering) depends on the
  pick being a real referenced object, so this pin is a prerequisite, not
  optional.

### 5. Brainstorm-set lifecycle (#274 Q6)

- Retain the brainstorm idea list in session context. "show me the pesto one
  instead" re-picks from the stored set with **no regeneration**. Invalidate
  the set **only** when a genuinely new brainstorm runs. (Surfacing un-picked
  ideas as tap-to-switch chips is Spec B / #317, not here.)

### 6. `get_recipe` contract (#376) — honest dict

- Change the declared return type of `get_recipe` to the **dict shape it
  actually returns**, and drop the `type: ignore` at the callers that already
  treat it as a dict. (Decision: honest dict over parsing to `RecipeCard`,
  since callers already dict-wrap the result — lowest churn.)

### Modules touched (no file paths — may drift)

- Chat router / intent classification (the God file whose session-transition
  and forcing logic is the escape-hatch root).
- Session model + session-context typing.
- Workflow state proposal union + its serialization path.
- Cook amendment proposal type (added to the union).
- Recipe repository read contract.

## Testing Decisions

Good tests here assert **external behavior at the highest seam**, not internal
routing bookkeeping. Three seams, master first:

1. **`classify_intent` (master seam).** Given a `(session mode, message,
   confidence)` triple, assert the resolved intent and whether a confirm is
   required. This is where escape-hatch, conservative bias, and the confirm
   band all resolve, so it covers #266 (follow-up modifies, not restarts), #279
   (mid-cook amendment path), the #408 downgrade (high-confidence generation
   stays generation), and #274 Q1/Q2/Q5. Table-driven cases across the modes
   and confidence bands. Prior art: existing intent-routing / classifier tests
   in the chat workflow test suite.
2. **Session round-trip (serialize → deserialize).** A proposal — including
   `CookProposal` — must survive `model_dump()` then reload with its concrete
   type intact; a picked recipe's id must survive the round-trip. Covers #375
   and the pin requirement. Prior art: existing model serialization tests.
3. **`get_recipe` contract.** Assert the declared return type matches the actual
   returned shape (the workaround `type: ignore`s are gone and the callers
   compile clean under `mypy --strict`). Covers #376.

Do not add a new seam where these three suffice. No frontend tests in this spec.

## Out of Scope

- **Frontend rendering of amendments** (the "Update what I'm cooking" block,
  #303 / PR #360) — Spec A. Spec 0 only provides the typed proposal it renders.
- **Un-picked ideas as tap-to-switch chips** (#317) — Spec B.
- **Chat history window / context length** (#384) — Spec A/B; separate plan
  (`docs/plans/2026-09-13-chat-history-window-384.md`).
- **Guided step-by-step cooking UI** (#263), substitutes-on-"not in pantry"
  (#281), piece-unit deduction math (#222) — Spec A.
- **The frontend proposal duck-type** (`useChat.ts`) — noted as a downstream
  beneficiary of the typed proposal; not refactored here.
- **`get_recipe` parsing into a real `RecipeCard`** — explicitly rejected in
  favor of the honest-dict contract.
- The de-dupe of `_format_history_context` between `recipe/nodes.py` and
  `chat/nodes.py` — a sibling refactor, tracked with #384, not Spec 0.

## Further Notes

- **Recon drift corrections** (handoff line numbers were stale; live code
  verified 2026-09-13): forcing table is `mode_intent_map` (not at the cited
  313-338 range); it includes a fourth mapping `PANTRY_EDITING → PANTRY_UPDATE`
  not listed in the handoff; the brittle prefix list is a distinct, shorter
  block; the picked recipe is pinned with a real id only on the COOKING handoff
  and nulled on the RECIPE_CARD path.
- **Architecture verdict (do not rewrite):** the LangGraph graph shape,
  `ProposalEnvelope[T]` pattern, and `AIManager` / `SupabaseRepository` layers
  are sound. Spec 0 is two targeted structural fixes, not a rewrite.
- After Spec 0: Spec A (cook flow coherence) → Spec B / Spec C in parallel →
  Spec D. Alternative if front-loading demo value: pull #45 (timers) and #186
  (saved-recipe lookup) forward alongside Spec A.
