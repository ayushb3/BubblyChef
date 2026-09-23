# Persist chat proposals so recipe cards survive reload (Spec 0 / 0.1, #413 gap)

## Context

Two bugs surfaced testing the spaghetti flow against the Spec 0 manual plan
(`docs/plans/2026-09-13-spec-0-manual-test-plan.md`):

1. **Empty bubble on a fresh recipe turn** — FIXED this session in
   `nextjs/src/hooks/useChat.ts:266`. `onDone` did `proposal.actions.length`
   unconditionally; a `recipe_card` proposal is a `RecipeProposal`
   (`{proposal_type, recipe, ...}`) with **no `actions` field**, so `.length`
   threw a `TypeError`. `streamChatMessage`'s `settle()` marks the stream
   settled *before* invoking `onDone`, so the throw was swallowed and the
   `setMessages` that stamps `intent`/`response` never ran. Guarded with
   `Array.isArray(proposal.actions)`. Regression test added in
   `use-chat-persistence.test.ts` (negative-control confirmed: fails on old
   code, passes on fix).

2. **Recipe card vanishes on navigate-away + back** — THIS PLAN. Exactly Spec 0
   test **0.1** (proposal must survive navigate-away, #413). Root cause: the
   `conversation_history` table (`supabase/migrations/00001_initial_schema.sql:107`)
   stores only `role/content/intent` — **the proposal is never persisted**.
   `SupabaseRepository.save_message` (`ai-service/bubbly_chef/repository/supabase_repo.py:520`)
   only writes those three fields. On reload, `useChat`'s restore mapper
   (`nextjs/src/hooks/useChat.ts:168`) rebuilds each turn with `content` +
   `intent` but **no `response`**, so `message.response?.proposal` is undefined
   and the recipe-card render branch (`nextjs/src/app/chat/page.tsx:749`) can't
   fire. Intent *does* survive, which is why the screenshot shows recipe-case
   chips ("Try another recipe") but no card.

   Why 0.1 didn't catch this earlier: `conversation_sessions.pending_proposal`
   (schema line 127) *does* survive reload, so a **pending pantry / cook**
   proposal restores fine. A `recipe_card` proposal is terminal
   (`next_action: none`, `requires_review: false`) — never stashed as pending —
   so only the recipe card is lost. #413's "proposals survive reload" claim
   only ever covered the pending path.

**Outcome:** a recipe card (and any per-turn proposal + metadata) rendered in a
chat thread is restored intact when the user navigates away and returns.

## Approach — persist proposal + metadata per assistant turn

Store the proposal on the message row it belongs to (per-message, matches how
the card renders), not on the single-slot session state.

### 1. DB migration — `supabase/migrations/00010_add_conversation_history_proposal.sql` (new)

```sql
ALTER TABLE conversation_history
  ADD COLUMN proposal JSONB,
  ADD COLUMN metadata JSONB;
```

Nullable, no default — user turns and plain-chat assistant turns leave them
null. No backfill (old cards stay dead; acceptable — forward-only fix). RLS
already covers the table (`00002_rls_policies.sql`); adding columns needs no
new policy. Apply with `supabase db push` against the dev project
(`obmbwuqwpvntxhhbdfsg`).

### 2. Repository — `ai-service/bubbly_chef/repository/supabase_repo.py`

`save_message` (line 520): add optional params and write them.

```python
async def save_message(
    self, user_id, conversation_id, role, content,
    intent: str | None = None,
    proposal: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    self.client.table("conversation_history").insert({
        "user_id": user_id, "conversation_id": conversation_id,
        "role": role, "content": content, "intent": intent,
        "proposal": proposal, "metadata": metadata,
    }).execute()
```

`get_history` (line 538) already `select("*")` + returns `_as_rows`, so
`proposal`/`metadata` flow through automatically once the columns exist.

### 3. Chat route — `ai-service/bubbly_chef/api/routes/chat.py`

Two assistant-save callsites (streaming line ~125, non-streaming line ~221).
Pass the envelope's proposal + metadata:

```python
await repo.save_message(
    ..., role="assistant", content=save_content, intent=intent_str,
    proposal=envelope_data.get("proposal") if envelope_data else None,
    metadata=envelope_data.get("metadata") if envelope_data else None,
)
```

Leave the two **user**-message saves (lines ~69, ~213) untouched — no proposal
on a user turn.

### 4. Frontend types — `nextjs/src/types/chat.ts`

Extend `ConversationHistoryTurn` (line 161):

```ts
export interface ConversationHistoryTurn {
  role: 'user' | 'assistant'
  content: string
  intent: string | null
  proposal?: PantryProposalData | ChatRecipeData | null
  metadata?: Record<string, unknown> | null
  created_at: string
}
```

### 5. Frontend restore mapper — `nextjs/src/hooks/useChat.ts` (line 168)

Rebuild a minimal `ChatResponse` for assistant turns that carried a proposal so
the render branches (recipe card, pantry card, brainstorm) light up again:

```ts
const restored: ChatMessage[] = turns.map((turn) => {
  const base = {
    id: crypto.randomUUID(),
    role: turn.role as 'user' | 'assistant',
    content: turn.content,
    intent: (turn.intent as ChatMessage['intent']) ?? undefined,
    timestamp: new Date(turn.created_at),
  }
  if (turn.role === 'assistant' && (turn.proposal || turn.metadata)) {
    return {
      ...base,
      response: {
        // minimal ChatResponse — only the fields the render/chip paths read
        intent: (turn.intent ?? 'general_chat') as ChatIntent,
        assistant_message: turn.content,
        proposal: turn.proposal ?? null,
        metadata: turn.metadata ?? null,
        // fill the required-but-unused fields with safe defaults
        request_id: '', workflow_id: '', conversation_id: convId,
        confidence: { overall: 1 }, requires_review: false,
        next_action: 'none',
      } as ChatResponse,
    }
  }
  return base
})
```

Confirm the exact required-field set against `ChatResponse` when implementing;
cast is acceptable since restored turns are display-only (no re-submit).

**Restored pantry proposals are display-only** — a restored pending pantry card
won't have an entry in `pendingProposalsRef`, so its Approve button would no-op.
That is the pre-existing behaviour today (proposal wasn't restored at all) and
is **out of scope** here — this plan restores the *recipe card* render. Note it;
don't try to rewire approve/reject persistence in this pass.

### 6. Correct the Spec 0 test-plan mis-scope — `docs/plans/2026-09-13-spec-0-manual-test-plan.md`

Test **0.2** ("Cook amendment is a real proposal") tests a `CookingAmendmentCard`
+ "Update what I'm cooking" button. That surface is **Spec A PR #360**
(#303/#279, "amendment UI") which is **not merged**. On current main the
amendment correctly falls to `cooking_help` **prose** — there is no amendment
card in the chat router (confirmed: `CookProposal` exists as a model and in the
`/v1/recipes/cook` endpoint, but no router node emits it into chat, and no
frontend `CookingAmendmentCard` component exists). This was a scoping error in
the Spec 0 plan.

Fix (doc-only): remove/neutralise 0.2 from the Spec 0 plan and note the
amendment-card test already lives in the Spec A plan as **A-2 (#360)**
(`docs/plans/2026-09-13-spec-a-cook-flow-manual-test-plan.md`). Replace 0.2 with
a note that mid-cook amendments on main are expected to return `cooking_help`
prose (the `CookProposal` deserialization that #413 *did* land is exercised by
the `/v1/recipes/cook` endpoint tests, not the chat thread).

Also add a one-line caveat to Phase 0's intro: the merged foundation (#413/#414/
#415) is backend typing — its *reload-survival* guarantee only covered the
`conversation_sessions.pending_proposal` path, not per-message recipe cards; 0.1
(this fix) closes that.

## Out of scope

- Backfilling proposals for messages saved before the migration.
- Restoring the *interactive* (approve/reject) state of a pending pantry/cook
  proposal across reload — only its render is restored, not its live callbacks.
- Folding this into #416. This is a **#413 foundation gap**; it should ride its
  own fix/PR (touches a migration + both tiers) rather than the #416 branch.
  Decision on branch/PR target left to the human (see Verification).

## Verification

Backend (primary checkout has the env; migration must be applied first):

```bash
cd ai-service && ./scripts/mypy_gate.sh          # 0 new
cd ai-service && pytest tests/ -k "history or save_message or chat"
```

Add a repo/route test: save an assistant message with a `recipe_card` proposal,
`get_history`, assert the proposal round-trips.

Frontend:

```bash
cd nextjs && npx tsc --noEmit && npx jest use-chat-persistence
```

Extend `use-chat-persistence.test.ts`: seed `fetchChatHistory` with an
assistant turn carrying a `recipe_card` proposal, mount `useChat`, assert the
restored message has `response.proposal` populated and `intent === 'recipe_card'`.

End-to-end (the actual 0.1 gate):

1. Apply migration to dev Supabase (`supabase db push`).
2. Restart backend + frontend, sign in `test@bubbly.local`.
3. Ask "recipe for spaghetti creamy and garlicky" → recipe card renders.
4. Navigate to `/pantry`, back to `/chat`, reopen the conversation from history.
5. **Expect:** the recipe card is still there (not just the bubble + chips).
6. Re-run Spec 0 Phase 1 for #416 once 0.1 passes.
```
