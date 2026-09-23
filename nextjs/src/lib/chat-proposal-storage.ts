/**
 * Issue #444 — tracks which restored pantry proposals have already been
 * confirmed or dismissed.
 *
 * Server-side, `conversation_history` rows persist `proposal`/`metadata`
 * per turn (migration `00010_add_conversation_history_proposal.sql`), but
 * approving a proposal (`POST /v1/workflows/apply`) never updates that row —
 * it only writes the pantry items and an ingestion log. So a turn's
 * persisted `proposal` stays exactly as first generated forever, and on its
 * own can't tell "still pending" apart from "already approved/rejected".
 *
 * That terminal state has nowhere to live server-side without a migration
 * (out of scope for this fix — see CLAUDE.md protected paths), so it's
 * tracked client-side, keyed by conversation id, per the issue's own
 * fallback guidance. The card content itself (the actual proposal data)
 * still comes from the server — this module only remembers "handled or
 * not" for a given turn.
 *
 * Turns aren't identified by an id round-tripped from the server (the
 * `proposal` JSONB has no `request_id`), so a stable content-derived
 * signature stands in: the assistant's reply text plus the proposed
 * actions. Content doesn't change when the user edits quantities/units
 * inline (`updateProposalActions` only touches `pendingProposals`), so the
 * signature computed at approve/reject time matches the one computed from
 * the original turn at restore time.
 */
import type { PantryProposalAction } from '@/types/chat'

const STORAGE_PREFIX = 'bubblychef:chat:handledProposals:'
// Rolling cap — a handful of stale entries from ancient conversations aren't
// worth pruning precisely; this just stops unbounded growth.
const MAX_ENTRIES_PER_CONVERSATION = 100

function proposalSignature(content: string, actions: PantryProposalAction[]): string {
  const actionsKey = actions
    .map((a) => `${a.action_type}:${a.item.name}:${a.item.quantity ?? ''}:${a.item.unit ?? ''}`)
    .sort()
    .join('|')
  return `${content.trim()}::${actionsKey}`
}

function readHandled(conversationId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + conversationId)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    // Storage unavailable or corrupt — behave as if nothing is handled yet.
    return []
  }
}

/** True once `markProposalHandled` has been called for this exact proposal. */
export function isProposalHandled(
  conversationId: string | null | undefined,
  content: string,
  actions: PantryProposalAction[],
): boolean {
  if (!conversationId) return false
  return readHandled(conversationId).includes(proposalSignature(content, actions))
}

/** Record that a proposal was approved or rejected — it must not restore as pending again. */
export function markProposalHandled(
  conversationId: string | null | undefined,
  content: string,
  actions: PantryProposalAction[],
): void {
  if (!conversationId || typeof window === 'undefined') return
  const sig = proposalSignature(content, actions)
  try {
    const existing = readHandled(conversationId)
    if (existing.includes(sig)) return
    const next = [...existing, sig].slice(-MAX_ENTRIES_PER_CONVERSATION)
    window.localStorage.setItem(STORAGE_PREFIX + conversationId, JSON.stringify(next))
  } catch {
    // Best effort — worst case the card can be approved/dismissed twice.
  }
}
