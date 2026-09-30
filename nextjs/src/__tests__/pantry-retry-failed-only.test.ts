/**
 * Issue #677 §2 — after a partial apply failure, "Try again" must resend ONLY
 * the failed rows.
 *
 * On main, `approveProposal` narrowed the pending set to the failed actions,
 * but the card still rendered every row and `handleQtyChange` sent the WHOLE
 * list, and `updateProposalActions` replaced the pending set with it. So editing
 * the failed row resurrected the rows that had already applied, and the retry
 * applied them twice (a `use` of eggs subtracted twice).
 *
 * Hook-level: the behaviour lives entirely in useChat state.
 */
import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import type { ChatResponse, PantryProposalAction } from '@/types/chat'

const queryClient = new QueryClient()
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children)
}

const streamChatMessage = jest.fn()
const applyPantryProposal = jest.fn()

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: (...args: unknown[]) => streamChatMessage(...args),
  fetchChatHistory: jest.fn().mockResolvedValue([]),
  applyPantryProposal: (...args: unknown[]) => applyPantryProposal(...args),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true })

const EGGS: PantryProposalAction = {
  action_type: 'use',
  item: { name: 'eggs', quantity: 2, unit: 'item' },
  confidence: 0.9,
}
// Capitalised on purpose: the failed-name key is trim().toLowerCase().
const SPINACH: PantryProposalAction = {
  action_type: 'use',
  item: { name: 'Spinach', quantity: 1, unit: 'handful' },
  confidence: 0.9,
}

const RESPONSE: ChatResponse = {
  request_id: 'req-1',
  workflow_id: 'wf-1',
  conversation_id: 'conv-1',
  intent: 'pantry_update',
  assistant_message: 'Please review before updating your pantry.',
  proposal: { actions: [EGGS, SPINACH] },
  confidence: { overall: 0.9 },
  requires_review: true,
  next_action: 'review_proposal',
}

beforeEach(() => {
  streamChatMessage.mockReset()
  applyPantryProposal.mockReset()
})

/** Mount the hook with one pending two-row card; returns its message id. */
function setup() {
  const hook = renderHook(() => useChat(), { wrapper })
  act(() => {
    hook.result.current.sendMessage('I used 2 eggs and a handful of spinach')
  })
  const [, , onDone] = streamChatMessage.mock.calls[streamChatMessage.mock.calls.length - 1]
  act(() => {
    onDone(RESPONSE)
  })
  return { hook, msgId: hook.result.current.messages[1].id }
}

const SPINACH_30G: PantryProposalAction = {
  ...SPINACH,
  item: { ...SPINACH.item, quantity: 30, unit: 'g' },
}

describe('a partial failure retries only the failed rows', () => {
  it('editing the failed row does not resurrect the rows that already applied', async () => {
    const { hook, msgId } = setup()

    applyPantryProposal.mockResolvedValueOnce({
      success: false,
      appliedCount: 1,
      failedCount: 1,
      errors: ["Units don't match (handful vs g), edit the unit for: Spinach"],
      failedActions: [SPINACH],
    })
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    expect(hook.result.current.proposalStates[msgId]).toBe('failed')
    expect(hook.result.current.proposalFailedNames[msgId]).toEqual(['spinach'])

    // The card sends the FULL list (it still renders every row) on an edit.
    act(() => {
      hook.result.current.updateProposalActions(msgId, [EGGS, SPINACH_30G])
    })

    applyPantryProposal.mockResolvedValueOnce({
      success: true,
      appliedCount: 1,
      failedCount: 0,
      errors: [],
    })
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })

    expect(applyPantryProposal).toHaveBeenCalledTimes(2)
    const [, retryActions] = applyPantryProposal.mock.calls[1] as [string, PantryProposalAction[]]
    expect(retryActions).toHaveLength(1)
    expect(retryActions[0].item).toMatchObject({ name: 'Spinach', quantity: 30, unit: 'g' })

    expect(hook.result.current.proposalStates[msgId]).toBe('approved')
    expect(hook.result.current.proposalFailedNames[msgId]).toBeUndefined()
  })

  it('a thrown apply keeps every row retryable and resends both', async () => {
    const { hook, msgId } = setup()

    applyPantryProposal.mockRejectedValueOnce(new Error('Failed to fetch'))
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    expect(hook.result.current.proposalStates[msgId]).toBe('failed')
    expect(hook.result.current.proposalFailedNames[msgId]).toEqual(['eggs', 'spinach'])

    act(() => {
      hook.result.current.updateProposalActions(msgId, [EGGS, SPINACH])
    })

    applyPantryProposal.mockResolvedValueOnce({
      success: true,
      appliedCount: 2,
      failedCount: 0,
      errors: [],
    })
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    const [, retryActions] = applyPantryProposal.mock.calls[1] as [string, PantryProposalAction[]]
    expect(retryActions.map((a) => a.item.name)).toEqual(['eggs', 'Spinach'])
  })

  it('a failure with no narrowed failedActions marks every pending row failed', async () => {
    const { hook, msgId } = setup()

    applyPantryProposal.mockResolvedValueOnce({
      success: false,
      appliedCount: 0,
      failedCount: 2,
      errors: ['boom'],
    })
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    expect(hook.result.current.proposalFailedNames[msgId]).toEqual(['eggs', 'spinach'])
  })

  it('dismissing after a partial failure shows Added with only the applied rows (matches a reload, #444)', async () => {
    const { hook, msgId } = setup()

    applyPantryProposal.mockResolvedValueOnce({
      success: false,
      appliedCount: 1,
      failedCount: 1,
      errors: ["Units don't match (handful vs g), edit the unit for: Spinach"],
      failedActions: [SPINACH],
    })
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    act(() => {
      hook.result.current.rejectProposal(msgId)
    })

    expect(hook.result.current.proposalStates[msgId]).toBe('approved')
    const shown = hook.result.current.messages[1].response?.proposal as { actions: PantryProposalAction[] }
    expect(shown.actions).toEqual([EGGS])
  })

  it('dismissing when nothing applied stays Skipped and keeps every row', async () => {
    const { hook, msgId } = setup()

    applyPantryProposal.mockRejectedValueOnce(new Error('Failed to fetch'))
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    act(() => {
      hook.result.current.rejectProposal(msgId)
    })

    expect(hook.result.current.proposalStates[msgId]).toBe('rejected')
    const shown = hook.result.current.messages[1].response?.proposal as { actions: PantryProposalAction[] }
    expect(shown.actions).toEqual([EGGS, SPINACH])
  })

  it('startNewChat clears the failed names', async () => {
    const { hook, msgId } = setup()

    applyPantryProposal.mockResolvedValueOnce({
      success: false,
      appliedCount: 1,
      failedCount: 1,
      errors: ["Units don't match (handful vs g), edit the unit for: Spinach"],
      failedActions: [SPINACH],
    })
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    expect(hook.result.current.proposalFailedNames).toEqual({ [msgId]: ['spinach'] })

    act(() => {
      hook.result.current.startNewChat()
    })
    expect(hook.result.current.proposalFailedNames).toEqual({})
  })
})
