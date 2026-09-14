---
type: spec
created: 2026-09-13
updated: 2026-09-13
spec: C
status: draft
depends-on: [spec-0]
coordinates-with: [spec-b]
---

# Spec C — Ingest & pantry input

Fourth spec of the 5-spec master roadmap
(`docs/plans/2026-09-13-issue-triage.md`). Correctness-heavy. Can be drafted /
built in parallel with **Spec B**. Coordinates with **Spec 0** (#410) — several
chat-add bugs live in exactly the session/proposal state Spec 0 retypes.

**The through-line:** every add path — chat, scan, manual type, barcode —
produces correct data with correct expiry, and nothing gets silently lost.

Three sub-themes: **proposal lifecycle** (chat-add continuity), **lot/expiry
correctness** (the data is right), and **scan/add-sheet UX** (the sheet doesn't
lie or lose input).

---

## Problem Statement

Adding items to the pantry is where the app quietly does the wrong thing:

- **Chat pantry-adds break in the clearest cases.** "add 2 apples and a dozen
  eggs" (confidence 1.0) renders a card whose approve button silently no-ops —
  items never added, no error (#311). A clean add-turn *erases* the item memory
  the next turn needs, so "make a recipe with those" has no idea what "those"
  are (#370). And an unapproved proposal card vanishes if you navigate away and
  back — the pending add is silently lost (#358).
- **Expiry data is wrong or missing.** Adding a second lot of the same food
  makes it inherit the *older* lot's expiry, so a pound bought today reads as
  expiring last week; and duplicate rows don't sum, so a recipe needing 5 onions
  looks unmakeable when you have 2 + 3 (#356). A manually-typed item gets a
  guessed expiry that's never marked "(est.)", so it looks as authoritative as a
  real date (#363). There's no way to state or correct an expiry at add time at
  all (#357). Items added before estimation existed have no expiry and are
  invisible to expiring-soon surfaces (#183).
- **The add sheet lies and loses input.** Switching Scan↔Type tabs wipes typed
  input but the footer count survives, so "Add 1 Item" adds nothing (#402).
  Unchecking a scanned item doesn't decrement the footer count, so a user adds
  items they unchecked (#406). The dropzone says "Drop your receipt here" but
  has no drag handlers (#403). A scan review card shows the category twice, in
  two editable-conflicting places (#400). Manual add stacks full-height forms
  with no collapse, so multi-item entry is an unscannable scroll (#404). A scan
  failure dumps a raw provider error string at the user (#396). And chat asks
  for a receipt photo with no way to attach one (#254). Manual add is a blank
  free-text field with no autocomplete despite a 304-entry catalog sitting
  right there (#398).

## Solution

Every add path is correct and honest:

- **Chat pantry-adds work end to end** — approving any proposal that carries
  actions writes the items; item continuity survives a clean turn; a pending
  proposal survives navigation.
- **Expiry is correct and honest** — a new lot keeps its own expiry, duplicate
  rows sum for availability, guessed dates are marked "(est.)", the user can
  set/correct an expiry inline at add time, and old dateless rows get a
  one-time estimated backfill.
- **The add sheet tells the truth** — the footer count always equals what will
  actually be added, tab switches don't desync, the dropzone does what it says,
  category shows once, multi-item rows collapse to summaries, a scan failure
  shows a friendly message, chat can attach a photo, and manual add autocompletes
  from the catalog.

## User Stories

1. As a user, I want approving a high-confidence pantry proposal in chat to
   actually add the items, so that the clearest cases don't silently fail.
2. As a user, I want a clean pantry-add turn to remember what I added, so that
   "make a recipe with those" the next turn knows what "those" means.
3. As a user, I want an unapproved proposal card to still be there after I
   navigate away and back, so that my pending add isn't silently lost.
4. As a user adding a second lot of a food, I want the new lot to keep its own
   expiry, so that a fresh purchase doesn't inherit an old date.
5. As a user, I want duplicate rows of the same food to sum for a recipe, so
   that a recipe I can make doesn't look unmakeable.
6. As a user, I want a guessed expiry marked "(est.)" on a manually-typed item,
   so that an estimate doesn't look like a date I entered.
7. As a user, I want to set or correct an item's expiry at add time, on both the
   chat and scan cards, so that I can state the real date when I know it.
8. As a user, I want old pantry items with no expiry to get an estimated date, so
   that they show up in expiring-soon surfaces instead of being invisible.
9. As a user, I want the "Add N Items" count to equal what will actually be
   added, so that the footer never lies about the outcome.
10. As a user, I want unchecking a scanned item to decrement the count, so that
    I don't add things I unchecked.
11. As a user, I want switching add-sheet tabs to not silently wipe what I
    typed (and if it must reset, reset the count too), so that the count and the
    form never disagree.
12. As a user, I want to drag a receipt onto the dropzone (or have it not
    promise that), so that the zone does what its label says.
13. As a user, I want a scan card to show the category once, so that I'm not
    editing two conflicting copies.
14. As a user, I want previously-entered manual rows to collapse to a compact
    summary, so that adding several items stays scannable.
15. As a user, I want a friendly message when a scan fails, so that I get an
    actionable next step instead of a raw error dump.
16. As a user, I want a scan that failed on a transient timeout to retry and
    fall back to manual entry, so that a core feature stays reliable.
17. As a user, I want to attach a receipt photo in chat when it asks for one, so
    that the conversation doesn't park waiting on something I can't provide.
18. As a user, I want ingredient-name autocomplete in manual add that auto-fills
    unit, category, and an estimated expiry from the catalog, so that I'm not
    hand-typing every field.

## Implementation Decisions

**Coordinates with Spec 0 (#410):** #370 and #358 sit in the session/proposal
state Spec 0 retypes. #370 is a `pending_proposal` blob bug — a clean
`PANTRY_UPDATE` turn sets `pending_proposal = None`, erasing the only
item-name continuity across turns; the typed `SessionContext` is where this is
fixed correctly. #358 is a proposal-persistence gap (the envelope isn't carried
on restored turns and likely isn't persisted server-side) — its fix rides on
Spec 0's type-preserving proposal round-trip. **Sequence #370/#358 after Spec 0's
typed session lands**; #311 is independent and can go first.

### Proposal lifecycle (chat-add continuity)

- **#311 — approve no-op.** The card renders for high-confidence proposals
  (`requires_review: false`) but `pendingProposals` is only populated when
  `requires_review === true`, so approve guards out and no-ops. **Fix (option 1
  from the issue):** populate `pendingProposals` for **any** `pantry_update`
  proposal carrying `proposal.actions`, regardless of `requires_review`
  (verification confirmed the workflow does *not* auto-write high-confidence
  proposals during the stream, so suppressing the card would drop the add).
  Acceptance: approving a high-confidence proposal writes the items.
- **#370 — clean turn wipes continuity.** In `update_session_node`'s
  `PANTRY_UPDATE` handling, a clean turn (`requires_review == False`) sets
  `pending_proposal = None`, erasing item-name memory a later vague turn ("some
  dairy") needs. Fix in the typed `SessionContext` (Spec 0) so item continuity
  is retained across a successful turn.
- **#358 — proposal vanishes on nav.** On remount, `useChat` rebuilds turns from
  stored fields only (`id/role/content/intent/timestamp`) — no proposal /
  `pendingProposals` reconstruction, and the backend history likely doesn't
  persist the envelope. Fix end-to-end: persist the proposal envelope with the
  turn and reconstruct it on restore. Rides Spec 0's typed proposal.

### Lot / expiry correctness

- **#356 — lots (`needs-info`, `priority:high`).** Two halves:
  - **Half 1:** merge-on-add updates quantity but never `expiry_date`, so a new
    lot inherits the old date; the sum is also unit-blind. A new purchase with a
    different expiry should not silently inherit the old lot's date.
  - **Half 2 (ex-#127):** the cook matcher keeps only the highest-quantity row
    and discards duplicates, under-reporting availability. Duplicate rows of the
    same food must sum.
  - **`needs-info`:** the lot model is the open question — do we keep separate
    rows per lot (sum for availability, each with its own expiry) or merge with a
    multi-expiry structure? Settle this first; #357 (inline expiry) is the clean
    input point that distinguishes two lots, so they coordinate.
- **#363 — manual add estimated_expiry flag (`ready-for-agent`).** `POST
  /api/pantry` builds its own insert and never sets `estimated_expiry: true` on
  a heuristic-guessed date, so "(est.)" never shows. Set it true on fallback,
  false when the client supplied a date — mirroring `apply_pantry_proposal`.
  **Depends on #182's `estimated_expiry` migration** being applied.
- **#357 — inline expiry field (`needs-info`).** Add an optional, **non-blocking**
  "expires? [date]" field on each add-card row, on **both** chat proposal cards
  and the scan review sheet, defaulting to the backend's estimate (confirm, not
  enter-from-scratch). The write path (`apply_pantry_proposal`) already honors an
  explicit `expiry_date`, so this is mostly UI + wiring. Composes with the #356
  lot decision.
- **#183 — backfill (`ready-for-agent`, `priority:high`).** One-off, idempotent
  pass applying the expiry estimator to existing rows with no expiry; mark
  backfilled dates as estimated (coordinate with #182). Quick win, unblocked.

### Scan / add-sheet UX

- **#402 + #406 — count/state desync (`ready-for-agent`, `priority:high`, fix
  together).** Both are the same root: the footer "ready to add" count is
  derived from *found* items, not *checked/valid* form state, so they drift —
  tab switch wipes input but not the count (#402); unchecking doesn't decrement
  (#406). **Single source of truth:** the footer count and Add button derive
  from the actual checked/valid item set. Tab switches either preserve input or
  reset input *and* count together.
- **#403 — dropzone drag-and-drop (`ready-for-agent`).** Either add real
  dragover/drop handlers (accept the image, preventDefault the browser's
  open-file) or change the copy to not promise it. Prefer making it a real drop
  target.
- **#400 — category shown twice (`ready-for-agent`).** Show category once per
  scan review card (keep the editable field, drop the redundant pill, or make
  the pill open an editor). Also align the review-card checkbox style with the
  rest of the app.
- **#404 — collapse manual rows (`ready-for-agent`).** When a new row is added
  (or a row completes/blurs), collapse prior filled rows to a compact summary
  ("🥛 Milk · 1 item · Dairy"), tap to re-expand; the editing row stays open.
- **#396 — scan failure UX (`ready-for-agent`, `priority:high`).** Two problems:
  (a) never surface the raw internal error — show a friendly, actionable message
  ("Couldn't read that receipt — try again, or add items manually"); (b) the
  vision `ReadTimeout` / "no vision-capable provider" needs a retry and graceful
  fallback to manual entry. *(Note: the model-pin half of the original error —
  `gemini-2.5-flash` — was the #407 `.env` drift, fixed by the owner; this issue
  is the error-handling + reliability half.)*
- **#254 — chat photo attach + TEXT split.** Part 1 (user-facing): chat promises
  a receipt photo upload with no attach control; the conversation parks in
  `AWAITING_INPUT`. The backend is already built — `POST /v1/ingest` accepts an
  image and chat already renders `PantryProposalCard`. Add a file input in chat
  wired to the ingest path. Part 2 (tech debt): TEXT modality split across two
  implementations — de-dupe; lower priority than Part 1.
- **#398 — manual-add autocomplete (`ready-for-agent`, `priority:high`).**
  Autocomplete the item-name field from the 304-entry catalog
  (`GET /api/foods/search` exists); on select, auto-fill unit, category, emoji,
  and an estimated expiry (today + catalog default-days), marked estimated per
  #182/#362. Wiring existing data, not new data. Composes with #404 (collapse)
  and #357 (expiry field).

## Testing Decisions

Good tests assert external add-path behavior. Seams by sub-theme:

1. **Pantry write path (`apply_pantry_proposal` / merge-on-add) — master backend
   seam.** Given an add action (with/without explicit expiry, matching an
   existing row or not), assert the resulting rows: a new lot keeps its expiry
   (#356 half 1), estimated dates carry the flag (#363), duplicate-row summing
   feeds availability (#356 half 2 — assert at the cook-matcher availability
   read). Prior art: existing supabase_repo / cook_matcher tests.
2. **Proposal approval + continuity (chat).** Approving any actions-carrying
   proposal writes items regardless of `requires_review` (#311); a clean turn
   retains item continuity for the next turn (#370); a proposal round-trips
   through restore (#358). #370/#358 depend on Spec 0's typed session. Prior art:
   chat workflow tests + Spec 0's round-trip seam.
3. **Add-sheet count/state (frontend).** The footer count equals the
   checked/valid set across uncheck (#406) and tab switch (#402) — derive both
   from one source and assert they never disagree. Prior art: existing pantry /
   scan component tests.
4. **Backfill idempotency (#183).** Running the backfill twice produces the same
   result and touches only dateless rows. Backend seam.
5. **Scan failure handling (#396).** A vision timeout yields a friendly message
   (never the raw payload) and a manual-entry fallback path. Seam at the scan
   route / error boundary.

Prefer existing seams; the write path and the count-source are the two that
matter most.

## Out of Scope

- **Chat state machine / typed session itself** — Spec 0 (#410); Spec C consumes
  it for #370/#358.
- **The `.env` model-pin drift (#407)** — fixed by the owner; only the
  error-handling half of #396 is in scope.
- **Barcode scanning build-out (#191)** — OpenFoodFacts lookup already landed
  (PR #366); verify remaining scope separately, not specced here.
- **Recipe intelligence / profile / notifications** — Spec B.
- **The #254 TEXT-modality de-dupe (Part 2)** — tech debt; Part 1 (photo attach)
  is the user-facing slice.

## Further Notes

- **#182 (`estimated_expiry` column + flag) is the shared dependency** for #363,
  #183, and #398's auto-filled dates — confirm its migration is applied before
  those slices.
- **#356 and #357 coordinate:** a user-supplied expiry (#357) is exactly the
  signal that distinguishes two lots (#356). Settle the #356 lot model
  (`needs-info`) before building #357's field wiring.
- **#402 and #406 share a root cause** (count derived from the wrong source) —
  fix as one slice with a single source of truth, not two patches.
- **#311 is independent of Spec 0** and is the highest-value quick fix here
  (breaks the clearest chat-add cases); #370/#358 wait on Spec 0's typed session.
- Recommended order within Spec C: #311 → (after Spec 0) #370/#358 → #356 lot
  decision → #357/#363/#183 → #402+#406/#403/#400/#404/#396/#254/#398.
