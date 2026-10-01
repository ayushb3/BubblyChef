/**
 * Issue #490 — a restored "Update what I'm cooking" card shows the state the AI
 * service recorded on its persisted turn (`metadata.proposal_review`, #444's
 * record), never a live button that would re-apply an amendment that already
 * went through.
 */
import { buildRestoredThread } from '@/lib/chat-restore'
import type { ConversationHistoryTurn, RecipeAmendmentProposal } from '@/types/chat'

const CONV = 'conv-amend'
const RID = '11111111-1111-4111-8111-111111111111'

const PROPOSAL: RecipeAmendmentProposal = {
  proposal_type: 'recipe_amendment',
  is_amendment: true,
  amended_ingredients: [
    { name: 'butter', quantity: 30, unit: 'g', optional: false, notes: null },
    { name: 'flour', quantity: 30, unit: 'g', optional: false, notes: null },
  ],
  change_summary: 'Swapped the cream for a roux.',
  recipe_id: 'r1',
  recipe_title: 'Creamy pasta',
}

function amendTurn(metadata: Record<string, unknown> | null): ConversationHistoryTurn {
  return {
    role: 'assistant',
    content: 'A roux works.',
    intent: 'cooking_help',
    proposal: PROPOSAL,
    metadata,
    created_at: '2026-09-30T12:00:00+00:00',
  }
}

const review = (status: 'applied' | 'rejected') => ({
  status,
  applied_keys: [],
  failed: [],
  error: null,
  chain_request_ids: [RID],
  updated_at: '2026-09-30T12:01:00+00:00',
})

describe('restoring an amendment card (#490)', () => {
  it('an applied amendment restores as applied, with its proposal intact', () => {
    const t = buildRestoredThread(
      [amendTurn({ request_id: RID, proposal_review: review('applied') })],
      CONV,
    )
    const id = t.messages[0].id
    expect(t.amendmentStates[id]).toBe('applied')
    expect(t.messages[0].response?.proposal).toEqual(PROPOSAL)
    expect(t.messages[0].response?.request_id).toBe(RID)
  })

  it('a dismissed amendment restores as dismissed (Keep original)', () => {
    const t = buildRestoredThread(
      [amendTurn({ request_id: RID, proposal_review: review('rejected') })],
      CONV,
    )
    expect(t.amendmentStates[t.messages[0].id]).toBe('dismissed')
  })

  it('an amendment nobody handled restores as pending (the page decides whether it is still actionable)', () => {
    const t = buildRestoredThread([amendTurn({ request_id: RID })], CONV)
    expect(t.amendmentStates[t.messages[0].id]).toBe('pending')
  })

  it('a turn saved before amendments were stamped (no request id) still restores, as pending', () => {
    const t = buildRestoredThread([amendTurn({})], CONV)
    expect(t.amendmentStates[t.messages[0].id]).toBe('pending')
    expect(t.messages[0].response?.request_id).toBe('')
  })

  it('a malformed review degrades to pending rather than throwing', () => {
    const t = buildRestoredThread([amendTurn({ request_id: RID, proposal_review: 'nope' })], CONV)
    expect(t.amendmentStates[t.messages[0].id]).toBe('pending')
  })

  it('leaves the pantry proposal state maps untouched', () => {
    const t = buildRestoredThread(
      [amendTurn({ request_id: RID, proposal_review: review('applied') })],
      CONV,
    )
    expect(t.proposalStates).toEqual({})
    expect(t.pendingProposals).toEqual({})
  })
})
