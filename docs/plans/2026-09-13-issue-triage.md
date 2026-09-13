---
type: plan
created: 2026-09-13
updated: 2026-09-13
---

# BubblyChef Issue Triage + Master Spec Roadmap — 2026-09-13

**Lens (the reframe that drives all prioritization):** BubblyChef is a *personal*
project — the owner's own cooking companion (replacing on-phone Gemini for
cook-alongs), a resume piece, and something to share with family + friends. It is
**not** a production app with live paying customers. So the priority order favors:

1. Features that make it genuinely more useful as a cooking assistant (core value).
2. Visible quality that matters when showing it off (demo / friend-facing).
3. Real wrong behavior (correctness bugs).
4. Hardening / tech debt / edge cases the owner + friends will never hit (defer).

Issue #384 (chat forgetting early cook-along detail) is the emblem of the core use
case — the thing that currently makes BubblyChef worse than plain Gemini for a real
cook.

Snapshot: 50 open issues at the time of writing. `main` @ `2c5615d`.

---

## Part 1 — All 50 issues, bucketed and ranked

### Bucket 1 — Core Value (makes the app actually useful for cooking)

Ranked most-valuable first.

1. **Issue #384** — *bug(chat): cooking-help conversation history window is too short.*
   Anything said before the last ~5 exchanges is forgotten mid cook-along — marinade
   ratios, scaling math, substitutions. The flagship failure mode. Implementation plan
   already written: `docs/plans/2026-09-13-chat-history-window-384.md`.
2. **Issue #266** — *bug(chat): follow-up on selected recipe restarts brainstorm instead
   of modifying the recipe.* After picking a recipe, "make it spicier" starts a brand-new
   brainstorm instead of refining the pick. Cooks use follow-ups constantly.
3. **Issue #279** — *bug(cook): recipe amendments in chat don't update the pinned recipe,
   so the deduction is wrong.* Swap an ingredient mid-cook and the "COOKING NOW" banner +
   deduction still use the original recipe. Cook log and pantry deductions go wrong.
4. **Issue #186** — *Chat can't reference saved recipes (saved-recipe-lookup intent
   unfinished).* "Make that butter chicken I saved" generates a new recipe. The recipe
   library is unreachable from chat — intent is absent, not stubbed.
5. **Issue #311** — *bug(chat): high-confidence pantry proposals render a card whose
   approve button silently no-ops.* Items you say you bought fail to get added; no error.
6. **Issue #370** — *A cleanly-resolved pantry-add turn wipes item continuity for the next
   turn.* Add apples + eggs → works → "make a recipe with those" → model has no memory of
   them.
7. **Issue #303** — *feat(chat): render recipe amendments as an "Update what I'm cooking"
   block.* Backend (PR #355) already emits structured amendments; the frontend never
   renders them. UI half of the cook-amendment loop (draft PR #360, conflicted, reverted
   once before).
8. **Issue #263** — *feat(cook): step-by-step guided cooking flow for "Cook with me".*
   Guided mode is entered but no step UI exists — a dead end after entry.
9. **Issue #281** — *ux(cook): "Not in pantry" is a dead end — no substitutes, no
   explanation.* Missing items get bare warning chips with no path forward.
10. **Issue #222** — *Piece-unit deductions over-deduct: "4 slices" against a 1-item loaf
    removes the whole loaf.* Pantry state goes wrong after every piece-unit cook.
11. **Issue #272** — *Cook & Chat: coherent end-to-end experience* (`wayfinder:map`). The
    design-spec master ticket for the whole cook+chat flow. A planning artifact that
    should break into implementation tickets — do it before building #263/#273.
12. **Issue #375** — *WorkflowState.proposal union doesn't include recipe amendments, and
    model_dump() erases the type* (`ready-for-agent`). `CookProposal` is missing from the
    union; serialization drops the type. Blocks PR #360. Fix before #303.

### Bucket 2 — Demo / Friend-Facing Polish (visible quality when showing it off)

13. **Issue #331** — *bug(auth): there is no way to sign out of the app.* Blocks multi-user
    testing and demo handoffs. One small UI addition.
14. **Issue #358** — *Unapproved pantry proposal cards vanish from chat history after
    navigating away and back.* The pending add is silently lost; looks broken.
15. **Issue #45** — *Recipe page: contextual step timers.* "Simmer 15 min" → tap → timer.
    The single best demo feature.
16. **Issue #317** — *feat(chat): make follow-up chips context-aware instead of a fixed set
    per intent.* Static suggestion chips make every conversation feel the same.
17. **Issue #254** — *Chat multimodal ingest: no way to attach a photo, and TEXT modality
    is split across two implementations.* Chat asks for a receipt photo with no upload
    control. Part 1 (attach UI) is user-facing; Part 2 (split impl) is tech debt.
18. **Issue #357** — *Add a non-blocking expiry field to the chat/scan pantry-add card.*
    Can correct qty/unit inline but not expiry.
19. **Issue #209** — *Cook flow: "Mark as cooked" unit-conflict UX + assume basic
    seasonings.* Over-eager unit-conflict warnings force manual entry on nearly every
    ingredient; looks broken.
20. **Issue #42** — *Auto-generate grocery list from depleted and low pantry items.* Cook →
    instantly see what to buy. Very demo-friendly; cook→deduct is already shipped.
21. **Issue #332** — *product: the app is a hard login wall.* Largely resolved by guest mode
    (PR #388). Remaining: landing page. Rescope or close.
22. **Issue #43** — *In-app notification center for expiry alerts and pantry nudges.*
    Proactive reminders. Medium effort, decent friend-facing value.

### Bucket 3 — Correctness Bugs Worth Fixing

23. **Issue #356** — *Pantry lots: merge-on-add discards the new lot's expiry, and duplicate
    rows don't sum for availability.* Repeat adds lose expiry; stock counts wrong.
24. **Issue #363** — *Manual "type" pantry-add path never sets estimated_expiry on a guessed
    date.* Counterpart to #380 (fixed for scan). "(est.)" never shows for typed items.
25. **Issue #376** — *get_recipe declares `-> RecipeCard | None` but returns a raw dict.*
    Every caller works around it. Awaiting-decision on which way the contract goes.
26. **Issue #361** — *[bug]: pantry update through chat is losing previous context.* Two of
    three symptoms still untraced (card not rendering, missing "not sure" row). Overlaps
    #370/#311. Needs a browser.
27. **Issue #264** — *feat(cook): warn and prompt to clear expired pantry items before
    cooking.* Shouldn't silently cook with expired milk.
28. **Issue #183** — *Backfill expiry estimates for existing pantry rows with no expiry
    date* (`ready-for-agent`, newly unblocked). One-time migration, easy pickup.
29. **Issue #298** — *Stamp a pantry row when a cook consumed it imprecisely (second half of
    #222).* Companion to #222.
30. **Issue #284** — *feat(cook): deduct compound substitutions, not just suggest them.*
    "Butter+flour instead of cream" is suggested but never deducted.

### Bucket 4 — Low Value / Defer

Hardening, tech debt, exploratory, or features unlikely to be hit by owner + friends.

- **Issue #128** — mypy --strict baselined errors (baseline stale: 106 entries vs 36 real
  — sync first). No behavior impact.
- **Issue #129** — adopt ruff 0.16 expanded rules (144 findings). Style only.
- **Issue #130** (CLAUDE.md note) — tenacity not in pyproject.toml; resolves transitively.
- **Issue #345** — e2e specs fail on prod server (partial-hydration masking); behavior is
  correct. CI noise.
- **Issue #321** — review-gate hook tests inherit real markers. Affects only hook tests.
- **Issue #337** — Next.js `middleware` deprecation; auth layer breaks on a future upgrade.
  Real but not imminent.
- **Issue #352** — full Playwright regression suite, CI-gated. Nice-to-have.
- **Issue #255** — receipt fixture corpus + regression tests. Test infra.
- **Issue #202** — decide production AI provider + tool-calling parity. `gemini-3.1-flash-lite`
  works; cost negligible. Deferred.
- **Issue #389** — guest→Google should linkIdentity not fork. Niche; needs Supabase config.
- **Issue #301** — explore embedding-based ingredient matching. Research; current hybrid works.
- **Issue #189** — AI workflow refactor to R5 LLM tools. Internal refactor, no user-facing
  change yet.
- **Issue #194** — multi-household / shared pantry. High complexity; irrelevant single-user.
- **Issue #193** — meal planning calendar. Big feature, far from core.
- **Issue #190** — video recipe ingestion (TikTok/Reels). Ambitious, high risk, niche.
- **Issue #191** — barcode scanning for pantry add. OpenFoodFacts lookup already landed
  (PR #366); verify what remains before picking up.
- **Issue #46** — AI taste profiling. Phase 5, exploratory.
- **Issue #274** — decision: modify vs new brainstorm (`wayfinder:grilling`). Design
  decision feeding Spec 0's escape-hatch — do the grilling first.
- **Issue #273** — prototype guided cooking mode (`wayfinder:prototype`). Design artifact
  feeding #263 — prototype before building.
- **Issue #351** — Playwright demo flows (`ready-for-human`). Highest-leverage verification
  artifact; do during a QA walkthrough.

### Recommended next 5 things to build (per the reframe)

1. **#384** — chat history window. Plan written, core use case, backend work. Immediately.
2. **#375 → PR #360 → #303** — fix proposal shape, then merge the cook-amendment UI.
3. **#266 / #274** — grilling decision, then follow-up modifies recipe instead of restarting.
4. **#311 + #370** — the two `useChat.ts` bugs that break chat-based pantry management.
5. **#186** — saved-recipe-lookup; makes the recipe library reachable from chat.

Then: #331 (sign out, trivial, unblocks QA), #45 (step timers, demo value), #281
(substitutes on "not in pantry").

---

## Part 2 — Architecture assessment

**Verdict: do NOT rethink the arch. Fix two specific structural problems.** The
LangGraph graph shape is sound; the cook-flow bugs come from accumulated
state-management shortcuts, not a wrong framework choice.

### Problem 1 — `router.py` is a God file whose session-mode logic forces intent

`router.py` (~1506 lines) owns graph construction, session transitions, four handoff
paths, two public entry points, and envelope assembly. Its `update_session_node`
(~215 lines of nested if/elif) plus a hardcoded **mode → intent forcing table**
(`COOKING → cooking_help`, `RECIPE_EXPLORING → recipe_brainstorm`,
`INGESTING → pantry_update`) is the root of #266 (follow-up restarts brainstorm) and
contributes to #279. Any intent outside the forced one is unreachable while a mode is
active.

**Fix (not a rewrite):** extract session-transition logic into a proper state machine
and add a modification/exit escape-hatch in `classify_intent` so certain intents can
override the forced route. `_detect_amendment` in `chat/nodes.py` is the existing
pattern to extend.

### Problem 2 — `ConversationSession` uses stringly-typed catch-all blobs

`metadata: dict[str, Any]` (stores `brainstorm_ideas`, `recipe_constraints`,
`last_recipe_title`, cooking recipe key as magic string keys) and
`pending_proposal: dict[str, Any] | None`. A `PendingProposalMemory` TypedDict exists
but is never used as the field type. This is why proposals lose type on serialization
(#375), why `CookProposal` is missing from the `WorkflowState.proposal` union, and why
the frontend duck-types proposals (`!!proposal && proposal.actions.length > 0` in
`useChat.ts:266`).

**Fix:** replace the blobs with a typed `SessionContext` Pydantic model; add
`CookProposal` to the `WorkflowState.proposal` union.

### What does NOT need rethinking

- LangGraph graph structure (15 nodes, intent routing, ReAct cooking loop) — sound.
- The `ProposalEnvelope[T]` pattern — good; just missing a member + a serialization gap.
- `AIManager` + `SupabaseRepository` layers — clean and consistent.
- `recipe/nodes.py` size (~1113 lines) is a smell but causes no correctness bugs. Its
  `_format_history_context` is a private duplicate of `chat/nodes.py`'s
  `format_history_context` — same #384 bug in both; de-dupe as a sibling refactor.

---

## Part 3 — Master Spec Roadmap (5 sequential specs)

Decided cut: **4 domain specs + 1 foundation spec.** Foundation ships first and
unblocks the rest. Each spec becomes one `/to-spec` → GitHub Issue → `/to-tickets`.

### SPEC 0 — Foundation: Chat state machine + typed session (ships first)

Kills the "follow-up does the wrong thing / app forgets context" class by fixing the
two structural roots above.

- #375 — proposal union + serialization (`ready-for-agent`, ~2 files).
- #376 — `get_recipe` contract (raw dict vs declared type).
- Session-mode escape hatch (new) — `classify_intent` override; root of #266/#279.
- Typed `SessionContext` (new) — replace `metadata`/`pending_proposal` blobs.
- Folds the #274 grilling decision (modify vs new brainstorm), which shapes the
  escape-hatch behavior.

Sequence: #375 → typed `SessionContext` → escape-hatch → #376.
Acceptance: proposals round-trip with type intact; modification follow-ups reach the
right handler in any mode; no `dict[str, Any]` in session state; honest `get_recipe`.

### SPEC A — Cook flow coherence (#272 is its `wayfinder:map` master)

Make cook-along coherent end to end: brainstorm → pick → refine → check pantry →
guided steps → correct deduction → clean done-state.

Sequenced: #273 (prototype) → #279 → #303 + PR #360 (needs Spec 0 #375) → #263 →
#281 → #222 + #298 → #284 → #209 → #264.

### SPEC B — Recipe intelligence (additive, high demo value)

- #186 (saved-recipe lookup) first — feature gap, makes library reachable from chat.
- #45 (step timers) + #42 (grocery list) — independent, demo-worthy.
- #43 (notifications), #317 (context-aware chips), #289 (meals not one all-in-one dish).

### SPEC C — Ingest & pantry input (correctness-heavy)

Every add path (chat, scan, manual type, barcode) produces correct data with correct
expiry, and nothing gets silently lost.

- #311, #370 (overlaps Spec 0), #358, #356, #363, #357, #254, #183 (quick win, unblocked).

### SPEC D — Auth & demo polish (small, visible, pick off individually)

- #331 (sign out — trivial, unblocks QA), #332 (login wall — rescope/close),
  #389 (guest→Google linkIdentity — niche/deferred), #337 (middleware deprecation).

### Not in any spec (deferred, tracked only)

#128, #129, #130, #345, #352, #351, #255, #321, #202, #301, #189, #194, #193, #190,
#191, #46.

### Recommended build order

Spec 0 → Spec A → Spec B / Spec C in parallel → Spec D as filler. Alternative if
front-loading demo value: pull #45 and #186 (from Spec B) forward alongside Spec A.

---

## Decisions (resolved 2026-09-13)

1. **5-spec cut — approved** (4 domain + 1 foundation).
2. **Build order — approved:** Spec 0 → Spec A → Spec B / Spec C in parallel → Spec D.
3. **#274 (modify vs new brainstorm)** — owner will run `/grilling` on it next; behavior
   not yet decided. Its outcome shapes Spec 0's escape-hatch.
4. **First spec to draft — Spec 0.**

---

## Addendum — 2026-09-13 (later): QA walkthrough issues + Spec B reshape

### Spec B reshape — notification center as the hub

Decision: build an in-app **"Activity / Inbox"** notification center as the durable
home for signals (portable web→mobile; does not rely on flaky web push — push becomes
a later delivery channel reading the same store). This makes **#43 the hub of Spec B**,
with #42 and #45 feeding into it:

- **Timers (#45)** — a **cooking-session dock** (glanceable on the recipe screen while
  cooking); *completion* lands in the inbox as an entry. Timers are not managed *from*
  the inbox.
- **Expiry alerts (#43)** — the natural inbox content (compute-on-load or a daily job
  over pantry `expiry` dates).
- **Grocery list (#42)** — gets its **own `/grocery` route** (checkable, editable list
  generated from cook depletions + manual adds). The inbox *points to* it ("5 items
  added → View list"); the list does not live inside the inbox.

Sequencing note: ship a **lite inbox first** (badge + dropdown, compute-on-load, no
persistence), then a fully persisted inbox with read/unread only if it earns its keep.

### #395 — profile cooking-context — folds into Spec B

**Issue #395** — *Profile: cooking-context fields (allergies, household size, disliked
ingredients, cuisines, expiry priority) that actually shape suggestions.* A new
core-value pillar: **allergies are hard constraints (never suggest) — real safety
value**, distinct from dietary preferences (prefer); household size feeds recipe
scaling. It is a different page/surface, but its payoff is entirely in how it shapes
recipe generation + chat, so it ties into Spec B's flows. **Placed in Spec B.**

### QA walkthrough issues (#395–#406, all `needs-triage`)

Filed 2026-09-13 from a parallel QA session (owner is triaging the untied ones there;
owner is NOT QA-ing chat or recipes, since this session does the major chat/recipe work).
Fold-in:

- **Spec B:** #395 (profile cooking-context — core-value pillar, see above).
- **Spec C (ingest/pantry input):** #404 (collapse previous manual-add rows into
  summaries), #398 (ingredient-name autocomplete w/ auto-filled unit+expiry from
  catalog), #402 (Scan↔Type tab switch wipes input but "ready to add" count survives),
  #406 (scan review footer counts all found items, not checked ones), #403 (scan
  dropzone has no drag-and-drop handlers, click-only), #400 (scan review category shown
  twice — pill + editable field), #396 (raw error logs leaked to user on scan failure;
  Gemini vision timeout — correctness/polish, looks broken).
- **Spec D (demo polish):** #405 (filter bar shown on empty pantry), #401 (mascot art
  stylistically inconsistent across screens), #399 (scan tab polish — mascot w/ camera,
  drop emoji from tab labels, rename Type→Manual), #397 (remove kitchen-location field
  now the gamified kitchen UI is on hold).

Not relabeled or worked here — the QA session owns their triage state.
