/**
 * Issues #489 + #490 — `useChat` owns the state of an "Update what I'm cooking"
 * card the way it owns a pantry card's: per message, confirmed through the AI
 * service (fail closed), dismissal recorded on the persisted turn, and the
 * state restored from history on a reload.
 */
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import {
  fetchChatHistory,
  streamChatMessage,
  applyCookAmendment,
  rejectPantryProposal,
} from '@/lib/api/chat'
import type { ChatResponse, ConversationHistoryTurn, RecipeAmendmentProposal } from '@/types/chat'

jest.mock('@/lib/api/chat', () => ({
  fetchChatHistory: jest.fn(),
  streamChatMessage: jest.fn(),
  applyPantryProposal: jest.fn(),
  rejectPantryProposal: jest.fn(),
  applyCookAmendment: jest.fn(),
}))

const mockStream = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>
const mockHistory = fetchChatHistory as jest.MockedFunction<typeof fetchChatHistory>
const mockApply = applyCookAmendment as jest.MockedFunction<typeof applyCookAmendment>
const mockReject = rejectPantryProposal as jest.MockedFunction<typeof rejectPantryProposal>

const STORAGE_KEY = 'bubblychef:chat:conversationId'
const RID = '11111111-1111-4111-8111-111111111111'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return createElement(QueryClientProvider, { client }, children)
}

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

const AMEND_RESPONSE = {
  request_id: RID,
  workflow_id: 'w1',
  conversation_id: 'conv-x',
  intent: 'cooking_help',
  assistant_message: 'A roux works.',
  proposal: PROPOSAL,
  confidence: { overall: 1 },
  requires_review: true,
  next_action: 'review_proposal',
  metadata: {},
} as unknown as ChatResponse

async function sendAmendment() {
  mockStream.mockImplementationOnce(async (_req, _onToken, onDone) => {
    onDone(AMEND_RESPONSE)
  })
  const hook = renderHook(() => useChat({ skipResume: true }), { wrapper })
  await act(async () => {
    hook.result.current.sendMessage('no cream, use a roux')
  })
  await waitFor(() =>
    expect(hook.result.current.messages.find((m) => m.role === 'assistant')?.response).toBeTruthy(),
  )
  const assistant = hook.result.current.messages.find((m) => m.role === 'assistant')!
  return { ...hook, msgId: assistant.id }
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  mockApply.mockResolvedValue(undefined)
  mockReject.mockResolvedValue(undefined)
})

describe('useChat — amendment card state (#489)', () => {
  it('a turn carrying an amendment proposal starts pending', async () => {
    const { result, msgId } = await sendAmendment()
    expect(result.current.amendmentStates[msgId]).toBe('pending')
  })

  it('applying confirms through the service with this conversation and this turn, then reads applied', async () => {
    const { result, msgId } = await sendAmendment()
    const convId = result.current.conversationId as string

    let applied: RecipeAmendmentProposal | null = null
    await act(async () => {
      applied = await result.current.applyAmendment(msgId)
    })

    expect(mockApply).toHaveBeenCalledWith({
      conversationId: convId,
      requestId: RID,
      proposal: PROPOSAL,
    })
    expect(applied).toEqual(PROPOSAL)
    expect(result.current.amendmentStates[msgId]).toBe('applied')
  })

  it('fails closed: a rejected apply reads failed with the reason, returns null, and can be retried', async () => {
    const { result, msgId } = await sendAmendment()
    mockApply.mockRejectedValueOnce(new Error('Conversation is not cooking recipe r1'))

    let applied: RecipeAmendmentProposal | null = PROPOSAL
    await act(async () => {
      applied = await result.current.applyAmendment(msgId)
    })
    expect(applied).toBeNull()
    expect(result.current.amendmentStates[msgId]).toBe('failed')
    expect(result.current.amendmentErrors[msgId]).toMatch(/not cooking recipe/)

    await act(async () => {
      applied = await result.current.applyAmendment(msgId)
    })
    expect(applied).toEqual(PROPOSAL)
    expect(result.current.amendmentStates[msgId]).toBe('applied')
    expect(result.current.amendmentErrors[msgId]).toBeUndefined()
  })

  it('a second tap while the first is still in flight does not apply twice', async () => {
    const { result, msgId } = await sendAmendment()
    let release!: () => void
    mockApply.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))

    let first!: Promise<RecipeAmendmentProposal | null>
    await act(async () => {
      first = result.current.applyAmendment(msgId)
    })
    let second: RecipeAmendmentProposal | null = PROPOSAL
    await act(async () => {
      second = await result.current.applyAmendment(msgId)
    })
    expect(second).toBeNull()
    expect(mockApply).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
      await first
    })
    expect(result.current.amendmentStates[msgId]).toBe('applied')
  })

  it('an already-applied card cannot be applied again', async () => {
    const { result, msgId } = await sendAmendment()
    await act(async () => {
      await result.current.applyAmendment(msgId)
    })
    let again: RecipeAmendmentProposal | null = PROPOSAL
    await act(async () => {
      again = await result.current.applyAmendment(msgId)
    })
    expect(again).toBeNull()
    expect(mockApply).toHaveBeenCalledTimes(1)
  })

  it('dismissing reads dismissed at once and records it on the turn, never applying', async () => {
    const { result, msgId } = await sendAmendment()
    const convId = result.current.conversationId as string
    act(() => {
      result.current.dismissAmendment(msgId)
    })
    expect(result.current.amendmentStates[msgId]).toBe('dismissed')
    expect(mockReject).toHaveBeenCalledWith(convId, [RID])
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('a failed dismissal record never reverts the card or throws', async () => {
    const { result, msgId } = await sendAmendment()
    mockReject.mockRejectedValueOnce(new Error('offline'))
    act(() => {
      result.current.dismissAmendment(msgId)
    })
    await act(async () => {})
    expect(result.current.amendmentStates[msgId]).toBe('dismissed')
  })

  it('a pantry-style turn gets no amendment state', async () => {
    mockStream.mockImplementationOnce(async (_req, _onToken, onDone) => {
      onDone({ ...AMEND_RESPONSE, intent: 'general_chat', proposal: null } as ChatResponse)
    })
    const { result } = renderHook(() => useChat({ skipResume: true }), { wrapper })
    await act(async () => {
      result.current.sendMessage('hi')
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.amendmentStates).toEqual({})
  })
})

describe('useChat — amendment card after a reload (#490)', () => {
  function turn(metadata: Record<string, unknown>): ConversationHistoryTurn {
    return {
      role: 'assistant',
      content: 'A roux works.',
      intent: 'cooking_help',
      proposal: PROPOSAL,
      metadata,
      created_at: new Date().toISOString(),
    }
  }

  it('restores an applied amendment as applied, not as a live button', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'conv-restore')
    mockHistory.mockResolvedValueOnce([
      { role: 'user', content: 'no cream, use a roux', intent: null, created_at: new Date().toISOString() },
      turn({
        request_id: RID,
        proposal_review: {
          status: 'applied',
          applied_keys: [],
          failed: [],
          error: null,
          chain_request_ids: [RID],
          updated_at: '2026-09-30T12:00:00+00:00',
        },
      }),
    ])
    const { result } = renderHook(() => useChat(), { wrapper })
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    const assistantId = result.current.messages[1].id
    expect(result.current.amendmentStates[assistantId]).toBe('applied')
  })

  it('a dismissal made before the reload restores as dismissed', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'conv-restore')
    mockHistory.mockResolvedValueOnce([
      turn({
        request_id: RID,
        proposal_review: {
          status: 'rejected',
          applied_keys: [],
          failed: [],
          error: null,
          chain_request_ids: [RID],
          updated_at: '2026-09-30T12:00:00+00:00',
        },
      }),
    ])
    const { result } = renderHook(() => useChat(), { wrapper })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.amendmentStates[result.current.messages[0].id]).toBe('dismissed')
  })
})
