/**
 * Issue #444 — rebuilding the chat thread from persisted history.
 *
 * A pantry proposal must survive navigating away and back, and it must never be
 * offered twice. The AI service records the outcome on the persisted turn
 * (`metadata.request_id` plus `metadata.proposal_review`), so this mapper needs
 * no client storage: a card's state is read from the turn itself and is the same
 * on a second device.
 *
 * Classes of a `pantry_update` turn (contract §5):
 *   legacy   no `request_id`: text bubble, no card (nothing says if it was applied)
 *   pending  `request_id`, no review: a live card, merged the way `onDone` merges
 *   failed   some rows applied, some did not: only the failed rows are live
 *   applied  read-only "Added to pantry!"
 *   rejected read-only "Skipped"
 *
 * A mid-cook amendment card ("Update what I'm cooking", #489/#490) restores from
 * the same record: `applied` and `rejected` turns come back as applied and
 * dismissed (never a live button that would re-apply), anything else as pending,
 * and the page decides whether a pending one is still actionable.
 *
 * Pure: no React, no I/O. Malformed rows degrade to a text bubble and never throw.
 */
import type {
  AmendmentCardState,
  ChatIntent,
  ChatMessage,
  ChatResponse,
  ConversationHistoryTurn,
  PantryProposalAction,
  PantryProposalData,
  PendingProposal,
  ProposalReview,
  TermSuggestion,
} from '@/types/chat'
import {
  filterResolvedTerms,
  getClarificationSuggestions,
  isRecipeAmendmentProposal,
  mergeActions,
  mergeTermSuggestions,
  proposalActionKey,
  readPantryActions,
  readProposalReview,
  isMealOptionsProposal,
  isMealProposal,
  readTurnRequestId,
} from '@/types/chat'

export type RestoredProposalState = 'pending' | 'approved' | 'rejected' | 'failed'

export interface RestoredThread {
  messages: ChatMessage[]
  pendingProposals: Record<string, PendingProposal>
  proposalStates: Record<string, RestoredProposalState>
  proposalErrors: Record<string, string>
  proposalFailedNames: Record<string, string[]>
  /** One entry per restored "Update what I'm cooking" card, keyed by message id (#490). */
  amendmentStates: Record<string, AmendmentCardState>
}

const GENERIC_FAILURE = 'Some items could not be added. Please try again.'

type PantryClass = 'malformed' | 'legacy' | 'zero' | 'pending' | 'failed' | 'applied' | 'rejected'

interface PantryNode {
  index: number
  msgId: string
  turn: ConversationHistoryTurn
  meta: Record<string, unknown>
  requestId: string | null
  /** This turn's own actions as persisted. */
  actions: PantryProposalAction[]
  review: ProposalReview | null
  cls: PantryClass
}

/** What a message will finally show, after merges and overlays. */
interface Working {
  proposal: PantryProposalData | null
  /** Set only when the card's clarification pills changed. */
  clarifications?: TermSuggestion[]
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function classify(index: number, msgId: string, turn: ConversationHistoryTurn): PantryNode {
  const actions = readPantryActions(turn.proposal)
  const meta = isRecord(turn.metadata) ? turn.metadata : null
  if (actions === null || meta === null) {
    return { index, msgId, turn, meta: {}, requestId: null, actions: [], review: null, cls: 'malformed' }
  }
  const requestId = readTurnRequestId(meta)
  const review = readProposalReview(meta)
  let cls: PantryClass
  if (actions.length === 0) cls = 'zero'
  else if (!requestId) cls = 'legacy'
  else if (!review) cls = 'pending'
  else cls = review.status === 'failed' ? 'failed' : review.status
  return { index, msgId, turn, meta, requestId, actions, review, cls }
}

/** Lay a failed attempt's sent quantity and unit over the rows it names, by key. */
function overlayFailed(
  actions: PantryProposalAction[],
  review: ProposalReview | null,
): PantryProposalAction[] {
  if (!review || review.failed.length === 0) return actions
  return actions.map((a) => {
    const f = review.failed.find((row) => row.key === proposalActionKey(a))
    if (!f) return a
    return {
      ...a,
      item: {
        ...a.item,
        quantity: typeof f.quantity === 'number' ? f.quantity : a.item.quantity,
        unit: typeof f.unit === 'string' ? f.unit : a.item.unit,
      },
    }
  })
}

function buildResponse(
  turn: ConversationHistoryTurn,
  conversationId: string,
  proposal: ChatResponse['proposal'],
  clarifications?: TermSuggestion[],
  nextAction: ChatResponse['next_action'] = 'none',
): ChatResponse {
  const metadata = isRecord(turn.metadata)
    ? {
        ...turn.metadata,
        ...(clarifications ? { clarification_suggestions: clarifications } : {}),
        // A restored turn has no live stream behind it, so it can't still be
        // waiting for follow-up chips (#498).
        follow_ups_pending: false,
      }
    : null
  return {
    intent: (turn.intent ?? 'general_chat') as ChatIntent,
    assistant_message: turn.content,
    proposal,
    metadata,
    // The persisted id keeps the bubbles ref_key stable, so re-approving after a
    // restore can't award twice (#444).
    request_id: readTurnRequestId(turn.metadata) ?? '',
    workflow_id: '',
    conversation_id: conversationId,
    // The real confidence is not persisted: report unknown (0), not a
    // fabricated 1.0 that a future confidence indicator would trust.
    confidence: { overall: 0 },
    requires_review: false,
    next_action: nextAction,
  } as ChatResponse
}

function textOnly(turn: ConversationHistoryTurn, id: string): ChatMessage {
  return {
    id,
    role: turn.role as 'user' | 'assistant',
    content: turn.content,
    intent: (turn.intent as ChatMessage['intent']) ?? undefined,
    timestamp: new Date(turn.created_at),
  }
}

function restore(turns: ConversationHistoryTurn[], conversationId: string): RestoredThread {
  const ids = turns.map(() => crypto.randomUUID())
  const pendingProposals: Record<string, PendingProposal> = {}
  const proposalStates: Record<string, RestoredProposalState> = {}
  const proposalErrors: Record<string, string> = {}
  const proposalFailedNames: Record<string, string[]> = {}
  const amendmentStates: Record<string, AmendmentCardState> = {}

  // ── Mid-cook amendment turns (#490) ────────────────────────────────────────
  turns.forEach((turn, i) => {
    if (turn.role !== 'assistant' || !isRecipeAmendmentProposal(turn.proposal)) return
    const review = readProposalReview(isRecord(turn.metadata) ? turn.metadata : null)
    amendmentStates[ids[i]] =
      review?.status === 'applied' ? 'applied' : review?.status === 'rejected' ? 'dismissed' : 'pending'
  })

  // ── Classify every assistant pantry turn ───────────────────────────────────
  const nodes: PantryNode[] = []
  turns.forEach((turn, i) => {
    if (turn.role !== 'assistant' || turn.intent !== 'pantry_update') return
    try {
      nodes.push(classify(i, ids[i], turn))
    } catch {
      // A row that can't even be classified degrades to its text bubble.
    }
  })
  const nodeAt = new Map(nodes.map((n) => [n.index, n]))

  const working = new Map<number, Working>()
  for (const n of nodes) {
    if (n.cls === 'malformed') continue
    working.set(n.index, {
      proposal: n.cls === 'legacy' ? null : (n.turn.proposal as PantryProposalData),
    })
  }

  const clarificationsOf = (n: PantryNode): TermSuggestion[] =>
    getClarificationSuggestions({ metadata: n.meta } as ChatResponse)

  // ── Failed chains restore as ONE card (R2/R3) ──────────────────────────────
  // Group members: the failed turns plus any zero-action turn that recorded the
  // same non-empty chain. The owner is the LAST member; chain turns outside the
  // group (applied or rejected turns with rows) keep their own classification.
  const chainKey = (n: PantryNode) =>
    n.review && n.review.chain_request_ids.length > 0 ? n.review.chain_request_ids.join('|') : null
  const failedKeys = new Set(
    nodes.filter((n) => n.cls === 'failed').map(chainKey).filter((k): k is string => k !== null),
  )
  const groups = new Map<string, PantryNode[]>()
  for (const n of nodes) {
    const key = chainKey(n)
    if (key === null || !failedKeys.has(key)) continue
    if (n.cls !== 'failed' && n.cls !== 'zero') continue
    groups.set(key, [...(groups.get(key) ?? []), n])
  }
  const grouped = new Set<PantryNode>()

  for (const members of groups.values()) {
    const owner = members[members.length - 1]
    const chain = owner.review!.chain_request_ids
    const displayed = members.reduce<PantryProposalAction[]>(
      (acc, m) => mergeActions(acc, overlayFailed(m.actions, m.review)),
      [],
    )
    const applied = new Set<string>()
    for (const n of nodes) {
      if (n.requestId && chain.includes(n.requestId)) n.review?.applied_keys.forEach((k) => applied.add(k))
    }
    const live = displayed.filter((a) => !applied.has(proposalActionKey(a)))
    const clarifications = filterResolvedTerms(
      members.reduce<TermSuggestion[]>((acc, m) => mergeTermSuggestions(acc, clarificationsOf(m)), []),
      displayed,
    )
    for (const m of members) {
      grouped.add(m)
      working.set(m.index, { proposal: null, clarifications: [] })
    }
    working.set(owner.index, {
      proposal: { ...(owner.turn.proposal as PantryProposalData), actions: displayed },
      clarifications,
    })
    if (live.length === 0) {
      proposalStates[owner.msgId] = 'approved'
      continue
    }
    proposalStates[owner.msgId] = 'failed'
    pendingProposals[owner.msgId] = { requestId: owner.requestId!, actions: live, turnRequestIds: chain }
    proposalFailedNames[owner.msgId] = live.map(proposalActionKey)
    proposalErrors[owner.msgId] =
      owner.review!.error ?? members.find((m) => m.review?.error)?.review?.error ?? GENERIC_FAILURE
  }

  // ── Terminal and lone failed turns ─────────────────────────────────────────
  for (const n of nodes) {
    if (grouped.has(n)) continue
    if (n.cls === 'applied') proposalStates[n.msgId] = 'approved'
    else if (n.cls === 'rejected') {
      // Dismissing after a partial failure leaves the rows that applied in the
      // pantry: show those as Added, not as Skipped. Nothing applied: Skipped.
      const done = new Set(n.review!.applied_keys)
      const applied = n.actions.filter((a) => done.has(proposalActionKey(a)))
      if (applied.length > 0) {
        proposalStates[n.msgId] = 'approved'
        working.set(n.index, {
          proposal: { ...(n.turn.proposal as PantryProposalData), actions: applied },
        })
      } else {
        proposalStates[n.msgId] = 'rejected'
      }
    }
    else if (n.cls === 'zero' && n.review) {
      // A vague-only turn inside a handled chain has no rows of its own, but its
      // chain was handled: it takes that state and shows no live clarification
      // pills under the read-only card above it.
      proposalStates[n.msgId] = n.review.status === 'rejected' ? 'rejected' : 'approved'
      working.set(n.index, { proposal: null, clarifications: [] })
    }
    else if (n.cls === 'failed') {
      const displayed = overlayFailed(n.actions, n.review)
      const done = new Set(n.review!.applied_keys)
      const live = displayed.filter((a) => !done.has(proposalActionKey(a)))
      working.set(n.index, {
        proposal: { ...(n.turn.proposal as PantryProposalData), actions: displayed },
      })
      if (live.length === 0) {
        proposalStates[n.msgId] = 'approved'
        continue
      }
      proposalStates[n.msgId] = 'failed'
      pendingProposals[n.msgId] = { requestId: n.requestId!, actions: live, turnRequestIds: [n.requestId!] }
      proposalFailedNames[n.msgId] = live.map(proposalActionKey)
      proposalErrors[n.msgId] = n.review!.error ?? GENERIC_FAILURE
    }
  }

  // ── Replay the live merge for pending turns ────────────────────────────────
  // `onDone` folds any incoming pantry turn into the nearest earlier open card,
  // zero-action turns included, and the card moves to the new turn. Replaying it
  // keeps a repeated item (A: "2 lemons", B: "actually 3") as one row: two
  // independent cards would both offer lemons and approving both writes twice.
  // A zero-action turn joins only with a request_id, so no null enters the chain.
  let openIdx: number | null = null
  for (const n of nodes) {
    if (grouped.has(n)) continue
    const joins = n.cls === 'pending' || (n.cls === 'zero' && !!n.requestId && !n.review)
    if (!joins) continue
    const target = openIdx === null ? undefined : nodeAt.get(openIdx)
    const targetWork = target ? working.get(target.index) : undefined
    const targetPending = target ? pendingProposals[target.msgId] : undefined
    if (target && targetWork?.proposal && targetPending) {
      const merged = mergeActions(targetPending.actions, n.actions)
      const clarifications = filterResolvedTerms(
        mergeTermSuggestions(targetWork.clarifications ?? clarificationsOf(target), clarificationsOf(n)),
        merged,
      )
      working.set(n.index, { proposal: { ...targetWork.proposal, actions: merged }, clarifications })
      working.set(target.index, { proposal: null, clarifications: [] })
      delete pendingProposals[target.msgId]
      delete proposalStates[target.msgId]
      pendingProposals[n.msgId] = {
        requestId: n.requestId!,
        actions: merged,
        turnRequestIds: [...targetPending.turnRequestIds, n.requestId!],
      }
      proposalStates[n.msgId] = 'pending'
      openIdx = n.index
    } else if (n.cls === 'pending') {
      pendingProposals[n.msgId] = { requestId: n.requestId!, actions: n.actions, turnRequestIds: [n.requestId!] }
      proposalStates[n.msgId] = 'pending'
      openIdx = n.index
    }
  }

  // ── Meal options still waiting for a pick (#847) ───────────────────────────
  // Only the newest option set can be picked, and only if no `meal` turn follows
  // it: a pick answers with one, a "different options" ask answers with a newer
  // set. Everything else restores as `none` and the page draws it read-only.
  let pickableOptionsIdx = -1
  turns.forEach((turn, i) => {
    if (turn.role !== 'assistant') return
    if (isMealOptionsProposal(turn.proposal)) pickableOptionsIdx = i
    else if (isMealProposal(turn.proposal)) pickableOptionsIdx = -1
  })

  // ── Assemble the messages ──────────────────────────────────────────────────
  const messages = turns.map((turn, i): ChatMessage => {
    const base = textOnly(turn, ids[i])
    const node = nodeAt.get(i)
    if (node) {
      const w = working.get(i)
      if (!w) return base
      return { ...base, response: buildResponse(turn, conversationId, w.proposal, w.clarifications) }
    }
    // Recipe and brainstorm cards are read-only, so they restore fully.
    if (turn.role === 'assistant' && (turn.proposal || turn.metadata)) {
      return {
        ...base,
        response: buildResponse(
          turn,
          conversationId,
          turn.proposal ?? null,
          undefined,
          i === pickableOptionsIdx ? 'pick_meal' : 'none',
        ),
      }
    }
    return base
  })

  return { messages, pendingProposals, proposalStates, proposalErrors, proposalFailedNames, amendmentStates }
}

/**
 * Rebuild the thread, plus the card state for every restored pantry proposal.
 * Never throws: a failure anywhere degrades to plain text bubbles, because only
 * a failed history fetch or an empty history may clear the stored conversation.
 */
export function buildRestoredThread(
  turns: ConversationHistoryTurn[],
  conversationId: string,
): RestoredThread {
  try {
    return restore(turns, conversationId)
  } catch (err) {
    console.error('[buildRestoredThread] restore failed, showing text only:', err)
    return {
      messages: turns.map((t) => textOnly(t, crypto.randomUUID())),
      pendingProposals: {},
      proposalStates: {},
      proposalErrors: {},
      proposalFailedNames: {},
      amendmentStates: {},
    }
  }
}
