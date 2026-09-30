# Issue #444: a pending pantry proposal survives navigation, with its outcome stored server side (contract)

## Revision R3: the build revision (the R2 review raised six issues, all accepted; edited in place)

1. **The §5 group owner** is the last group member in turn order, and it is seeded `proposalStates[owner]='failed'`. Chain members outside the group keep their own classification (new test F4c).
2. **The §5 replay moves `openId` to the new owner after every merge.** Any zero-action `pantry_update` turn with a `request_id` merges; the clarification-suggestions condition is dropped (new test F6b).
3. **`approveProposal` and `rejectProposal` read the current conversation id** through a ref or a dependency. They omit `review` when the id is null (§4; F13 rewritten from a fresh hook).
4. **The `turn_request_ids` cap is 200** on both apply and reject (§2d).
5. **B14 lists an expected result per row.** A malformed proposal or review is recorded as `applied`. Only a non-dict metadata or a raising write is excluded.
6. **F18 keeps its pure and hook assertions together,** with the hook half labelled a regression guard. §2b now says four failure sites.

## Revision R2 (fresh review, "needs changes", all eight findings accepted; edited in place)

1. **A merged chain with a partial failure restores as one card.** `proposal_review.chain_request_ids` is recorded at apply time. Restore groups `failed` turns by chain into one card on the latest turn (§1, §2c, §5; new tests B5b and F4b).
2. **Every `pantry_update` turn with a proposal is stamped with `request_id`,** zero-action (vague-only) turns included. They are also saved before their envelope (§2a, §9.14; new test F17).
3. **A restored partial card displays the failed values it will send.** The overlay also applies to `response.proposal.actions` (§5; F4 extended).
4. **Malformed data is tolerated on both sides.**
   - Frontend: `readPantryActions`, where a bad shape means legacy and the conversation is never cleared (§5; new test F18).
   - Backend: `own_keys` is tolerant, and all of §2c step 5 sits inside the try (§2c; new test B14).
5. **Guard indices are defined.** `sent_actions` is the list after the guard, and the failure indices refer to it (§2c; B8 extended so carrot also fails).
6. **An existing test may be updated.** `pantry-proposal-high-confidence-approve.test.tsx:92` gains the new third argument (§7).
7. **Test wording and a line reference are fixed.** B13 is four code sites tested as five cases. B10 now asserts the new response fields. The streaming initial state is at `router.py:2204` (§0, §7).
8. **Verify step 8b is added.** A merged chain that partly fails restores as one card, and a chain ending in a vague-only turn approves without a 422 (§8).

One PR fixes one open bug. The PR body carries this line on its own:

```
Fixes #444
```

- **Issue #444**, *Chat: a pending pantry proposal is lost on navigating away and back* (open, `priority:high`). Spec 0 story 13. You send "I bought 2 lemons", don't approve, go to Pantry, and come back. The proposal card is gone and the items can't be added any more. It absorbed issue #358 (closed as a duplicate), including #358's inline-edit criterion.
- **PR #607**, *fix(chat): restore pending pantry proposal on navigate-away-and-back* (open, held on design). This PR replaces it. PR #607 kept "already handled" in this browser's localStorage, keyed by a content signature. The claude[bot] review of 2026-09-23 found two problems. Merged multi-turn cards never match their signature (finding 1). Legacy and cross-device history restores as armed Add cards (finding 2). Both lead to duplicate pantry rows. The bubblychef-bot comment of 2026-09-30 adds a third: after a partial failure, a restore re-offers the rows that already applied. **Close PR #607 when the new PR opens**, with a comment linking it: "superseded by PR #N (server-side outcome)".
- **Issue #311** is **closed**. It was fixed earlier and covered by `pantry-proposal-high-confidence-approve.test.tsx`. The PR body must not claim it (review finding 3 on PR #607).
- **Issue #127**, *duplicate pantry rows under-report available stock in the cook flow* (open), is the harm this design exists to avoid.

**Decision already made (coordinator):** the handled state is stored **server side**, against the persisted chat turn. It is never kept in client storage.

**Slices:** **backend** owns `ai-service/` (§2, §3, and the backend half of §7). **frontend** owns `nextjs/` (§4, §5, §6, the frontend half of §7) and `verify` (§8). Both ship in **one PR**, because it is one vertical feature. The line numbers below were checked on `origin/main` at `1bdc581`. If something lands first, re-locate by symbol.

**Branch:** `fix/issue-444-proposal-review-state`, off current `main`. Don't reuse PR #607's branch. Copy this file into the PR as `docs/plans/2026-09-30-issue-444-proposal-state-contract.md`.

---

## 0. What exists (origin/main `1bdc581`)

**Persistence**
- `conversation_history` (`00001_initial_schema.sql:107-117`) has `id UUID PK`, `user_id`, `conversation_id TEXT`, `role`, `content`, `intent` and `created_at`, with index `(user_id, conversation_id, created_at)`. Migration `00010_add_conversation_history_proposal.sql` added the nullable columns `proposal JSONB` and `metadata JSONB`. RLS (`00002`) covers the whole row. The AI service uses the service-role key, so RLS does not protect it. The `user_id` filters in the repository do.
- `SupabaseRepository.save_message` (`supabase_repo.py` ~1064) inserts one row and returns nothing. It never learns the row id.
- `SupabaseRepository.get_history` (~1086) runs `select("*")` filtered on `user_id` and `conversation_id`, most recent `limit` rows, oldest first. `GET /v1/chat/history/{id}` (`api/routes/chat.py:261`) returns those rows raw, with `limit` defaulting to 20. So every restored turn already carries its `id`, `proposal` and `metadata`.
- **Nothing updates a `conversation_history` row after insert.** History consumers in the workflows read only `role` and `content` (`workflows/chat/nodes.py:240-266`), so extra keys in `metadata` never reach a prompt.

**Stream save timing** (`api/routes/chat.py`)
- `chat_stream` saves the assistant turn **after the generator finishes** (121-146). That is after the envelope has already reached the client. `chat_non_streaming` saves at 230-246.
- The saved `proposal` and `metadata` are the envelope's. **The envelope's `request_id` is not persisted.** It is a fresh `uuid4` per request: the streaming path's initial state sets it at `workflows/router.py:2204`, and the envelope builder falls back to a new `uuid4` at `:170`, and the client has it as `response.request_id`.
- Pantry turns with a proposal get **no follow-up chips**, because `_wants_follow_ups` requires `envelope.proposal is None` (`router.py:2121-2129`). Nothing arrives after their envelope.
- Each pantry turn's persisted `proposal.actions` holds **only that turn's** actions, in the nested `{action_type, item:{name,...}}` shape. The backend's `pending_proposal` memory carries names for its "(still with … from earlier)" text only (`router.py:1225-1383`).

**Apply** (`api/routes/workflows.py`)
- `POST /v1/workflows/apply` takes `ApplyRequest {request_id: UUID, intent, proposal, user_modifications}` (`models/requests.py:9-35`). Extra fields are ignored, not rejected.
- It calls `repo.apply_pantry_proposal(user_id, actions)`, which returns `(applied, failed, errors, affected_item_ids)` (`supabase_repo.py:475-629`). It then logs an ingestion and returns `ApplyResponse {request_id, success = failed == 0, applied_count, failed_count, errors, affected_item_ids}`. It never touches `conversation_history`. The actions arrive **flat**: `{action, name, quantity, unit, category, location}`.
- Per-row failures are reported only as strings: `"Item not found: {name}"`, the #677 unit refusal `"… edit the unit for: {name}"`, `"Item not found for removal: {name}"`, and `"Error processing {action-dict}: {e}"`. The last one has no parseable name.
- The receipt-scan confirm uses the same route. Any new field must be optional.
- Four test files unpack the 4-tuple from `apply_pantry_proposal`: `test_issue_182_estimated_expiry.py`, `test_issue_541_apply_response_affected_ids.py`, `test_issue_677_apply_base_units.py` and the route tests. Keep that signature.

**Next.js proxy** (`app/api/ai/workflows/apply/route.ts`)
- It forwards the body unchanged through `aiProxyJson`.
- On `success === true` it awards `pantry_add` bubbles per add action, with `ref_key = ${request_id}:${name}`.
- The ledger has `UNIQUE (user_id, event_type, ref_key)` (`00011:63`), so the award is idempotent **only if the same `request_id` is reused**. PR #607 minted a fresh `crypto.randomUUID()` per restored card, which re-awarded on every restore-and-approve.

**Frontend** (`nextjs/src/hooks/useChat.ts`)
- `PendingProposal {requestId, actions}` (16-19).
- The restore mapper runs from 182 to 225. `canRestoreCard` (197-200) **excludes `pantry_update`**. The restored response has `request_id: ''` and `requires_review: false`.
- The live merge (`onDone`, ~338-515):
  - It searches for the nearest earlier pantry card with actions whose `proposalStates` entry is `pending` or **absent**.
  - It moves that card forward to the new turn, strips the old turn's `proposal`, and merges actions with `mergeActions`, where a later action with the same name replaces the earlier one. It also strips the "(still with…)" prefix from the text.
  - It migrates `pendingProposals[target]` to the new id, with `requestId = response.request_id ?? original.requestId`.
- `approveProposal` (620-690): after PR #686, a partial failure narrows `pendingProposals[msgId].actions` to `result.failedActions` and records `proposalFailedNames[msgId]` as `proposalActionKey`s. `updateProposalActions` (699-710) filters edits to the pending set.
- `rejectProposal` (719-721) is client-only. The AI service has no reject operation.
- `lib/api/chat.ts` `applyPantryProposal(requestId, actions)` posts to `/api/ai/workflows/apply`. It rebuilds `failedActions` by regex over the error strings. When no name parses, it leaves the list `undefined`, and the retry then resends **every** pending row.
- `types/chat.ts`: `ConversationHistoryTurn {role, content, intent, proposal?, metadata?, created_at}` (373-380) has no `id`. `proposalActionKey(a) = a.item.name.trim().toLowerCase()` (535-537).

**Frontend** (`app/chat/page.tsx`, `components/chat/PantryProposalCard.tsx`)
- The card is passed `state={proposalState ?? 'pending'}` (`page.tsx:1323`). **A restored card with no seeded state renders armed buttons**, and approve then silently no-ops if `pendingProposals` has no entry.
- The card's terminal branches are "✓ Added to pantry!" (`PantryProposalCard.tsx:356-361`) and "Skipped" (363). Rows are read-only unless the state is `pending` or `failed`. After a partial failure, `failedNames` opens the editor only on retryable rows (#686, lines 283-296).

---

## 1. Where the state lives: `conversation_history.metadata`, no migration

**No migration.** Both JSONB columns and the row `id` already exist. Lookups stay inside the existing `(user_id, conversation_id, created_at)` index. A conversation is small (the route caps reads at 200 rows), so a JSONB path filter needs no new index.

Two reserved keys go on an **assistant `pantry_update` turn's** `metadata`:

```jsonc
{
  // ...whatever the envelope's metadata already held (clarification_suggestions, etc.)
  "request_id": "7f0c…",            // stamped at save time = envelope.request_id (string UUID)
  "proposal_review": {              // absent until the first apply or reject on this turn
    "status": "applied" | "failed" | "rejected",
    "applied_keys": ["lemon"],      // cumulative, never shrinks: keys of THIS turn's rows that applied
    "failed": [                     // this turn's rows that failed on the LATEST attempt, as sent (edits included)
      { "key": "spinach", "name": "Spinach", "quantity": 3, "unit": "cup" }
    ],
    "error": "Units don't match (cup vs bag), edit the unit for: spinach",  // first error of the latest attempt, or null
    "chain_request_ids": ["a1…", "7f0c…"],  // R2: the turn_request_ids of the LATEST apply or reject, oldest first
    "updated_at": "2026-09-30T12:00:00+00:00"
  }
}
```

- **Key** means `name.strip().lower()`. Define `proposal_action_key(name: str) -> str` once in `bubbly_chef/services/proposal_review.py`, with a comment pointing at the TypeScript `proposalActionKey`. Both sides must stay the same expression.
- **A turn's own keys** are the keys of the persisted `proposal.actions[*].item.name`. **Live rows** are own keys minus `applied_keys`. That invariant, *"a restored card never offers a row in `applied_keys`"*, is what the 2026-09-30 comment asks for.
- `status` is derived on each write:
  - `rejected` if the last operation was a reject;
  - otherwise `applied` when no live rows remain;
  - otherwise `failed`, meaning an attempt ran and rows remain. This covers partial and total failure alike, and it maps 1:1 onto the frontend's existing `proposalStates` values.
- `proposal` is left as the pristine original offer. Legacy detection (§6) and the card's row list both read it.
- The Pydantic model is `ProposalReview` in `models/proposals.py`, with `status: Literal[...]`, `applied_keys: list[str]`, `failed: list[FailedRow]`, `error: str | None`, `chain_request_ids: list[str]` (R2, default `[]`) and `updated_at: datetime`. Reads validate it. A malformed value is treated as absent and logged at warning.

**Why `metadata` and not a nested key in `proposal`:** `proposal` is the card payload, typed as `PantryProposalData` on both sides. Adding lifecycle to it would change that type and mix the offer with its outcome. The only risk to `metadata` is a clobber by a later writer, and none exists: pantry-proposal turns get no follow-ups, and nothing else updates history rows. Pin that in a test (§7, B9) and in a comment on `save_message`.

---

## 2. How apply and reject record the outcome (backend)

### 2a. Stamp the turn, and save a pantry proposal turn *before* its envelope is sent
Without this, a fast tap on Add can reach `/v1/workflows/apply` before the tail-of-stream insert, so the outcome has no row to land on.

- In `chat_stream`, inside the loop, when `event_type == "envelope"` and the envelope has `intent == "pantry_update"` and a non-null `proposal` (R2: **including zero-action, vague-only turns**, which join a chain as its owner; §4):
  - call `save_message(...)` **before** `yield`ing that envelope event;
  - use `content = assistant_message or envelope.assistant_message`, since the tokens precede the envelope;
  - set `metadata = {**(envelope.metadata or {}), "request_id": envelope["request_id"]}`;
  - set a `saved_assistant = True` flag, and skip the tail save (121-146) when it is set.

  All other intents keep today's timing, because their follow-up chips arrive after the envelope and are folded into the saved metadata.
- In `chat_non_streaming` there is no race, because the response is returned after the save. Only stamp `metadata.request_id` for the same turns.
- A save failure stays a logged warning, as today. The turn then simply has no row, and restore shows nothing, the same as main. It must not break the stream.
- Stamp **every** `pantry_update` turn that has a proposal, whether or not it has actions (R2). A zero-action turn owns the merged card when it comes last in a chain. Without an id, its restored `turnRequestIds` would hold a null, and `ApplyRequest`'s UUID validation would 422. Those turns get no follow-ups either (`proposal` is not None), so the save-before-envelope move is safe for them too. Other intents are not stamped (§9.14).

### 2b. Repository methods (`supabase_repo.py`). Every one takes `user_id` first and filters on it
- `get_turns_by_request_ids(user_id, conversation_id, request_ids: list[str]) -> list[dict]` does `select("id,proposal,metadata")`, then `.eq("user_id", user_id)`, `.eq("conversation_id", conversation_id)`, `.eq("role", "assistant")` and `.in_("metadata->>request_id", request_ids)`. The request ids arrive as validated UUIDs, so there's no injection surface. If postgrest-py rejects `in_` on a JSON path, use `.filter("metadata->>request_id", "in", "(a,b)")`. Record which form works in the PR.
- `set_turn_metadata(user_id, turn_id, metadata: dict) -> bool` does `.update({"metadata": metadata}).eq("id", turn_id).eq("user_id", user_id)`. It returns whether a row matched.
- `apply_pantry_proposal_detailed(user_id, actions) -> PantryApplyResult` is a frozen dataclass with `applied`, `failed`, `errors`, `affected_item_ids`, `failed_indices: list[int]` (indices into `actions`) and `failed_errors: dict[int, str]`. Move the loop body into it and record the index at each of the **four** failure sites: the `update`/`use` not-found branch, the `use` refusal, `remove` not-found, and the generic `except Exception` (R3 wording; B13 tests them as five cases). `apply_pantry_proposal` becomes a one-line wrapper that returns the same 4-tuple, so the existing tests are untouched.

### 2c. Service: `bubbly_chef/services/proposal_review.py` (pure logic plus one orchestration function)
Pure functions, with no I/O:
- `own_keys(turn_row) -> set[str]`. R2: **tolerant.** If `proposal` is not a dict, or `actions` is not a list, the result is `set()`. Skip any action that isn't a dict, has no dict `item`, or whose `item.name` isn't a non-empty string. It never raises.
- `read_review(metadata) -> ProposalReview | None`, tolerant of malformed values.
- `review_after_apply(turn_row, sent_actions, failed_indices, failed_errors, chain_request_ids, now) -> ProposalReview`:
  - R2: **`sent_actions` is the list after the guard** (step 3 below), meaning exactly the list handed to `apply_pantry_proposal_detailed`. `failed_indices` and the keys of `failed_errors` are indices into that list, never into `request.proposal.actions`;
  - set `chain_request_ids` to the request's `turn_request_ids`, as strings in request order;
  - start from `applied_keys = previous.applied_keys` (or `[]`);
  - for each sent action with a key in this turn's own keys: if it didn't fail, add its key to `applied_keys`; if it failed, add a `FailedRow` taken from the **sent** action's name, quantity and unit;
  - set `error` to the first failed error for this turn's rows, else `None`;
  - derive `status` as in §1. A turn that was `rejected` and is then applied (a stale second device) takes the derived status. The latest user action wins.
- `review_after_reject(turn_row, chain_request_ids, now) -> ProposalReview` sets `status = "rejected"`, keeps `applied_keys` and `failed`, sets `error = None`, and records `chain_request_ids`.
- `already_applied(turn_rows) -> set[str]` returns the union of `applied_keys` across the named turns.

Orchestration:
- `apply_with_review(repo, user_id, request) -> ApplyResponse`, called by the route:
  1. If `request.turn_request_ids` is empty (the scan confirm, or an old client), run exactly today's path. No history reads or writes.
  2. Load the named turns with `get_turns_by_request_ids`. Ids not found (a foreign id, or a legacy turn) are ignored and logged at info.
  3. **Server-side guard.** Drop every incoming action whose key is in `already_applied(turns)`, and report those names in `already_applied_names`. This keeps an applied row from applying twice, even from a stale open tab or a second device whose card was never remounted, or from a retry after a lost response. If nothing remains, return `success=True, applied_count=0` without calling the repo.
  4. Call `apply_pantry_proposal_detailed` with the remaining actions, `sent_actions`. The response's `failed_names` are the keys of `sent_actions[i]` for each `i` in `failed_indices`.
  5. For each loaded turn, write `review_after_apply(...)` into `metadata.proposal_review` with `set_turn_metadata`. R2: **the whole step, per turn, sits inside one `try/except Exception`**: reading the old review, `own_keys`, computing the new review, building the merged metadata dict, and the write. A malformed row, a validation error or a write failure is logged at warning with the turn id and request id. It never changes the apply result and never produces a 500 after the pantry write. That turn is then missing from `recorded_turn_request_ids`, and the other turns are still recorded.

  The guard's read (step 2) may fail as well. If it does, log it and continue with no guard and no recording. The pantry write result is still returned.
  6. Log the ingestion as today.

### 2d. Models (`models/requests.py`). All changes are additive
- `ApplyRequest` adds:
  - `conversation_id: str | None = None`;
  - `turn_request_ids: list[UUID] = Field(default_factory=list, max_length=200)`. R3 raised it from 20, because a long pending chain of add-then-clarify turns must never 422. 200 matches the history route's own `le=200` read cap;
  - a `model_validator` that rejects non-empty `turn_request_ids` without a `conversation_id` (422).
- `ApplyResponse` adds three fields:
  - `failed_names: list[str] = []`, the **keys** of the failed sent actions from `failed_indices`, so the client no longer has to regex error strings;
  - `already_applied_names: list[str] = []`;
  - `recorded_turn_request_ids: list[UUID] = []`.
- New: `RejectRequest {conversation_id: str, turn_request_ids: list[UUID] (min 1, max 200)}` and `RejectResponse {recorded_turn_request_ids: list[UUID]}`.

### 2e. Routes (`api/routes/workflows.py`). They stay thin
- The `pantry_update` branch of `apply_proposal` delegates to `apply_with_review`. The `recipe_card` branch is unchanged.
- New `POST /v1/workflows/reject` (`Depends(get_current_user_id)`). It loads the turns, writes `review_after_reject` into each, and returns `RejectResponse`. Unknown ids are ignored with a 200. There is no pantry write and no bubbles.

### 2f. The three outcomes
| Outcome | What is recorded per chain turn | Restore (§5) |
|---|---|---|
| **Applied** (all sent rows succeeded, no live rows left) | `status: applied`, `applied_keys` = own keys | read-only "Added to pantry!" |
| **Partially applied** | `status: failed`, `applied_keys` = the rows that landed, `failed` = the rows that failed, with sent values, and `error` | card in `failed`: applied rows read-only, only the failed rows live with the editor open, "Try again" |
| **Rejected** | `status: rejected`, earlier `applied_keys` kept | read-only "Skipped" |

A retry of a partial card sends only the live rows (the frontend already narrows them). The guard drops anything already applied. The next write accumulates `applied_keys`, and the status becomes `applied` once no live rows remain.

---

## 3. Ownership

- Every new repository method takes `user_id` first and filters on it, on reads **and** writes (`set_turn_metadata` filters on `id` **and** `user_id`). Follow the `claim_meal_cook` and `mark_meal_cook_applied` pattern.
- `user_id` comes only from `get_current_user_id` (the JWT). It is never read from the body.
- **A user can't mark another user's turn.** A request naming another user's `conversation_id` or `request_id` matches zero rows, so nothing is recorded, nothing is guarded, and the response omits the ids. For apply, the caller's own pantry write still runs; it only ever touches the caller's own pantry. For reject, it is a no-op 200. Don't return 404 or 403, which would tell the caller whether someone else's id exists.
- The frontend's reject call goes direct to the AI service through `aiFetch`, with a Bearer token, the same as history. Apply stays on the Next.js proxy, which runs `requireAuth()` and awards bubbles.

---

## 4. Merged multi-turn proposals: the card's identity (claude[bot] finding 1)

**A card's identity is the ordered list of persisted turn request ids it spans.** `PendingProposal` becomes:

```ts
interface PendingProposal {
  requestId: string          // the owning (latest) turn's request_id, sent as ApplyRequest.request_id
  actions: PantryProposalAction[]
  turnRequestIds: string[]   // every chain turn, oldest first; sent as turn_request_ids
}
```

- **Live, a fresh card:** `turnRequestIds: [response.request_id]`.
- **Live, a merge** (the `mergeTargetId` branch, ~459-497): `turnRequestIds: [...originalPending.turnRequestIds, response.request_id]`. The same applies to a vague-only turn with zero actions: it joins the chain because it owns the card.
- **On apply:** send `request_id = pending.requestId`, `conversation_id` and `turn_request_ids = pending.turnRequestIds`.
  - R3: `approveProposal` and `rejectProposal` read the **current** conversation id through a `conversationIdRef`, mirrored by an effect like `messagesRef`, or by listing `conversationId` in the `useCallback` deps. Never read it from a stale closure: on a fresh mount, `conversationId` is set inside the resume effect after the first render.
  - When the id is `null`, `approveProposal` calls `applyPantryProposal(requestId, actions)` **without** the `review` argument, and `rejectProposal` makes no server call. Both behave as main does. The server attributes each sent row to every chain turn whose **own** keys contain it (§2c). A row present in both A and B (B replaced A's lemon quantity in `mergeActions`) is sent once and marks both turns' `lemon` applied. The content signature and the "(still with…)" prefix no longer matter, because nothing is matched on text.
- **On reject:** every chain turn gets `rejected`.
- A zero-action chain turn has no own keys. `review_after_apply` gives it `applied` (no live rows), and reject gives it `rejected`. It carries its own `request_id` (R2, §2a), so a chain it ends restores and approves with valid UUIDs. Its restore renders no card by itself (§5), but it can own a merged card.
- `requestId` stays the owning turn's persisted id on restore as well. That keeps the bubbles `ref_key` stable, so a re-approve after a restore can't award twice.

---

## 5. The restore mapper

Extract it as a pure module, `nextjs/src/lib/chat-restore.ts`:

```ts
export function buildRestoredThread(
  turns: ConversationHistoryTurn[],
  conversationId: string,
): {
  messages: ChatMessage[]
  pendingProposals: Record<string, PendingProposal>
  proposalStates: Record<string, 'pending' | 'approved' | 'rejected' | 'failed'>
  proposalErrors: Record<string, string>
  proposalFailedNames: Record<string, string[]>
}
```

Move `PendingProposal` into `types/chat.ts` (exported) so both files use it. `useChat`'s `.then` calls this once and sets all five states. Add typed readers to `types/chat.ts`:
- `readTurnRequestId(metadata): string | null`;
- `readProposalReview(metadata): ProposalReview | null`, tolerant, and returning null on any malformed value.
- R2: `readPantryActions(proposal: unknown): PantryProposalAction[] | null`. It returns `null` unless `proposal` is an object whose `actions` is an array in which every entry has a string `action_type` and an `item` object with a non-empty string `name`. An empty array is valid and returns `[]`. `metadata` may be `null`, and every reader must accept that.

**Malformed data never clears the conversation (R2).** A `pantry_update` turn whose `readPantryActions` returns `null`, or whose `metadata` is null or not an object, is classified **legacy**: text bubble, no card, no state. `buildRestoredThread` must not throw on any single turn. Wrap the per-turn classification so that a throw degrades that turn to its text-only `base`. Only a failed `fetchChatHistory` or an empty history may reach `clearStoredConversationId()` in `useChat`, as on main. A bad row must not.

**Reused from PR #607** (the sound parts):
- drop the `turn.intent !== 'pantry_update'` exclusion from `canRestoreCard`;
- seed `pendingProposals` and `proposalStates` for restored live cards;
- reuse test 1's skeleton.

**Dropped from PR #607:** `chat-proposal-storage.ts`, the content signature, and the fresh random `requestId`.

For each assistant `pantry_update` turn where `readPantryActions` returns a non-empty list, classify it and act. Zero-action turns only take part in the chain merges below.

| Class | Condition | Message `response.proposal` | Seeded state |
|---|---|---|---|
| **legacy** | no `metadata.request_id` | `null` (no card; the text bubble only) | nothing |
| **pending** | `request_id`, no `proposal_review` | the original actions (possibly merged, see below) | `proposalStates = 'pending'`, `pendingProposals = {requestId, actions, turnRequestIds}` |
| **partial** | `proposal_review.status === 'failed'` | all original rows (the applied ones render read-only), **with the live rows' `quantity` and `unit` overlaid from `failed[]` by key** (R2), so the card displays exactly what Try again sends | `'failed'`; `pendingProposals.actions` = live rows (own minus `applied_keys`), with the same overlay; `proposalFailedNames` = live keys; `proposalErrors` = `review.error ?? 'Some items could not be added. Please try again.'`; `turnRequestIds` = its chain (see below), else `[thisTurn]` |
| **applied** | `status === 'applied'` | the original actions | `'approved'`; **no** `pendingProposals` entry |
| **rejected** | `status === 'rejected'` | the original actions | `'rejected'`; no `pendingProposals` entry |

Rules:
- **Every restored card gets an explicit `proposalStates` entry.** Otherwise `page.tsx:1323` defaults it to `'pending'`, and the live merge search (which treats *absent* as pending) would pick a handled or legacy card as a merge target. Legacy turns have `proposal: null`, so they are never merge candidates, because the search requires actions.
- **Partial** reuses #686 unchanged. `failed` state plus `failedNames` makes the card open the editor on exactly the live rows and keep the applied rows read-only. `updateProposalActions` already filters edits to the pending set.
- **Replaying the merge for pending turns only.** Walk the turns in order and keep `openId`, the nearest earlier restored card whose class is **pending**. The live `onDone` (`useChat.ts:340-360`) merges **any** incoming `pantry_update` turn into an open card, zero-action included. Only the *target* needs actions. R3: so when a pending turn, or **any zero-action `pantry_update` turn that has a `metadata.request_id`**, follows an `openId`, do what live `onDone` does:
  - set this turn's proposal to `{...target, actions: mergeActions(target.actions, this.actions)}`;
  - null the target's proposal and its `clarification_suggestions`;
  - merge the clarifications with `mergeTermSuggestions` and `filterResolvedTerms`;
  - move `pendingProposals` to this id with `turnRequestIds = [...target.turnRequestIds, this.request_id]`, and move its `proposalStates` entry to this id as `'pending'`;
  - **R3: set `openId` to this turn**, the new owner, so the next turn merges into the moved card and not the stripped one.

  There is no clarification-suggestions condition. A zero-action turn **without** a `request_id` (legacy or malformed) never joins, so no null can enter `turnRequestIds`, and `openId` is unchanged. A zero-action turn with no `openId` before it renders as today: a ClarificationCard or the text only.

  A partial, applied, rejected or legacy turn is **not** a merge target, the same as live. Don't strip the "(still with…)" prefix on restore: the text is shown as persisted, and nothing keys on it.

  **Why replay rather than independent cards:** B's persisted actions can repeat an item from A (for example "actually 3 lemons"). Two independent pending cards would both offer lemons, and approving both writes two rows. That is the #127 harm. Replaying `mergeActions` gives one lemon row, as the user saw before navigating.
- **R2: failed turns in one chain restore as ONE card.** Group the **group members**: the `failed`-class turns plus any zero-action `pantry_update` turn whose `proposal_review.chain_request_ids` are identical and non-empty. A zero-action turn records as `applied`, having no own keys, but it still joins its chain's group. R3: the **owner is the last group member in turn order**, not the chain's last id. Chain members outside the group, meaning `applied` or `rejected` turns that have actions, **keep their own classification** from the table: a read-only card with their own rows. For each group:
  - the owner's `response.proposal.actions` = `mergeActions` over the **group members'** own actions, oldest first, with each member's own failed values overlaid first;
  - the live rows are the merged rows whose key is in no restored chain turn's `applied_keys`, whether or not that turn is a group member;
  - `pendingProposals[owner] = {requestId: owner, actions: live rows, turnRequestIds: chain_request_ids}`, the **whole** chain, so a retry re-records every chain turn;
  - R3: `proposalStates[owner] = 'failed'`, even when the owner is a zero-action turn that recorded `applied`;
  - `proposalFailedNames` = the live keys;
  - `proposalErrors` = the owner's `error`, else the first non-null `error` among the members, else the generic line;
  - every other **group member's** `proposal` is `null`, with no state entry. Non-members are untouched.

  **Why:** spinach sent once from a merged card, and failing, is recorded in A's and in B's `failed`. Restoring them independently gives two live spinach rows, and retrying both writes spinach twice. That is the #127 harm again. A `failed` turn with an empty or missing `chain_request_ids` restores alone, as in the table.
- **Applied and rejected turns restore independently**, each with its own actions and its own terminal state. A two-turn chain that was approved restores as two read-only "Added" cards, not one merged card. That is cosmetic only, with no write risk, because neither card can write (§9.8).
- The restored `ChatResponse.request_id` is set to the persisted `request_id`, not `''`. The rest of the `canRestoreCard` defaults stay as they are.

### Applied and rejected: a read-only terminal card, not "no card"
**Chosen:** render the existing read-only card with "✓ Added to pantry!" or "Skipped".
- It matches what the user saw before navigating, since the live thread keeps the card in its terminal state.
- It is visible confirmation across devices that the items really landed. The issue's own impact line is that "a user who navigates away reasonably assumes the pantry was updated".
- It needs no new UI: `PantryProposalCard.tsx:356-363` already renders both states read-only.

**Rejected alternative:** no card (PR #607's `proposal: null`). It loses the record of what was added, and it makes the thread read differently after a reload than before one.

---

## 6. Legacy turns (persisted before this change)

**Decision: legacy turns are not actionable.** They restore as the text bubble with no card, exactly as on main today.

- A legacy turn has no `request_id` and no outcome. Apply never touched history rows, so **nothing distinguishes "approved last week" from "never approved"**. Restoring it armed would re-offer items that are probably already in the pantry, and one tap writes a duplicate row (issue #127). That is review finding 2.
- Even if we armed it, an approve couldn't be recorded (there's no id to record against), so the card would come back armed on every restore.
- A disabled card with an unknown state was considered. It adds a new third card state for a transitional cohort that shrinks to nothing. The text bubble already says what was proposed.
- This is forward-only, like 00010's own "old cards stay dead" note. The cost is that a legacy proposal the user really never approved can't be approved from history. They can resend the message. Say so in the PR body's "not covered" section.

**Deploy order is safe either way.** If only the backend lands, new turns are stamped and the old frontend ignores the extra fields. If only the frontend lands, unstamped turns classify as legacy (no card), and the apply fields are ignored by the old `ApplyRequest`.

---

## 7. Tests (each fails on main). Fakes only, no live model and no network

### Backend (pytest): new `ai-service/tests/test_issue_444_proposal_review_state.py`
Use the route harness from `test_issue_541_apply_response_affected_ids.py` (`create_app`, `dependency_overrides[get_current_user_id]`, `ASGITransport`). Use a fake history table that records filters and holds rows for **two users**.

Pure `proposal_review` tests:
- **B1:** all rows applied gives `applied`, and `applied_keys` equals the own keys.
- **B2:** a partial result (lemon applied, spinach failed with edited `quantity: 3`) gives `failed`, with `applied_keys: ["lemon"]`, `failed[0]` holding the **sent** quantity 3, and `error` set.
- **B3:** retrying B2 with only spinach succeeding accumulates to `applied_keys: ["lemon", "spinach"]` and status `applied`.
- **B4:** keys normalise `"  Spinach "` to `spinach`.
- **B5:** a merged chain. Turns A (lemon, spinach) and B (carrot, lemon) are sent as lemon, spinach and carrot, with spinach failing. A becomes `failed` with lemon applied, and B becomes `applied`.
- **B5b (R2):** a merged chain where spinach is repeated. A has lemon and spinach, B has spinach and carrot, and the chain is sent as lemon, spinach and carrot with spinach failing. A and B both come out `failed`, each with `failed == [spinach]` and `chain_request_ids == [A, B]`. A has lemon in `applied_keys`, and B has carrot.
- **B6:** a reject keeps `applied_keys` and records `chain_request_ids`.

Route tests:
- **B7:** apply with `conversation_id` and `turn_request_ids` writes `metadata.proposal_review` to that user's row. The response has `recorded_turn_request_ids` and `failed_names`, the latter from the index and not from regex. Include one row that fails with the `"Error processing {…}"` shape, and assert its key is still in `failed_names`.
- **B8, the guard.** The turn already has `applied_keys: ["lemon"]`. Apply lemon and carrot. The repo receives only carrot, and the response has `already_applied_names: ["lemon"]` and `success: true`.
  - R2 case, where carrot also fails: the fake fails index 0 of the **post-guard** list, which is carrot. Expect `failed_names == ["carrot"]` (not lemon), lemon still in `applied_keys`, and the turn's `failed == [carrot]` with status `failed`.
- **B9, ownership.** User B applies and rejects naming user A's request id. User A's row is byte-identical afterwards, and `recorded_turn_request_ids == []`. Every fake query and update recorded `user_id == caller`.
- **B10 (R2, reworded so it fails on main):** apply with no turn fields (the scan path) makes zero history reads or writes. The response JSON **contains** `failed_names: []`, `already_applied_names: []` and `recorded_turn_request_ids: []`. Main's `ApplyResponse` has none of these keys, so the assertion fails there.
- **B11:** `POST /v1/workflows/reject` records `rejected`; it returns 401 without auth and 422 on an empty list. A non-empty `turn_request_ids` without `conversation_id` on apply returns 422.

Stream route test (in `test_chat_routes.py`, or the new file, with a faked `run_chat_workflow_streaming`):
- **B12:** a `pantry_update` envelope with actions leads to `save_message` being called **before** the envelope SSE line is yielded (assert via an ordered event log), with `metadata.request_id == envelope.request_id`, and **exactly one** assistant save. A `general_chat` turn keeps the tail save and gets no `request_id`.

Repository test:
- **B13 (R2 wording):** `apply_pantry_proposal_detailed` reports `failed_indices` at **four code sites, tested as five cases**:
  - the `update`/`use` not-found branch, one site tested twice, once for `update` and once for `use`;
  - the `use` refusal (#677);
  - `remove` not-found;
  - the generic `except Exception`.

  `apply_pantry_proposal` still returns the old 4-tuple, and the existing 541 and 677 tests pass untouched.
- **B14 (R2; R3 gives the expected result per row):** one apply names six turns plus one well-formed sibling. Every case returns 200 with the real pantry result, and nothing raises out of step 5.

  | Named turn | Expected |
  |---|---|
  | `proposal: "garbage"` | `own_keys` gives `set()`, and the turn is **recorded** with `status: applied` (no own keys means no live rows) |
  | `proposal: {"actions": "x"}` | the same: recorded, `applied` |
  | `proposal: {"actions": [{"item": null}]}` | the same: recorded, `applied` |
  | `metadata.proposal_review` malformed (for example `{"status": 7}`) | the review is read as absent and the turn is **recorded** with a fresh review (`applied` or `failed` by its own keys) |
  | `metadata` is not a dict (for example `"x"` or a list) | **excluded** from `recorded_turn_request_ids`, and the row is unchanged |
  | a well-formed turn whose `set_turn_metadata` raises | **excluded** from `recorded_turn_request_ids` |
  | the well-formed sibling | **recorded** |

  Only the last two failure kinds (non-dict metadata, or a raising write) exclude a turn.

### Frontend (jest)
New `nextjs/src/__tests__/chat-restore.test.ts`, the pure `buildRestoredThread`:
- **F1, pending.** A card with the original actions, `pending`, and `pendingProposals` holding `{requestId: <persisted>, turnRequestIds: [<persisted>]}`.
- **F2, applied.** `'approved'` with the proposal kept (the card renders) and **no** `pendingProposals` entry.
- **F3, rejected.** `'rejected'` with no pending entry.
- **F4, partial.** Own rows lemon and spinach (original `quantity: 1`), `applied_keys: ["lemon"]`, and `failed: [{key: "spinach", quantity: 3}]`. The result is `'failed'`, `proposalFailedNames == ["spinach"]`, pending actions are spinach only with `quantity: 3`, and the error is populated. R2: the message's `response.proposal.actions` spinach row **also** shows `quantity: 3` (the displayed value matches what is sent), and lemon keeps its original values.
- **F4b (R2, a merged chain partly failed).** A has lemon and spinach; B has spinach ×2 and carrot. Both are `failed` with `chain_request_ids: [A, B]`: A has `applied_keys: [lemon]`, B has `applied_keys: [carrot]`, and both have `failed: [{spinach, quantity: 4}]`. Expect **one** card, on B, with A's proposal `null`. Its displayed actions are lemon, spinach ×4 and carrot. The pending actions are spinach ×4 only, `turnRequestIds == [A, B]` and `proposalFailedNames == ["spinach"]`. Approving sends spinach once.
- **F4c (R3, a mixed chain).** A has lemon and spinach and is `failed`, with `applied_keys: [lemon]` and `failed: [spinach]`. B has carrot and is `applied`, with `applied_keys: [carrot]`. Both have `chain_request_ids: [A, B]`.
  - A is the only group member, so it is the owner: `proposalStates[A] = 'failed'`, only spinach is live, `turnRequestIds == [A, B]`, and its displayed rows are A's own (lemon read-only, spinach editable).
  - B keeps its own classification: `proposalStates[B] = 'approved'`, a read-only card showing carrot, and no `pendingProposals` entry.
- **F5, legacy.** `proposal: null` with no state entries.
- **F6, pending chain.** A (lemon ×2) then B (carrot, lemon ×3). There is one card on B with lemon ×3 and carrot, A's proposal is null, and `turnRequestIds == [A, B]`.
- **F6b (R3, `openId` moves with the card).** Pending turns in order: A (lemon ×2), then a zero-action Z with a `request_id` and **no** clarification suggestions, then C (lemon ×3). Expect **one** card, on C, showing lemon ×3; the proposals of A and Z are `null`; `turnRequestIds == [A, Z, C]`; and there is only a `proposalStates[C]` entry. A variant where Z has no `request_id` expects `[A, C]`, with no null.
- **F7:** a pending turn after an applied turn does **not** merge into it.
- **F8:** a malformed `proposal_review` is treated as absent, meaning pending when `request_id` is present.
- **F17 (R2, a vague-only tail).** A (lemon, `request_id` A) is followed by a zero-action B (`request_id` B, with clarification suggestions), both pending. Expect one card on B with `turnRequestIds == [A, B]`, both valid UUID strings with no null. In the `use-chat-persistence` harness, approving calls `applyPantryProposal` with `{turnRequestIds: [A, B]}`. The mocked proxy mirrors the backend's UUID validation and returns 422 on any non-UUID id, and the state ends `'approved'`.
- **F18 (R2, malformed; R3 keeps both halves in this one test).** The history holds a `pantry_update` turn with `proposal: {actions: "oops"}` and `metadata: null`, one with `proposal: {actions: [{item: null}]}`, and a normal pending turn.
  - Pure `buildRestoredThread` assertions: no throw, the two bad turns come back as text-only legacy with no state, and the good turn is live.
  - The same fixture through the hook (**label this block a regression guard**: main already survives these turns, because it never reads a pantry proposal; this block guards the new mapper against clearing the conversation): `localStorage['bubblychef:chat:conversationId']` is **still set**, and `conversationId` is non-null.

Extend `use-chat-persistence.test.ts` (the `#444` describe; start from PR #607 test 1):
- **F9:** a restored pending card, when approved, calls `applyPantryProposal` with the persisted `requestId`, and with `{conversationId, turnRequestIds}`.
- **F10:** a restored partial card, when retried, sends spinach only, and lemon is never sent.
- **F11:** a restored applied card: `approveProposal` makes no call, and `proposalStates` stays `'approved'`.
- **F12:** a restored legacy or applied turn, followed by a **live** pantry turn (mocked `streamChatMessage`), gives the live card `turnRequestIds == [live request_id]`, so nothing merges into history.
- **F13 (R3):** start from a **fresh hook** with a stored conversation id `CONV` and empty history. Run a live two-turn merge (mocked `streamChatMessage`, request ids A and B), then approve. `applyPantryProposal`'s third argument is `{conversationId: CONV, turnRequestIds: [A, B]}`: the sent id **equals the stored id**, which is the stale-closure check. Also, with no stored id (a brand-new chat), the first live turn mints an id, and approve sends that minted id, not `null`. A direct call with `conversationId === null` omits the third argument.
- **F14:** `rejectProposal` calls `rejectPantryProposal(conversationId, turnRequestIds)`. A rejected promise leaves the state `'rejected'` and does not throw.

Extend `apply-pantry-proposal.test.ts`:
- **F15:** the request body includes `conversation_id` and `turn_request_ids` when given, and omits them when not.
- **F16:** `failed_names` in the response takes precedence over the regex. With `failed_names` present and an unparseable error string, `failedActions` is still the right subset.

**One permitted edit to an existing test (R2).** `pantry-proposal-high-confidence-approve.test.tsx:92` asserts `applyPantryProposal` was called with two arguments. Update it to add the new third argument: `{ conversationId: expect.any(String), turnRequestIds: ['req-high-confidence'] }`. No other existing assertion may be loosened.

Existing suites must stay green, test counts must not drop, and no test may be skipped: `pantry-retry-failed-only`, `pantry-card-merge`, `pantry-proposal-inline-qty` and `pantry-proposal-high-confidence-approve`.

### Frontend client change (`lib/api/chat.ts`)
- Change the signature to `applyPantryProposal(requestId, actions, review?: {conversationId: string; turnRequestIds: string[]})`. It adds `conversation_id` and `turn_request_ids` to the body only when `review` is given.
- Derive `failedActions` from `data.failed_names` when that is a non-empty array. Keep the regex path as the fallback for older backends.
- New `rejectPantryProposal(conversationId, turnRequestIds): Promise<void>`, sent via `aiFetch('/v1/workflows/reject', …)`. It throws on non-2xx.

---

## 8. `verify` (375×812; screenshots as absolute `blob/<sha>/…?raw=true` URLs)

Run the `verify` skill: a production build on the worktree's ports, with the real AI service, the real Next.js proxy and the real hosted Supabase. **Only `/v1/chat/stream` is mocked** (there is no live model, and Ollama is not used). Apply, reject, history and the recording path are all real. Full demo media goes to the scratchpad, and only the PR screenshots go under `docs/media/issue-444/`.

**Why rows are seeded:** the mocked stream never reaches the AI service, so no turn is persisted. A scratch script (not committed) uses the service-role key from `nextjs/.env.local` and the e2e test user. It inserts the rows the real stream route would have written, with the exact §1 shape (`metadata.request_id` stamped). B12 covers the stamping itself. Say this in the PR body.

Setup:
- `page.addInitScript` sets `localStorage['bubblychef:chat:conversationId'] = CONV` to a fixed UUID.
- `page.route('**/v1/chat/stream', …)` fulfils with the following. The format is the same as `e2e/guest-walkthrough.spec.ts:114-116`.
  ```
  event: envelope
  data: {"type":"envelope","data":{"intent":"pantry_update","assistant_message":"Got it! I'll add 2 lemons and use 1 dragonfruit.","request_id":"<RID1>","workflow_id":"w","conversation_id":"<CONV>","confidence":{"overall":0.9},"requires_review":true,"next_action":"review_proposal","proposal":{"actions":[{"action_type":"add","item":{"name":"lemon","quantity":2,"unit":"whole","category":"produce","storage_location":"fridge"},"confidence":0.9},{"action_type":"use","item":{"name":"dragonfruit","quantity":1,"unit":"whole"},"confidence":0.9}]},"metadata":{}}}
  ```
  Right after the send, the script inserts the matching user and assistant rows (`proposal` = the actions above, `metadata = {"request_id": RID1}`). "dragonfruit" must not be in the test user's pantry, so the `use` fails with "Item not found".

Walk:
1. **Pending survives.** Send, and the card appears. Go to `/pantry`, then back to `/chat`. The card is there with armed Add and Dismiss. *(screenshot)*
2. **Partial.** Tap Add. The live card goes to `failed`, with lemon read-only and dragonfruit's editor open. Go to `/pantry` and check that lemon went up by exactly 2 (`GET /api/pantry`). Go back to `/chat`: the card is **still `failed`**, with the same read-only and editor split and the error shown. *(screenshot)* Read the row with the script and paste its `proposal_review`, showing `applied_keys: ["lemon"]`.
3. **No re-apply.** Tap Try again. Dragonfruit fails again, and lemon is **unchanged** (still +2). The network panel shows a body with only dragonfruit.
4. **Guard.** Replay the step 2 request by hand from the page (`fetch('/api/ai/workflows/apply', …)` with lemon and the same `turn_request_ids`). The response has `already_applied_names: ["lemon"]`, and the pantry lemon count is unchanged.
5. **Reject.** Tap Dismiss, and the card shows Skipped. Reload, and it is still Skipped. *(screenshot)*
6. **Applied, and cross-device.** Seed a second turn (RID2, add "carrot") the same way and approve it. Open a **second browser context** signed in as the same user, with the same `CONV` in its localStorage and no other client state. It shows "✓ Added to pantry!" read-only for RID2 and Skipped for RID1. *(screenshot)* This proves the state is server side.
7. **Legacy.** Seed an assistant `pantry_update` row **without** `metadata.request_id`. Reload: text bubble only, no card.
8. **Merged chain.** In a fresh conversation, mock two sends in turn (RID3 with lemon, then RID4 with lemon ×3 plus carrot), seeding both rows. Navigate away and back: there is **one** card, with lemon ×3 and carrot. Approve: the request's `turn_request_ids == [RID3, RID4]`. Both rows are `applied`, and lemon appears once in the pantry.
8b. **(R2) Chains that fail partly, and chains ending in a vague-only turn.**
   - **A partial chain.** In a fresh conversation, mock and seed RID5 (add lemon, use dragonfruit) and then RID6 (use dragonfruit ×2, add carrot). Navigate away and back to get one card, then approve. Lemon and carrot land and dragonfruit fails. Navigate away and back again: there is **one** failed card on RID6, with lemon and carrot read-only and dragonfruit ×2 editable (the displayed value equals the sent value). *(screenshot)* Paste both rows' `proposal_review`, showing `chain_request_ids == [RID5, RID6]`. Tap Try again: the request body holds dragonfruit only, sent once.
   - **A vague-only tail.** Mock and seed RID7 (add lemon), then RID8, a `pantry_update` envelope with `proposal: {actions: []}` and `metadata.clarification_suggestions` (for example the term "veggies"), seeded with `metadata.request_id = RID8`. Navigate away and back: there is one card on RID8. Approve: the network panel shows `turn_request_ids == [RID7, RID8]` and a **200, not a 422**, and both rows are `applied`.
9. **Cleanup.** Delete the seeded `conversation_history` rows for the test conversation ids and the lemon and carrot rows the walk created. Put the cleanup SQL or script in the PR body's verify section.

Record the commit SHA, matched against `/api/health` `sha` and `/health` `version.git_sha`.

---

## 9. Reversible decisions (log each, with the alternative rejected, in the sprint doc)

1. **State lives in `conversation_history.metadata.proposal_review`.** *Rejected:* nesting it in `proposal`, which mixes the offer with its outcome and changes the card's type; a new column, which needs a migration for no gain; the session row, where `update_session` rewrites all of `metadata` from a turn-start snapshot and would lose outcomes written mid-turn.
2. **The turn key is the envelope's `request_id`, stamped into metadata.** *Rejected:* the row `id`. The client never learns it for a live turn, because the insert happens server side after or around the envelope. Returning it would mean another SSE event.
3. **Pantry proposal turns are saved before their envelope is yielded.** *Rejected:* keeping the tail save and having apply retry or poll for a missing row, which leaves a timing race that is hard to test.
4. **Apply records the outcome itself** (optional fields on `ApplyRequest`) **and reject gets its own small endpoint.** *Rejected:* a single generic `/v1/chat/proposal-outcome` endpoint called after apply. It is a second round trip that can fail between the pantry write and the record, and it can't guard against a duplicate write. Also rejected: overloading apply with a "rejected" flag, since the proxy awards bubbles on apply.
5. **A server-side guard drops already-applied rows.** *Rejected:* UI-only protection. A stale tab, a second device or a lost response would still double-write.
6. **`ApplyResponse.failed_names` from the repository's failure indices, with the regex kept only as a fallback.** *Rejected:* regex only. `"Error processing {…}"` has no parseable name, which makes the client resend every row. The guard would catch that, but the live and restored cards would disagree.
7. **Card identity is `turnRequestIds[]`, and the merge is replayed for pending turns on restore.** *Rejected:* independent restored cards for pending turns, because a repeated item in two pending cards is a duplicate write (§5).
8. **R2: `failed` turns in a chain restore as one merged card, using the recorded `chain_request_ids`. Applied and rejected turns restore as independent read-only cards.** *Rejected:* independent failed cards, which duplicate a failed row that was repeated across turns (the #127 risk). Also rejected: re-merging terminal cards, which is cosmetic only. Neither of them can write, even though `chain_request_ids` would make it possible.
9. **Applied and rejected show the read-only "Added" or "Skipped" card** (§5). *Rejected:* no card.
10. **Legacy turns get no card** (§6). *Rejected:* armed (the duplicate risk) or disabled with an unknown state (a new UI state for a cohort that disappears).
11. **Reject is fire-and-forget, with no UI revert on failure.** The worst case is the card coming back pending, which carries no write risk. *Rejected:* blocking the dismiss on the network.
12. **No expiry for an unapproved proposal.** This answers #358's open lifetime question. A pending card restores for as long as its turn is inside the restored history window (the most recent 20 turns). *Rejected:* a TTL, which is a product call with no evidence it's needed yet.
13. **Pre-approve inline edits are not persisted.** A restored pending card shows the original quantities. Edits **are** persisted once sent, in the failed rows of a partial attempt. *Rejected:* writing edits on blur, which means a new write path per keystroke session for a navigate-mid-edit case. This is #358's acceptance criterion, "documented as out of scope with a reason". State it in the PR body.
14. **R2: every `pantry_update` turn with a proposal gets `metadata.request_id`, zero-action (vague-only) turns included,** because such a turn can own a merged card and its id must be a valid chain member. *Rejected:* stamping only turns with actions (R1), which let a chain ending in a vague-only turn restore with a null id and 422 on approve. Also rejected: stamping every assistant turn, which is harmless but unused today. Widen it when a feature needs it.
15. **Redo on a new branch, and close PR #607 as superseded.** *Rejected:* force-pushing PR #607's branch, which would bury the held review thread.

---

## 10. Out of scope (file follow-ups only where noted)

- **Concurrent applies of the same chain from two devices in the same instant.** The guard is read-then-write, not a claim. Two in-flight requests can both pass it. The `claim_meal_cook` pattern would close this. File it as a follow-up if the verify walk or review shows it matters. Double-tap on one device is already blocked by the `approving` state.
- **A record write failing after a successful pantry write** (§2c step 5). It is logged, and that turn restores pending for rows that did apply. Pinned in the PR's "not covered" section. The guard can't help, because nothing was recorded.
- Chains that extend beyond the 20-turn restore window: the out-of-window turns aren't restored, so they can't be merged or offered.
- Awarding bubbles for the rows that did apply on a partial failure: issue #541's proxy gap, unchanged.
- Proposals for the recipe and cook paths, and receipt-scan review state.
- Legacy backfill of `request_id` or outcomes.
- Removing the regex fallback in `applyPantryProposal` after this deploys everywhere. File a small follow-up.

---

## 11. Gates

- `cd ai-service && pytest && ruff check bubbly_chef/ && ./scripts/mypy_gate.sh`. No new baseline entries: the new modules must be mypy-strict clean.
- `cd nextjs && npx tsc --noEmit && npx eslint src && npx jest`.
- No migration, no change under `.github/`, `.claude/` or `scripts/`.
- The PR body carries `Fixes #444` only. It does **not** mention #311 as fixed.

## 12. Needs the human

**None.** There is no v1 scope change and nothing that costs money. The proposal-lifetime question (§9.12) and the inline-edit gap (§9.13) are reversible product calls, logged in the sprint doc.
