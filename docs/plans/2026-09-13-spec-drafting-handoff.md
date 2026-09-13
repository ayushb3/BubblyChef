---
type: handoff
created: 2026-09-13
updated: 2026-09-13
---

# Handoff — Draft the BubblyChef Master Specs (start with Spec 0)

You are picking this up in a **fresh context session**. Your job is to draft the
master specs designed during the 2026-09-13 triage, **starting with Spec 0** (the
foundation), using the `/to-spec` workflow. Everything you need is on disk and
linked below — read the three source docs first, then draft.

## What already happened (so you don't redo it)

A triage + architecture session on 2026-09-13 categorized all ~50 open issues
through a **personal-project lens** (owner's own cooking companion + resume piece +
share with family/friends — NOT a production app), decided the cook/chat flow needs
**no rewrite** (two targeted structural fixes instead), and designed a **5-spec
roadmap**. Issue #274 was fully grilled to a resolved 6-decision design. The Gemini
model bug (stale `.env` serving `gemini-2.5-flash`) was fixed by the owner locally —
config now serves `gemini-3.1-flash-lite`. **Not your concern; do not touch `.env`.**

Two new issues were filed from that session: **#407** and **#408** (the #408
snack/downgrade bug — see below).

## Read these first (source of truth)

1. **`docs/plans/2026-09-13-issue-triage.md`** — the full triage: 50 issues bucketed
   + ranked, the architecture assessment (the two structural roots), the 5-spec
   roadmap with build order, and an addendum (Spec B notification-center reshape +
   QA issues #395–#406 fold-in). **This is the master map.**
2. **`docs/plans/2026-09-13-274-recipe-followup-design.md`** — the resolved #274
   design (6 decisions). **This shapes Spec 0's escape-hatch behavior.** Fold it in.
3. **`docs/plans/2026-09-13-chat-history-window-384.md`** — existing implementation
   plan for issue #384 (chat history window). Already written; Spec A / Spec B
   territory, not Spec 0. Reference, don't rewrite.

## The two structural roots (what Spec 0 fixes)

From the architecture assessment — both are in the triage doc, restated so you have
them without a second read:

1. **`router.py` is a God file (~1506 lines) whose session-mode logic forces
   intent.** A hardcoded **mode → intent forcing table** (`COOKING → cooking_help`,
   `RECIPE_EXPLORING → recipe_brainstorm`, `INGESTING → pantry_update`) means any
   intent outside the forced one is unreachable while a mode is active. This is the
   root of **#266** (follow-up restarts brainstorm instead of modifying) and
   contributes to **#279**. Fix: extract session transitions into a real state
   machine + add a **modification/exit escape-hatch** in `classify_intent` so
   certain intents override the forced route. `_detect_amendment`
   (`chat/nodes.py:447`) is the existing pattern to extend.
2. **`ConversationSession` uses stringly-typed catch-all blobs** —
   `metadata: dict[str, Any]` and `pending_proposal: dict[str, Any] | None`. This is
   why proposals lose type on serialization (**#375**), why `CookProposal` is missing
   from the `WorkflowState.proposal` union, and why the frontend duck-types proposals
   (`useChat.ts:266`). Fix: typed `SessionContext` Pydantic model + add `CookProposal`
   to the union.

## Spec 0 scope (draft this one first)

**Foundation: Chat state machine + typed session.** Kills the "follow-up does the
wrong thing / app forgets context" class. Contents:

- **#375** — *WorkflowState.proposal union doesn't include recipe amendments, and
  `model_dump()` erases the type* (issue, `ready-for-agent`, ~2 files). Proposal
  union + serialization fix.
- **#376** — *`get_recipe` declares `-> RecipeCard | None` but returns a raw dict*
  (issue, awaiting-decision). Pick a contract: honest declared type vs honest dict.
- **Session-mode escape-hatch** (new work) — the `classify_intent` override; root
  fix for #266/#279. **Its behavior is defined by the #274 design doc** (Q1 classifier-
  primary + chip override + mode-biases-not-locks; Q5 confirm-band on low-OR-medium
  confidence). Read that doc — do not re-derive.
- **Typed `SessionContext`** (new work) — replace the `metadata` /
  `pending_proposal` blobs.
- **Pin the picked recipe by real id** — hard requirement from #274 Q4 (today
  `router.py:710` sets `pinned_recipe_id=None` on a recipe card; only COOKING pins a
  real id at `:680`). In-place refine rendering depends on this.
- **Feed-forward fix for #408** — the escape-hatch rework is where the
  `recipe_generation`→`recipe_brainstorm` silent downgrade gets fixed (logs showed
  classifier returning `recipe_generation` at confidence 1.0, served as brainstorm).

**Sequence inside Spec 0:** #375 → typed `SessionContext` → escape-hatch → #376.
**Acceptance:** proposals round-trip with type intact; modification follow-ups reach
the right handler in any mode; no `dict[str, Any]` in session state; honest
`get_recipe`; picked recipe pinned by id.

## The other four specs (draft after Spec 0, in build order)

Full contents in the triage doc §Part 3 + addendum. Summary:

- **Spec A — Cook flow coherence.** #272 is its `wayfinder:map` master. Sequence:
  #273 → #279 → #303 + PR #360 (needs Spec 0 #375) → #263 → #281 → #222 + #298 →
  #284 → #209 → #264.
- **Spec B — Recipe intelligence.** Reshaped around a **notification center as the
  hub (#43)**: timers (#45) as a cooking-session dock feeding inbox completions;
  grocery list (#42) on its own `/grocery` route the inbox points to. Plus #186
  (saved-recipe lookup, do first), #317 (context-aware chips), #289 (meals not one
  dish), and **#395** (profile cooking-context — allergies as hard constraints, a
  core-value pillar). Ship a **lite inbox first** (badge + dropdown, compute-on-load).
- **Spec C — Ingest & pantry input** (correctness-heavy). #311, #370, #358, #356,
  #363, #357, #254, #183, plus QA issues #404/#398/#402/#406/#403/#400/#396.
- **Spec D — Auth & demo polish** (small, pick off individually). #331, #332, #389,
  #337, plus QA polish #405/#401/#399/#397.

**Build order (approved):** Spec 0 → Spec A → Spec B / Spec C in parallel → Spec D.
Alternative if front-loading demo value: pull #45 and #186 forward alongside Spec A.

## How to draft

Per `CLAUDE.md`: each spec becomes one `/to-spec` (idea already shaped) → published
as a GitHub Issue → later `/to-tickets` → vertical-slice child issues. Draft Spec 0
first and get it right before the others — it unblocks everything. Save any design
docs under `docs/plans/` with a `YYYY-MM-DD-` prefix.

## Guardrails (carried from the triage session)

- **Do NOT touch or print `ai-service/.env`** — it holds live secrets (Supabase
  service key, Gemini API key, JWT secret) and is gitignored. The model fix is done.
- **Do NOT relabel / re-triage the QA-owned issues** (#395–#406 and the deferred
  list). A parallel QA session owns their triage state. You *reference* them in specs;
  you don't change their labels.
- The owner is **not** QA-ing chat or recipes in the other session — this spec work
  is the major chat/recipe effort, so those surfaces are yours to shape.
- Deferred / not-in-any-spec (tracked only, don't spec): #128, #129, #130, #345,
  #352, #351, #255, #321, #202, #301, #189, #194, #193, #190, #191, #46.

## Git state

Triage doc, its addendum, and the #274 design doc are committed on branch
`worktree-issue-triage-doc` (worktree under `.claude/worktrees/issue-triage-doc`) and
pushed. This handoff lives there too. If you start Spec drafting in a fresh session,
you'll likely want a fresh branch off `main` per the repo's
`feat/issue-<n>-<slug>` convention.
