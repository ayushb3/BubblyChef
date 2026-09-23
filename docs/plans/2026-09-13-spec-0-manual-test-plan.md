# Spec 0 — Manual Test Plan (chat state machine + typed session)

**Parent:** Spec 0 (issue #410) — Foundation: chat state machine + typed session.
**Scope of this session's work:**

| Ticket | What it changed | Prod state |
|---|---|---|
| #413 | Type-preserving proposal union + `CookProposal` | merged, live |
| #414 | Typed `SessionContext` (killed dict blobs) | merged, live |
| #415 | Pin picked recipe by real id | merged, live |
| #416 | Classifier-primary routing + confirm band (PR #436) | **pending merge** |
| #417 | `get_recipe` honest-dict contract | built, no PR yet |

Most of Spec 0 is backend typing/serialization — it has no *new* UI, but each ticket
fixes a **user-visible symptom** you can reproduce in the chat UI. #416 is the one with
genuinely new interaction surface (the confirm band). This plan tests behaviour, not code.

---

## Setup (do once)

1. **Backend up:** `cd ai-service && uvicorn bubbly_chef.main:app --reload --port 8888`
2. **Frontend up:** `cd nextjs && npm run dev` → http://localhost:3000
3. **Sign in** as the dev test account: `test@bubbly.local`
   (user_id `1136277c-9ee3-4fbc-a8c5-448d7a835237`, dev Supabase project `obmbwuqwpvntxhhbdfsg`).
4. **Seed the pantry** if empty: `python scripts/seed_pantry.py` (≈32-item realistic pantry).
   Several flows below depend on having real pantry items to deduct against.
5. Open the browser devtools **Network** tab — the SSE stream on `/v1/chat/stream` and the
   proposal envelope are the ground truth when the UI is ambiguous. Watch `next_action`,
   `requires_review`, and `metadata.confirm_options` on the envelope.

> **What "in place" means below:** the recipe card is *replaced/updated in the same chat
> thread* — you do **not** get bounced back to a list of brainstorm ideas, and the recipe
> keeps its identity (same pin). "Restarts brainstorm" = the failure: the pick is gone,
> you're back to a menu of options.

---

## Phase 0 — Regression floor (the three merged tickets)

These already shipped to prod. Run them first: if any fails, something regressed in the
merged foundation and #416 sits on top of it.

> **Caveat on the merged foundation (#413/#414/#415):** it is backend
> typing/serialization. Its "proposals survive reload" guarantee only ever covered
> the `conversation_sessions.pending_proposal` path (pending pantry / cook cards).
> A terminal **recipe_card** proposal was **not** persisted per-message — it vanished
> on navigate-away. That gap is closed by the fix tracked in
> `docs/plans/floating-prancing-rain.md` (adds `proposal`/`metadata` columns to
> `conversation_history`). Run 0.1 below against that fix, not bare main.

### 0.1 — Proposal survives navigate-away (#413 + reload-persistence fix)
- [ ] In chat, ask for a recipe until a **recipe card** (or a proposal with an action
      button) appears.
- [ ] **Do not click it.** Navigate away — go to `/pantry`, then back to `/chat` and
      reopen the same conversation from history.
- [ ] **Expect:** the **recipe card is still rendered** (not just the reply bubble +
      chips). For an action-bearing proposal, the button is still present.
      *(Pre-fix bug: the card vanished on navigate-back — intent survived so recipe-case
      chips showed, but `message.response.proposal` was never restored, so no card. The
      proposal was never written to `conversation_history` at all.)*
- [ ] **Known limitation (out of scope, don't fail on it):** a restored *pending pantry*
      card renders but its Approve/Reject buttons are display-only after reload (no live
      callback re-registration). Recipe cards are read-only anyway, so they restore fully.

### 0.2 — Cook amendment is a real proposal → MOVED to Spec A (A-2, PR #360)
- [ ] **Not testable on main.** The `CookingAmendmentCard` + "Update what I'm cooking"
      button is **Spec A PR #360** (#303/#279, the amendment UI), which is **not merged**.
      On current main a mid-cook amendment ("no cream, use a roux") correctly returns
      **`cooking_help` prose** — there is no amendment card in the chat router (`CookProposal`
      exists only as a model and in the `/v1/recipes/cook` endpoint, not the chat thread;
      no frontend `CookingAmendmentCard` component exists yet).
- [ ] The `CookProposal` **deserialization** that #413 landed is exercised by the
      `/v1/recipes/cook` endpoint tests, not by this chat flow.
- [ ] **When testing the amendment card, use** `2026-09-13-spec-a-cook-flow-manual-test-plan.md`
      **Phase A-2** — it is the correct home for this check.

### 0.3 — Session context round-trips (#414)
- [ ] Have a multi-turn conversation that builds context: brainstorm ideas, then a
      constraint ("make it vegetarian"), then pick one.
- [ ] Navigate away and back to the same conversation.
- [ ] **Expect:** the brainstorm ideas, the constraint, and the last recipe title are all
      still honoured on the next turn — no context reset, no `None` reads.
      *(This is the typed `SessionContext` replacing the old dict blobs; a drifted key
      would now fail loudly rather than silently read empty.)*

### 0.4 — Right recipe stays pinned (#415)
- [ ] Brainstorm, then discuss **three different recipes** in one conversation
      (e.g. three pasta variations).
- [ ] Pick one explicitly. Then send a refinement ("add more garlic").
- [ ] **Expect:** the refinement targets the **recipe you picked**, not the last one
      merely mentioned. If you then cook it, the deduction is against the picked recipe.
      *(Pre-#415: identity lived in a title string and was ambiguous across three cards.)*

---

## Phase 1 — #416 classifier-primary routing (PR #436, the main event)

This is where the new behaviour lives. Each maps to an acceptance criterion on #416.

### 1.1 — Modification after a pick refines in place, never restarts (#266) — **AC1**
- [ ] Pick a recipe.
- [ ] Send **"make it spicier"**.
  - [ ] **Expect:** the same recipe is refined in place. **No** brainstorm menu.
- [ ] On a fresh pick, send **"add a fig glaze?"** (a modification phrased as a *question*).
  - [ ] **Expect:** still treated as a modification, refined in place.
        *(This is the specific case the old hardcoded prefix list got wrong — a question
        didn't match "make it…"/"add…" prefixes and fell through to brainstorm.)*

### 1.2 — Explicit escape to fresh brainstorm — **AC2**
- [ ] After a pick, send **"actually, something else"**.
  - [ ] **Expect:** a fresh brainstorm starts (new set of ideas).
- [ ] Confirm a **[Start over]** chip/action is present, and clicking it **always** goes to
      open brainstorm — regardless of what you'd typed or the classifier's confidence.

### 1.3 — Confirm band on ambiguous modify-vs-new — **AC3 (the new UI surface)**
- [ ] After a pick, send something genuinely ambiguous between "tweak this" and "new dish"
      — e.g. **"hmm what about something with mushrooms"** (could be a modification, could
      be a new idea).
  - [ ] **Expect:** instead of guessing, the assistant emits a **one-tap confirm** with two
        options — **"Tweak this recipe"** and **"Start fresh"**. Nothing is generated yet.
  - [ ] In devtools, confirm the envelope carries `next_action = CONFIRM_CHOICE`,
        `requires_review = true`, and `metadata.confirm_options` with the two `{label,
        forced_intent}` entries.
  - [ ] Click **"Tweak this recipe"** → **Expect:** modifies the pinned recipe in place.
  - [ ] Repeat the ambiguous prompt, click **"Start fresh"** → **Expect:** a new brainstorm.
- [ ] Send a **high-confidence** modification ("make it spicier") and confirm it acts
      **directly, no confirm prompt** — the confirm band only fires on low/medium confidence.

### 1.4 — High-confidence generation served as generation, not brainstorm (#408) — **AC4**
- [ ] Send a clear, specific generation request — **"give me a recipe for pad thai"**.
  - [ ] **Expect:** you get a **single recipe** (generation), not a brainstorm list of
        options. *(Pre-#408: a high-confidence generation was silently downgraded to
        brainstorm.)*

### 1.5 — Mid-cook swap updates the cooked recipe; no brainstorm mid-cook (#279) — **AC5**
- [ ] Enter cooking mode on a recipe ("Cook with me").
- [ ] Send **"no cream, use a roux"**.
  - [ ] **Expect:** the **pinned recipe updates** and its deduction follows the amendment
        (same row, same cook session). This is the amendment block, one action:
        **"Update what I'm cooking"**.
- [ ] While still mid-cook, try to trigger a full brainstorm ("show me other pasta ideas").
  - [ ] **Expect:** full brainstorm is **not** reachable mid-cook — only narrow amendments.

  > **Note — bias, not force (design tradeoff, #274 Q1):** COOKING mode now *biases* the
  > classifier toward cooking help; it no longer *hard-locks* it. A terse off-topic
  > question mid-cook (e.g. "how long do I boil an egg?") *could* be classified as general
  > chat rather than pinned-recipe help. That is by design, not a bug — but if you see a
  > mid-cook question lose the recipe context, note it: it's the known residual risk of
  > bias-not-force, worth a follow-up if it bites in practice.

### 1.6 — Re-pick a prior idea does not regenerate (#274 Q6) — **AC6**
- [ ] Brainstorm so you get a set of named ideas (e.g. **Pesto Pasta, Carbonara,
      Tomato Soup**).
- [ ] Send **"show me the pesto one instead"**.
  - [ ] **Expect:** it surfaces the **already-proposed** Pesto Pasta — **no regeneration**
        (should be fast; the idea is pulled from the stored set, not re-invented).
- [ ] Confirm the brainstorm set is **only** invalidated when you run a *genuinely new*
      brainstorm ("actually, show me vegetarian options") — not on a re-pick.

### 1.7 — Confirm-turn leak regression (finding #1d, sealed in this PR)
- [ ] Trigger the confirm band (1.3), click **"Tweak this recipe"** so a recipe is pinned.
- [ ] On the **next** turn, send a modification that happens to **name a prior idea** —
      e.g. **"make the Pesto Pasta one spicier"** (Pesto Pasta being an earlier brainstorm
      idea).
  - [ ] **Expect:** it **modifies the pinned recipe** — it does **not** re-pick / swap to a
        different dish. *(The bug this PR sealed: the confirm turn's telemetry intent could
        make the next turn treat a pinned modification as a brainstorm re-pick.)*

---

## Phase 2 — #417 get_recipe honest-dict (after its PR lands)

Pure typing/contract change — **no behavioural change expected**. The test is a
non-regression:

- [ ] Any flow that reads a saved recipe back (open a saved recipe, cook a saved recipe,
      refine a saved recipe) works exactly as before — no crash, no empty card, no
      wrong-shape error in the backend logs.
- [ ] Backend starts clean and `./scripts/mypy_gate.sh` shows 0 new errors (already
      verified in CI, listed here for completeness).

---

## Sign-off

- [ ] Phase 0 (0.1–0.4) — merged foundation still holds.
- [ ] Phase 1 (1.1–1.7) — #416 flows all pass → **PR #436 clear to merge.**
- [ ] Phase 2 — run after #417's PR lands.

**If any Phase 1 box fails:** capture the chat transcript + the `/v1/chat/stream` envelope
from devtools and hand it back — that's the actionable evidence for a fix, not "it felt
wrong".
