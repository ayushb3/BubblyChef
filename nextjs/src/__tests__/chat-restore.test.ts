/**
 * Issue #444 — the restore mapper (`buildRestoredThread`), contract §5 and
 * tests F1-F8, F4b, F4c, F6b, F17 and F18 (pure half) of
 * docs/plans/2026-09-30-issue-444-proposal-state-contract.md.
 *
 * The handled state lives server side on each persisted turn
 * (`metadata.request_id` + `metadata.proposal_review`); nothing here touches
 * client storage.
 */
import { buildRestoredThread } from '@/lib/chat-restore'
import {
  readPantryActions,
  type ConversationHistoryTurn,
  type PantryProposalAction,
  type PantryProposalData,
  type ProposalReview,
} from '@/types/chat'

const CONV = 'conv-restore'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const Z = '44444444-4444-4444-8444-444444444444'

function action(
  name: string,
  quantity: number,
  unit = 'whole',
  action_type: PantryProposalAction['action_type'] = 'add',
): PantryProposalAction {
  return { action_type, item: { name, quantity, unit }, confidence: 0.9 }
}

function review(over: Partial<ProposalReview>): ProposalReview {
  return {
    status: 'applied',
    applied_keys: [],
    failed: [],
    error: null,
    chain_request_ids: [],
    updated_at: '2026-09-30T12:00:00+00:00',
    ...over,
  }
}

function pantryTurn(opts: {
  content?: string
  actions: PantryProposalAction[]
  requestId?: string | null
  review?: unknown
  extraMetadata?: Record<string, unknown>
}): ConversationHistoryTurn {
  const metadata: Record<string, unknown> = { ...(opts.extraMetadata ?? {}) }
  if (opts.requestId) metadata.request_id = opts.requestId
  if (opts.review !== undefined) metadata.proposal_review = opts.review
  return {
    role: 'assistant',
    content: opts.content ?? 'Got it!',
    intent: 'pantry_update',
    proposal: { actions: opts.actions },
    metadata,
    created_at: '2026-09-30T12:00:00+00:00',
  }
}

function user(content = 'I bought stuff'): ConversationHistoryTurn {
  return { role: 'user', content, intent: null, created_at: '2026-09-30T12:00:00+00:00' }
}

const actionsOf = (msg: { response?: { proposal: unknown } }) =>
  (msg.response?.proposal as PantryProposalData | null | undefined)?.actions

describe('readPantryActions (tolerant, R2)', () => {
  it('returns the actions for a well-formed proposal, [] for an empty list', () => {
    expect(readPantryActions({ actions: [action('lemon', 2)] })).toEqual([action('lemon', 2)])
    expect(readPantryActions({ actions: [] })).toEqual([])
  })

  it.each([
    ['null', null],
    ['a string', 'garbage'],
    ['actions not an array', { actions: 'oops' }],
    ['an entry with a null item', { actions: [{ action_type: 'add', item: null }] }],
    ['an entry with an empty name', { actions: [{ action_type: 'add', item: { name: '' } }] }],
    ['an entry with no action_type', { actions: [{ item: { name: 'lemon' } }] }],
  ])('returns null for %s', (_label, proposal) => {
    expect(readPantryActions(proposal)).toBeNull()
  })
})

describe('buildRestoredThread — classes (§5)', () => {
  it('F1 pending: restores the card armed, seeded with the persisted request id', () => {
    const t = buildRestoredThread(
      [user(), pantryTurn({ actions: [action('lemon', 2)], requestId: A })],
      CONV,
    )
    const msg = t.messages[1]
    expect(actionsOf(msg)).toEqual([action('lemon', 2)])
    expect(msg.response?.request_id).toBe(A)
    expect(t.proposalStates[msg.id]).toBe('pending')
    expect(t.pendingProposals[msg.id]).toEqual({
      requestId: A,
      actions: [action('lemon', 2)],
      turnRequestIds: [A],
    })
  })

  it('F2 applied: read-only approved card, kept proposal, no pending entry', () => {
    const t = buildRestoredThread(
      [
        user(),
        pantryTurn({
          actions: [action('lemon', 2)],
          requestId: A,
          review: review({ status: 'applied', applied_keys: ['lemon'], chain_request_ids: [A] }),
        }),
      ],
      CONV,
    )
    const msg = t.messages[1]
    expect(actionsOf(msg)).toEqual([action('lemon', 2)])
    expect(t.proposalStates[msg.id]).toBe('approved')
    expect(t.pendingProposals).toEqual({})
  })

  it('F3 rejected: read-only skipped card, no pending entry', () => {
    const t = buildRestoredThread(
      [
        user(),
        pantryTurn({
          actions: [action('lemon', 2)],
          requestId: A,
          review: review({ status: 'rejected', chain_request_ids: [A] }),
        }),
      ],
      CONV,
    )
    const msg = t.messages[1]
    expect(actionsOf(msg)).toEqual([action('lemon', 2)])
    expect(t.proposalStates[msg.id]).toBe('rejected')
    expect(t.pendingProposals).toEqual({})
  })

  it('F4 partial: failed state, only the failed row live, overlay on display and pending', () => {
    const t = buildRestoredThread(
      [
        user(),
        pantryTurn({
          actions: [action('lemon', 1), action('Spinach', 1, 'cup')],
          requestId: A,
          review: review({
            status: 'failed',
            applied_keys: ['lemon'],
            failed: [{ key: 'spinach', name: 'Spinach', quantity: 3, unit: 'cup' }],
            error: "Units don't match (cup vs bag), edit the unit for: spinach",
          }),
        }),
      ],
      CONV,
    )
    const msg = t.messages[1]
    expect(t.proposalStates[msg.id]).toBe('failed')
    expect(t.proposalFailedNames[msg.id]).toEqual(['spinach'])
    expect(t.proposalErrors[msg.id]).toBe("Units don't match (cup vs bag), edit the unit for: spinach")
    expect(t.pendingProposals[msg.id]).toEqual({
      requestId: A,
      actions: [action('Spinach', 3, 'cup')],
      turnRequestIds: [A],
    })
    // The card displays exactly what Try again will send; lemon is untouched.
    expect(actionsOf(msg)).toEqual([action('lemon', 1), action('Spinach', 3, 'cup')])
  })

  it('F4 partial: a null error falls back to the generic retry line', () => {
    const t = buildRestoredThread(
      [
        pantryTurn({
          actions: [action('lemon', 1), action('spinach', 1)],
          requestId: A,
          review: review({
            status: 'failed',
            applied_keys: ['lemon'],
            failed: [{ key: 'spinach', name: 'spinach', quantity: 1, unit: 'whole' }],
          }),
        }),
      ],
      CONV,
    )
    expect(t.proposalErrors[t.messages[0].id]).toBe('Some items could not be added. Please try again.')
  })

  it('F5 legacy: no request_id restores as a text bubble with no card and no state', () => {
    const t = buildRestoredThread(
      [user(), pantryTurn({ actions: [action('lemon', 2)], requestId: null })],
      CONV,
    )
    const msg = t.messages[1]
    expect(msg.response?.proposal ?? null).toBeNull()
    expect(msg.content).toBe('Got it!')
    expect(t.proposalStates).toEqual({})
    expect(t.pendingProposals).toEqual({})
  })

  it('F8 a malformed proposal_review is read as absent: pending when request_id is present', () => {
    const t = buildRestoredThread(
      [pantryTurn({ actions: [action('lemon', 2)], requestId: A, review: { status: 7 } })],
      CONV,
    )
    const id = t.messages[0].id
    expect(t.proposalStates[id]).toBe('pending')
    expect(t.pendingProposals[id].turnRequestIds).toEqual([A])
  })
})

describe('buildRestoredThread — the merge replay for pending turns (§5)', () => {
  it('F6 pending chain: one card on the last turn with lemon x3 and carrot', () => {
    const t = buildRestoredThread(
      [
        user('2 lemons'),
        pantryTurn({ actions: [action('lemon', 2)], requestId: A }),
        user('carrot and 3 lemons'),
        pantryTurn({ actions: [action('carrot', 1), action('lemon', 3)], requestId: B }),
      ],
      CONV,
    )
    const [, first, , second] = t.messages
    expect(first.response?.proposal ?? null).toBeNull()
    expect(actionsOf(second)).toEqual([action('lemon', 3), action('carrot', 1)])
    expect(t.pendingProposals[first.id]).toBeUndefined()
    expect(t.pendingProposals[second.id]).toEqual({
      requestId: B,
      actions: [action('lemon', 3), action('carrot', 1)],
      turnRequestIds: [A, B],
    })
    expect(t.proposalStates[first.id]).toBeUndefined()
    expect(t.proposalStates[second.id]).toBe('pending')
  })

  it('F6b openId moves with the card: A, zero-action Z (no suggestions), C is ONE card on C', () => {
    const turns = [
      pantryTurn({ actions: [action('lemon', 2)], requestId: A }),
      pantryTurn({ actions: [], requestId: Z }),
      pantryTurn({ actions: [action('lemon', 3)], requestId: C }),
    ]
    const t = buildRestoredThread(turns, CONV)
    const [a, z, c] = t.messages
    expect(a.response?.proposal ?? null).toBeNull()
    expect(z.response?.proposal ?? null).toBeNull()
    expect(actionsOf(c)).toEqual([action('lemon', 3)])
    expect(t.pendingProposals[c.id].turnRequestIds).toEqual([A, Z, C])
    expect(Object.keys(t.pendingProposals)).toEqual([c.id])
    expect(t.proposalStates).toEqual({ [c.id]: 'pending' })
  })

  it('F6b variant: a zero-action turn without a request_id never joins (no null in the chain)', () => {
    const t = buildRestoredThread(
      [
        pantryTurn({ actions: [action('lemon', 2)], requestId: A }),
        pantryTurn({ actions: [], requestId: null }),
        pantryTurn({ actions: [action('lemon', 3)], requestId: C }),
      ],
      CONV,
    )
    const c = t.messages[2]
    expect(t.pendingProposals[c.id].turnRequestIds).toEqual([A, C])
    expect(Object.keys(t.pendingProposals)).toEqual([c.id])
  })

  it('F7 a pending turn after an applied turn does not merge into it', () => {
    const t = buildRestoredThread(
      [
        pantryTurn({
          actions: [action('lemon', 2)],
          requestId: A,
          review: review({ status: 'applied', applied_keys: ['lemon'], chain_request_ids: [A] }),
        }),
        pantryTurn({ actions: [action('lemon', 3)], requestId: B }),
      ],
      CONV,
    )
    const [a, b] = t.messages
    expect(actionsOf(a)).toEqual([action('lemon', 2)])
    expect(t.proposalStates[a.id]).toBe('approved')
    expect(actionsOf(b)).toEqual([action('lemon', 3)])
    expect(t.pendingProposals[b.id].turnRequestIds).toEqual([B])
  })

  it('F17 a vague-only tail: A then zero-action B (with suggestions) is one card on B, valid ids', () => {
    const t = buildRestoredThread(
      [
        pantryTurn({ actions: [action('lemon', 2)], requestId: A }),
        pantryTurn({
          actions: [],
          requestId: B,
          extraMetadata: { clarification_suggestions: [{ term: 'veggies', suggestions: ['carrot'] }] },
        }),
      ],
      CONV,
    )
    const [a, b] = t.messages
    expect(a.response?.proposal ?? null).toBeNull()
    expect(actionsOf(b)).toEqual([action('lemon', 2)])
    expect(t.pendingProposals[b.id]).toEqual({
      requestId: B,
      actions: [action('lemon', 2)],
      turnRequestIds: [A, B],
    })
    expect(b.response?.metadata?.clarification_suggestions).toEqual([
      { term: 'veggies', suggestions: ['carrot'] },
    ])
  })
})

describe('buildRestoredThread — failed chains (R2/R3)', () => {
  const failedSpinach4 = { key: 'spinach', name: 'spinach', quantity: 4, unit: 'whole' }

  it('F4b a merged chain that partly failed restores as ONE card on the last turn', () => {
    const t = buildRestoredThread(
      [
        pantryTurn({
          actions: [action('lemon', 1), action('spinach', 2)],
          requestId: A,
          review: review({
            status: 'failed',
            applied_keys: ['lemon'],
            failed: [failedSpinach4],
            chain_request_ids: [A, B],
            error: 'Item not found: spinach',
          }),
        }),
        pantryTurn({
          actions: [action('spinach', 2), action('carrot', 1)],
          requestId: B,
          review: review({
            status: 'failed',
            applied_keys: ['carrot'],
            failed: [failedSpinach4],
            chain_request_ids: [A, B],
            error: 'Item not found: spinach',
          }),
        }),
      ],
      CONV,
    )
    const [a, b] = t.messages
    expect(a.response?.proposal ?? null).toBeNull()
    expect(actionsOf(b)).toEqual([action('lemon', 1), action('spinach', 4), action('carrot', 1)])
    expect(t.pendingProposals[a.id]).toBeUndefined()
    expect(t.pendingProposals[b.id]).toEqual({
      requestId: B,
      actions: [action('spinach', 4)],
      turnRequestIds: [A, B],
    })
    expect(t.proposalStates[b.id]).toBe('failed')
    expect(t.proposalStates[a.id]).toBeUndefined()
    expect(t.proposalFailedNames[b.id]).toEqual(['spinach'])
    expect(t.proposalErrors[b.id]).toBe('Item not found: spinach')
  })

  it('F4c a mixed chain: the failed turn owns the card; the applied turn keeps its own read-only card', () => {
    const t = buildRestoredThread(
      [
        pantryTurn({
          actions: [action('lemon', 1), action('spinach', 2)],
          requestId: A,
          review: review({
            status: 'failed',
            applied_keys: ['lemon'],
            failed: [{ key: 'spinach', name: 'spinach', quantity: 2, unit: 'whole' }],
            chain_request_ids: [A, B],
          }),
        }),
        pantryTurn({
          actions: [action('carrot', 1)],
          requestId: B,
          review: review({ status: 'applied', applied_keys: ['carrot'], chain_request_ids: [A, B] }),
        }),
      ],
      CONV,
    )
    const [a, b] = t.messages
    expect(t.proposalStates[a.id]).toBe('failed')
    expect(t.pendingProposals[a.id]).toEqual({
      requestId: A,
      actions: [action('spinach', 2)],
      turnRequestIds: [A, B],
    })
    expect(actionsOf(a)).toEqual([action('lemon', 1), action('spinach', 2)])
    expect(t.proposalFailedNames[a.id]).toEqual(['spinach'])
    expect(t.proposalStates[b.id]).toBe('approved')
    expect(actionsOf(b)).toEqual([action('carrot', 1)])
    expect(t.pendingProposals[b.id]).toBeUndefined()
  })

  it('a zero-action chain tail joins the failed group and owns it, still seeded failed', () => {
    const t = buildRestoredThread(
      [
        pantryTurn({
          actions: [action('lemon', 1), action('spinach', 2)],
          requestId: A,
          review: review({
            status: 'failed',
            applied_keys: ['lemon'],
            failed: [{ key: 'spinach', name: 'spinach', quantity: 2, unit: 'whole' }],
            chain_request_ids: [A, Z],
          }),
        }),
        pantryTurn({
          actions: [],
          requestId: Z,
          review: review({ status: 'applied', chain_request_ids: [A, Z] }),
        }),
      ],
      CONV,
    )
    const [a, z] = t.messages
    expect(a.response?.proposal ?? null).toBeNull()
    expect(actionsOf(z)).toEqual([action('lemon', 1), action('spinach', 2)])
    expect(t.proposalStates[z.id]).toBe('failed')
    expect(t.pendingProposals[z.id]).toEqual({
      requestId: Z,
      actions: [action('spinach', 2)],
      turnRequestIds: [A, Z],
    })
  })
})

describe('buildRestoredThread — a handled chain ending in a vague-only turn', () => {
  const pills = { clarification_suggestions: [{ term: 'veggies', suggestions: ['carrot'] }] }

  it.each([['applied'], ['rejected']] as const)(
    'chain [A, Z] %s: Z shows no live clarification pills and takes the handled state',
    (status) => {
      const chain = [A, Z]
      const t = buildRestoredThread(
        [
          pantryTurn({
            actions: [action('lemon', 2)],
            requestId: A,
            review: review({
              status,
              applied_keys: status === 'applied' ? ['lemon'] : [],
              chain_request_ids: chain,
            }),
          }),
          pantryTurn({
            actions: [],
            requestId: Z,
            extraMetadata: pills,
            review: review({ status, chain_request_ids: chain }),
          }),
        ],
        CONV,
      )
      const [a, z] = t.messages
      const state = status === 'applied' ? 'approved' : 'rejected'
      expect(t.proposalStates[a.id]).toBe(state)
      expect(t.proposalStates[z.id]).toBe(state)
      expect(z.response?.proposal ?? null).toBeNull()
      expect(z.response?.metadata?.clarification_suggestions ?? []).toEqual([])
      expect(t.pendingProposals).toEqual({})
    },
  )
})

describe('buildRestoredThread — malformed data never throws (R2)', () => {
  const badTurns = (): ConversationHistoryTurn[] => [
    user(),
    {
      role: 'assistant',
      content: 'oops one',
      intent: 'pantry_update',
      proposal: { actions: 'oops' } as unknown as PantryProposalData,
      metadata: null,
      created_at: '2026-09-30T12:00:00+00:00',
    },
    {
      role: 'assistant',
      content: 'oops two',
      intent: 'pantry_update',
      proposal: { actions: [{ item: null }] } as unknown as PantryProposalData,
      metadata: { request_id: B },
      created_at: '2026-09-30T12:00:00+00:00',
    },
    pantryTurn({ content: 'good', actions: [action('lemon', 2)], requestId: A }),
  ]

  it('F18 (pure): bad turns come back as text-only legacy, the good turn is live', () => {
    const t = buildRestoredThread(badTurns(), CONV)
    expect(t.messages).toHaveLength(4)
    const [, bad1, bad2, good] = t.messages
    expect(bad1.content).toBe('oops one')
    expect(bad1.response?.proposal ?? null).toBeNull()
    expect(bad2.content).toBe('oops two')
    expect(bad2.response?.proposal ?? null).toBeNull()
    expect(t.proposalStates).toEqual({ [good.id]: 'pending' })
    expect(Object.keys(t.pendingProposals)).toEqual([good.id])
  })
})
