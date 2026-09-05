/**
 * Feedback from a demo review: "add 2 apples and a dozen eggs" followed by
 * "got some veggies and dairy things" opened a SECOND pantry card for the
 * vague turn, stacked below the first — apples/eggs and the still-unresolved
 * terms read as two separate things instead of one pantry update.
 *
 * useChat's onDone now folds a vague-only turn's clarification terms into
 * the nearest earlier still-pending pantry card instead of opening a new one.
 * These tests pin that merge at the hook level (no rendering needed — the
 * behavior lives entirely in state, not JSX).
 */

import { act, renderHook } from '@testing-library/react'
import { useChat } from '@/hooks/useChat'
import type { ChatResponse } from '@/types/chat'

const streamChatMessage = jest.fn()

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: (...args: unknown[]) => streamChatMessage(...args),
  fetchChatHistory: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true })

function baseResponse(overrides: Partial<ChatResponse>): ChatResponse {
  return {
    request_id: 'req-1',
    workflow_id: 'wf-1',
    conversation_id: 'conv-1',
    intent: 'pantry_update',
    assistant_message: '',
    proposal: null,
    confidence: { overall: 0.8 },
    requires_review: true,
    next_action: 'review_proposal',
    ...overrides,
  }
}

const TURN1_RESPONSE = baseResponse({
  workflow_id: 'wf-turn1',
  assistant_message: 'I found 2 items. Please review before updating your pantry.',
  proposal: {
    actions: [
      { action_type: 'add', item: { name: 'apples', quantity: 2, unit: 'item' }, confidence: 0.75 },
      { action_type: 'add', item: { name: 'eggs', quantity: 12, unit: 'item' }, confidence: 0.75 },
    ],
  },
})

const TURN2_RESPONSE = baseResponse({
  workflow_id: 'wf-turn2',
  assistant_message:
    "(Still with apples, eggs from earlier in this chat.) veggies, dairy things are pretty broad...",
  proposal: { actions: [] },
  metadata: {
    clarification_suggestions: [
      { term: 'veggies', suggestions: ['onion', 'broccoli', 'carrot'] },
      { term: 'dairy things', suggestions: ['milk', 'yogurt', 'butter'] },
    ],
  },
})

beforeEach(() => {
  streamChatMessage.mockReset()
})

/** Resolve a sendMessage call by invoking onDone with the given response. */
function respondWith(response: ChatResponse) {
  const [, , onDone] = streamChatMessage.mock.calls[streamChatMessage.mock.calls.length - 1]
  act(() => {
    onDone(response)
  })
}

describe('pantry card merge across turns', () => {
  it('folds a vague-only turn into the earlier still-pending card instead of opening a second one', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.sendMessage('add 2 apples and a dozen eggs')
    })
    respondWith(TURN1_RESPONSE)

    // user + assistant(turn 1)
    expect(result.current.messages).toHaveLength(2)
    const turn1AssistantId = result.current.messages[1].id
    expect(result.current.proposalStates[turn1AssistantId]).toBe('pending')

    act(() => {
      result.current.sendMessage('I just picked up some stuff at the store, got a few veggies and some dairy things')
    })
    respondWith(TURN2_RESPONSE)

    // Turn 2's own assistant placeholder is dropped — not appended as a 4th
    // message — leaving [user1, assistant1(merged), user2].
    expect(result.current.messages).toHaveLength(3)
    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])

    const mergedAssistant = result.current.messages[1]
    expect(mergedAssistant.id).toBe(turn1AssistantId)
    // Original actions untouched.
    expect((mergedAssistant.response?.proposal as { actions: unknown[] }).actions).toHaveLength(2)
    // New terms merged in.
    expect(mergedAssistant.response?.metadata?.clarification_suggestions).toEqual(
      TURN2_RESPONSE.metadata?.clarification_suggestions,
    )

    // No new proposal/workflow tracked for the merged-away turn.
    expect(Object.keys(result.current.proposalStates)).toEqual([turn1AssistantId])
    expect(result.current.proposalStates[turn1AssistantId]).toBe('pending')
  })

  it('does not merge into a card that has already been approved or rejected', async () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.sendMessage('add 2 apples and a dozen eggs')
    })
    respondWith(TURN1_RESPONSE)
    const turn1AssistantId = result.current.messages[1].id

    await act(async () => {
      await result.current.approveProposal(turn1AssistantId)
    })
    expect(result.current.proposalStates[turn1AssistantId]).toBe('approved')

    act(() => {
      result.current.sendMessage('got some veggies and dairy things')
    })
    respondWith(TURN2_RESPONSE)

    // Turn 2 gets its own message this time — nothing pending to merge into.
    expect(result.current.messages).toHaveLength(4)
    expect(result.current.messages[3].response?.metadata?.clarification_suggestions).toEqual(
      TURN2_RESPONSE.metadata?.clarification_suggestions,
    )
  })

  it('opens its own card when nothing earlier is pending (first message is vague)', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.sendMessage('got some veggies and dairy things')
    })
    respondWith(TURN2_RESPONSE)

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1].response?.metadata?.clarification_suggestions).toEqual(
      TURN2_RESPONSE.metadata?.clarification_suggestions,
    )
  })
})
