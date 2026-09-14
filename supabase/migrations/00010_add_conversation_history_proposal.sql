-- Persist per-message proposal + metadata on conversation_history rows
-- so recipe cards (and any other proposals) survive navigate-away + reload.
--
-- Root cause: conversation_history only stored role/content/intent.
-- On reload the restore mapper in useChat could rebuild content + intent but
-- had no proposal to pass to the render branch, so recipe cards vanished.
-- session.pending_proposal (conversation_sessions) only covers the *pending*
-- path (pantry/cook proposals awaiting user confirm); a terminal recipe_card
-- proposal (next_action: none) is never stashed there.
--
-- nullable, no default — user turns and plain-chat assistant turns leave them
-- null. No backfill; old cards stay dead (forward-only fix). RLS is already
-- applied to conversation_history in 00002_rls_policies.sql; adding columns
-- requires no new policy.
--
-- Apply: supabase db push (dev project obmbwuqwpvntxhhbdfsg)

ALTER TABLE conversation_history
  ADD COLUMN proposal JSONB,
  ADD COLUMN metadata JSONB;
