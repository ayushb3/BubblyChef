/**
 * Issue #265 — the active chat conversation must survive navigation.
 *
 * `useChat` persists `conversationId` to `localStorage` (not the URL — see
 * the comment on `STORAGE_KEY` in useChat.ts) and restores it on mount unless
 * told to skip (deep-link seeds / cook handoff start fresh on purpose).
 */
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import {
  fetchChatHistory,
  streamChatMessage,
  applyPantryProposal,
  rejectPantryProposal,
} from '@/lib/api/chat'
import type {
  ConversationHistoryTurn,
  ChatRecipeData,
  ChatResponse,
  PantryProposalAction,
  PantryProposalData,
  ProposalReview,
} from '@/types/chat'

jest.mock('@/lib/api/chat', () => ({
  fetchChatHistory: jest.fn(),
  streamChatMessage: jest.fn(),
  applyPantryProposal: jest.fn(),
  rejectPantryProposal: jest.fn(),
}))

const mockFetchChatHistory = fetchChatHistory as jest.MockedFunction<typeof fetchChatHistory>
const mockStreamChatMessage = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>
const mockApply = applyPantryProposal as jest.MockedFunction<typeof applyPantryProposal>
const mockReject = rejectPantryProposal as jest.MockedFunction<typeof rejectPantryProposal>

const STORAGE_KEY = 'bubblychef:chat:conversationId'

// useChat invalidates the ['bubbles'] query on proposal approval (#520) —
// it needs a QueryClientProvider to render. No JSX here (this file is .ts,
// not .tsx), hence createElement.
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return createElement(QueryClientProvider, { client }, children)
}

function turn(role: 'user' | 'assistant', content: string): ConversationHistoryTurn {
  return { role, content, intent: null, created_at: new Date().toISOString() }
}

describe('useChat — conversation persistence (#265)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    // Default: sendMessage's stream never resolves unless a test wants it to.
    mockStreamChatMessage.mockResolvedValue(undefined)
  })

  it('fresh browser with empty storage starts a normal empty conversation without error', async () => {
    const { result } = renderHook(() => useChat(), { wrapper })

    // Give the resume effect a tick to (not) run.
    await act(async () => {})

    expect(result.current.messages).toEqual([])
    expect(result.current.conversationId).toBeNull()
    expect(mockFetchChatHistory).not.toHaveBeenCalled()
  })

  it('persists the id when the first message of a brand-new conversation is sent', async () => {
    const { result } = renderHook(() => useChat(), { wrapper })

    await act(async () => {
      result.current.sendMessage('hello bubbles')
    })

    await waitFor(() => expect(result.current.conversationId).not.toBeNull())
    const stored = window.localStorage.getItem(STORAGE_KEY)
    expect(stored).toBe(result.current.conversationId)
  })

  it('send -> navigate away -> return: resumes the same conversation with prior messages intact', async () => {
    const { result, unmount } = renderHook(() => useChat(), { wrapper })

    await act(async () => {
      result.current.sendMessage('what can I make with paprika?')
    })
    await waitFor(() => expect(result.current.conversationId).not.toBeNull())
    const convId = result.current.conversationId as string

    // Simulate leaving the page (unmount) and coming back (fresh hook instance,
    // as a real remount of the chat route would be).
    unmount()

    mockFetchChatHistory.mockResolvedValueOnce([
      turn('user', 'what can I make with paprika?'),
      turn('assistant', 'Try a paprika chicken!'),
    ])

    const { result: resumed } = renderHook(() => useChat(), { wrapper })

    await waitFor(() => expect(resumed.current.conversationId).toBe(convId))
    expect(mockFetchChatHistory).toHaveBeenCalledWith(convId)
    await waitFor(() => expect(resumed.current.messages).toHaveLength(2))
    expect(resumed.current.messages[0].content).toBe('what can I make with paprika?')
    expect(resumed.current.messages[1].content).toBe('Try a paprika chicken!')
  })

  it('refresh mid-conversation: restores the same conversation from storage', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'conv-refresh-1')
    mockFetchChatHistory.mockResolvedValueOnce([turn('user', 'hi'), turn('assistant', 'hello!')])

    const { result } = renderHook(() => useChat(), { wrapper })

    await waitFor(() => expect(result.current.conversationId).toBe('conv-refresh-1'))
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
  })

  it('"New Chat" clears the persisted id so returning afterwards resumes the NEW conversation, not the previous one', async () => {
    const { result, unmount } = renderHook(() => useChat(), { wrapper })

    // Old conversation.
    await act(async () => {
      result.current.sendMessage('old conversation message')
    })
    await waitFor(() => expect(result.current.conversationId).not.toBeNull())
    const oldConvId = result.current.conversationId as string

    // User taps "New Chat", then sends a message in the new thread.
    act(() => {
      result.current.startNewChat()
    })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

    await act(async () => {
      result.current.sendMessage('brand new conversation message')
    })
    await waitFor(() => expect(result.current.conversationId).not.toBeNull())
    const newConvId = result.current.conversationId as string
    expect(newConvId).not.toBe(oldConvId)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(newConvId)

    // Navigate away and back — must resume the NEW conversation.
    unmount()
    mockFetchChatHistory.mockResolvedValueOnce([
      turn('user', 'brand new conversation message'),
    ])

    const { result: resumed } = renderHook(() => useChat(), { wrapper })
    await waitFor(() => expect(resumed.current.conversationId).toBe(newConvId))
    expect(mockFetchChatHistory).toHaveBeenCalledWith(newConvId)
  })

  it('stale persisted id whose history fetch fails falls back to a fresh conversation and clears storage', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'dead-conv-id')
    mockFetchChatHistory.mockRejectedValueOnce(new Error('404'))

    const { result } = renderHook(() => useChat(), { wrapper })

    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull())
    expect(result.current.conversationId).toBeNull()
    expect(result.current.messages).toEqual([])

    // "New Chat" affordance still works after the fallback.
    await act(async () => {
      result.current.sendMessage('starting over')
    })
    await waitFor(() => expect(result.current.conversationId).not.toBeNull())
  })

  it('a persisted id that resolves to no history is treated as stale and cleared', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'empty-history-conv')
    mockFetchChatHistory.mockResolvedValueOnce([])

    const { result } = renderHook(() => useChat(), { wrapper })

    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull())
    expect(result.current.conversationId).toBeNull()
    expect(result.current.messages).toEqual([])
  })

  it('skipResume (deep-link seed / cook handoff) ignores a persisted id on mount', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'should-not-resume')

    const { result } = renderHook(() => useChat({ skipResume: true }), { wrapper })

    await act(async () => {})

    expect(mockFetchChatHistory).not.toHaveBeenCalled()
    expect(result.current.conversationId).toBeNull()
    expect(result.current.messages).toEqual([])
  })

  it('a skipResume true -> false transition (dismissing a seed card, ending a cook session, "New Chat" all strip the URL param that drove it) does not re-trigger history restore over a live conversation', async () => {
    // Mirrors the real page: a seeded/cook-handoff mount starts with
    // skipResume true, then the page strips the param and re-renders with
    // skipResume false — without unmounting the hook.
    const { result, rerender } = renderHook(
      ({ skipResume }) => useChat({ skipResume }),
      { initialProps: { skipResume: true }, wrapper },
    )

    // The seed's auto-send happens while skipResume is still true, exactly as
    // the page does it — this is what would be clobbered by a later restore.
    await act(async () => {
      result.current.sendMessage('seeded first message')
    })
    await waitFor(() => expect(result.current.conversationId).not.toBeNull())
    const liveConvId = result.current.conversationId as string
    const liveMessageCount = result.current.messages.length
    expect(liveMessageCount).toBeGreaterThan(0)

    // If this fires, it would find the id sendMessage just persisted and try
    // to restore over the live thread — the exact regression under test.
    mockFetchChatHistory.mockResolvedValueOnce([
      turn('user', 'seeded first message'),
    ])

    // Simulate `router.replace('/chat')` dropping the seed param.
    rerender({ skipResume: false })

    // Give any (incorrectly) re-triggered effect a chance to run and resolve.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockFetchChatHistory).not.toHaveBeenCalled()
    expect(result.current.conversationId).toBe(liveConvId)
    expect(result.current.messages).toHaveLength(liveMessageCount)
  })

  it('a send that races an in-flight resume fetch is not discarded when the fetch resolves', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'conv-race-1')

    let resolveHistory!: (turns: ConversationHistoryTurn[]) => void
    mockFetchChatHistory.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHistory = resolve
      }),
    )

    const { result } = renderHook(() => useChat(), { wrapper })

    // The fetch is in flight; the hook should already have adopted the
    // stored id synchronously so a send now reuses it rather than minting a
    // second one.
    await waitFor(() => expect(result.current.conversationId).toBe('conv-race-1'))

    await act(async () => {
      result.current.sendMessage('sent while resume was still in flight')
    })
    expect(result.current.conversationId).toBe('conv-race-1')
    expect(result.current.messages.some((m) => m.content === 'sent while resume was still in flight')).toBe(true)

    // Now the slow history fetch resolves — it must not overwrite the
    // message that was already sent, nor change the conversation id.
    await act(async () => {
      resolveHistory([turn('user', 'some older turn from before the race')])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.conversationId).toBe('conv-race-1')
    expect(result.current.messages.some((m) => m.content === 'sent while resume was still in flight')).toBe(true)
    expect(result.current.messages.some((m) => m.content === 'some older turn from before the race')).toBe(false)
  })

  // Regression: a recipe_card response carries a RecipeProposal
  // ({proposal_type, recipe, ...}) with NO `actions` field. onDone used to do
  // `proposal.actions.length` unconditionally, throwing a TypeError. Because
  // streamChatMessage's settle() marks the stream settled BEFORE invoking
  // onDone, that throw was swallowed and the setMessages call that stamps
  // intent/response onto the placeholder never ran — leaving an empty bubble
  // with default chips instead of the recipe card.
  it('a recipe_card response (proposal has no actions field) stamps intent + response without throwing', async () => {
    const recipeEnvelope = {
      intent: 'recipe_card',
      assistant_message: "Here's a recipe for Creamy Garlic Spaghetti!",
      proposal: {
        proposal_type: 'recipe_card',
        recipe: {
          id: 'r1',
          title: 'Creamy Garlic Spaghetti',
          ingredients: [{ name: 'spaghetti', quantity: 400, unit: 'g' }],
          instructions: ['Boil pasta.'],
        },
        pantry_match_score: 0.5,
      },
      requires_review: false,
      next_action: 'none',
      metadata: {},
    } as unknown as Parameters<Parameters<typeof streamChatMessage>[2]>[0]

    mockStreamChatMessage.mockImplementationOnce(
      async (_req, _onToken, onDone) => {
        onDone(recipeEnvelope)
      },
    )

    const { result } = renderHook(() => useChat(), { wrapper })

    await act(async () => {
      result.current.sendMessage('recipe for spaghetti creamy and garlicky')
    })

    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.role === 'assistant')
      expect(assistant?.intent).toBe('recipe_card')
    })
    const assistant = result.current.messages.find((m) => m.role === 'assistant')!
    expect(assistant.response?.proposal).toBeTruthy()
    expect(assistant.content).toContain('Creamy Garlic Spaghetti')
    expect(result.current.isStreaming).toBe(false)
  })

  it('a send that races an in-flight resume fetch survives that fetch subsequently failing', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'conv-race-2')

    let rejectHistory!: (err: Error) => void
    const historyPromise = new Promise<ConversationHistoryTurn[]>((_resolve, reject) => {
      rejectHistory = reject
    })
    // Prevent an unhandled-rejection warning between creation and the
    // `act()` below that actually triggers the rejection handling in the hook.
    historyPromise.catch(() => {})
    mockFetchChatHistory.mockReturnValueOnce(historyPromise)

    const { result } = renderHook(() => useChat(), { wrapper })
    await waitFor(() => expect(result.current.conversationId).toBe('conv-race-2'))

    await act(async () => {
      result.current.sendMessage('sent while resume was still in flight')
    })

    await act(async () => {
      rejectHistory(new Error('404'))
      await Promise.resolve()
      await Promise.resolve()
    })

    // The fetch failing must not retroactively invalidate the id a send is
    // already actively using.
    expect(result.current.conversationId).toBe('conv-race-2')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('conv-race-2')
    expect(result.current.messages.some((m) => m.content === 'sent while resume was still in flight')).toBe(true)
  })

  // Regression: recipe card proposals must survive navigate-away + back.
  // A recipe_card turn carries `proposal` + `intent` on the history row;
  // the restore mapper must rebuild a minimal ChatResponse so the card
  // render branch in chat/page.tsx fires on reload (#413 gap).
  it('reload-restore: an assistant turn with a recipe_card proposal rebuilds response.proposal and intent', async () => {
    // Drain any stale queued return values from earlier tests in this suite
    // (the skipResume true→false test queues a value that is intentionally
    // never consumed; if we don't clear it, it resolves our fetchChatHistory
    // call with its single-turn array instead of the array we queue below).
    mockFetchChatHistory.mockReset()

    window.localStorage.setItem(STORAGE_KEY, 'conv-recipe-restore-1')

    const recipeProposal = {
      proposal_type: 'recipe_card',
      recipe: {
        title: 'Creamy Garlic Spaghetti',
        ingredients: [{ name: 'spaghetti', quantity: 400, unit: 'g' }],
        instructions: ['Boil pasta.', 'Mix with garlic cream sauce.'],
      },
    }

    const historyTurns: ConversationHistoryTurn[] = [
      turn('user', 'make me a creamy spaghetti'),
      {
        role: 'assistant' as const,
        content: "Here's a recipe for Creamy Garlic Spaghetti!",
        intent: 'recipe_card',
        proposal: recipeProposal as unknown as ChatRecipeData,
        created_at: new Date().toISOString(),
      },
    ]
    mockFetchChatHistory.mockResolvedValueOnce(historyTurns)

    const { result } = renderHook(() => useChat(), { wrapper })

    await waitFor(() => {
      expect(mockFetchChatHistory).toHaveBeenCalledWith('conv-recipe-restore-1')
      expect(result.current.messages).toHaveLength(2)
    })

    const assistant = result.current.messages.find((m) => m.role === 'assistant')!
    expect(assistant.intent).toBe('recipe_card')
    expect(assistant.response?.proposal).toBeTruthy()
    expect((assistant.response?.proposal as { proposal_type?: string })?.proposal_type).toBe('recipe_card')
  })
})

// ─── Issue #444 — a pantry proposal survives navigating away and back ─────────
//
// The handled state is stored server side on the persisted turn
// (`metadata.request_id` + `metadata.proposal_review`); the restore mapper
// itself is covered purely in chat-restore.test.ts. These tests drive it
// through the hook: approve / retry / reject after a restore, and the request
// ids that reach the API client.

describe('useChat — pantry proposal restore (#444)', () => {
  const CONV = 'conv-444'
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  const LIVE = '99999999-9999-4999-8999-999999999999'
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  const act1 = (name: string, quantity: number, unit = 'whole'): PantryProposalAction => ({
    action_type: 'add',
    item: { name, quantity, unit },
    confidence: 0.9,
  })

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

  function pantryTurn(
    actions: PantryProposalAction[],
    requestId: string | null,
    proposalReview?: unknown,
    extra: Record<string, unknown> = {},
  ): ConversationHistoryTurn {
    const metadata: Record<string, unknown> = { ...extra }
    if (requestId) metadata.request_id = requestId
    if (proposalReview !== undefined) metadata.proposal_review = proposalReview
    return {
      role: 'assistant',
      content: 'Got it!',
      intent: 'pantry_update',
      proposal: { actions },
      metadata,
      created_at: new Date().toISOString(),
    }
  }

  function liveResponse(requestId: string, actions: PantryProposalAction[]): ChatResponse {
    return {
      request_id: requestId,
      workflow_id: 'wf',
      conversation_id: CONV,
      intent: 'pantry_update',
      assistant_message: 'Review before adding.',
      proposal: { actions },
      confidence: { overall: 0.9 },
      requires_review: true,
      next_action: 'review_proposal',
    }
  }

  function respondWith(response: ChatResponse) {
    const calls = mockStreamChatMessage.mock.calls
    const onDone = calls[calls.length - 1][2] as (r: ChatResponse) => void
    act(() => {
      onDone(response)
    })
  }

  const OK = { success: true, appliedCount: 1, failedCount: 0, errors: [] }

  async function mountRestored(turns: ConversationHistoryTurn[]) {
    window.localStorage.setItem(STORAGE_KEY, CONV)
    mockFetchChatHistory.mockResolvedValueOnce(turns)
    const hook = renderHook(() => useChat(), { wrapper })
    await waitFor(() => expect(hook.result.current.messages).toHaveLength(turns.length))
    return hook
  }

  const assistantOf = (hook: { result: { current: ReturnType<typeof useChat> } }, nth = 0) =>
    hook.result.current.messages.filter((m) => m.role === 'assistant')[nth]

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchChatHistory.mockReset()
    mockApply.mockReset()
    mockReject.mockReset()
    mockReject.mockResolvedValue(undefined)
    window.localStorage.clear()
    mockStreamChatMessage.mockResolvedValue(undefined)
  })

  it('F9: a restored pending card approves with the persisted request id and the chain', async () => {
    const hook = await mountRestored([turn('user', 'I bought 2 lemons'), pantryTurn([act1('lemon', 2)], A)])
    const msg = assistantOf(hook)
    expect(hook.result.current.proposalStates[msg.id]).toBe('pending')

    mockApply.mockResolvedValueOnce(OK)
    await act(async () => {
      await hook.result.current.approveProposal(msg.id)
    })

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith(A, [act1('lemon', 2)], {
      conversationId: CONV,
      turnRequestIds: [A],
    })
    expect(hook.result.current.proposalStates[msg.id]).toBe('approved')
  })

  it('F10: a restored partial card retries only the failed row, lemon is never sent', async () => {
    const hook = await mountRestored([
      turn('user', 'lemon and spinach'),
      pantryTurn(
        [act1('lemon', 1), act1('spinach', 1, 'cup')],
        A,
        review({
          status: 'failed',
          applied_keys: ['lemon'],
          failed: [{ key: 'spinach', name: 'spinach', quantity: 3, unit: 'cup' }],
          error: 'Item not found: spinach',
          chain_request_ids: [A],
        }),
      ),
    ])
    const msg = assistantOf(hook)
    expect(hook.result.current.proposalStates[msg.id]).toBe('failed')
    expect(hook.result.current.proposalFailedNames[msg.id]).toEqual(['spinach'])
    expect(hook.result.current.proposalErrors[msg.id]).toBe('Item not found: spinach')

    mockApply.mockResolvedValueOnce(OK)
    await act(async () => {
      await hook.result.current.approveProposal(msg.id)
    })

    expect(mockApply).toHaveBeenCalledTimes(1)
    const [, sent, reviewArg] = mockApply.mock.calls[0]
    expect(sent).toEqual([act1('spinach', 3, 'cup')])
    expect(reviewArg).toEqual({ conversationId: CONV, turnRequestIds: [A] })
    expect(hook.result.current.proposalStates[msg.id]).toBe('approved')
  })

  it('F11: a restored applied card cannot be approved again; its state stays approved', async () => {
    const hook = await mountRestored([
      turn('user', 'lemons'),
      pantryTurn(
        [act1('lemon', 2)],
        A,
        review({ status: 'applied', applied_keys: ['lemon'], chain_request_ids: [A] }),
      ),
    ])
    const msg = assistantOf(hook)
    await act(async () => {
      await hook.result.current.approveProposal(msg.id)
    })
    expect(mockApply).not.toHaveBeenCalled()
    expect(hook.result.current.proposalStates[msg.id]).toBe('approved')
  })

  it('F12: a live pantry turn after restored applied and legacy turns does not merge into history', async () => {
    const hook = await mountRestored([
      turn('user', 'lemons'),
      pantryTurn(
        [act1('lemon', 2)],
        A,
        review({ status: 'applied', applied_keys: ['lemon'], chain_request_ids: [A] }),
      ),
      turn('user', 'old one'),
      pantryTurn([act1('pear', 1)], null),
    ])
    const restoredApplied = assistantOf(hook, 0)

    act(() => {
      hook.result.current.sendMessage('and a carrot')
    })
    respondWith(liveResponse(LIVE, [act1('carrot', 1)]))

    const liveMsg = assistantOf(hook, 2)
    expect(hook.result.current.proposalStates[liveMsg.id]).toBe('pending')
    expect(hook.result.current.proposalStates[restoredApplied.id]).toBe('approved')
    expect((restoredApplied.response?.proposal as PantryProposalData).actions).toHaveLength(1)

    mockApply.mockResolvedValueOnce(OK)
    await act(async () => {
      await hook.result.current.approveProposal(liveMsg.id)
    })
    expect(mockApply).toHaveBeenCalledWith(LIVE, [act1('carrot', 1)], {
      conversationId: CONV,
      turnRequestIds: [LIVE],
    })
  })

  it('F13: after a fresh mount the live two-turn merge sends the STORED conversation id and both turn ids', async () => {
    // One prior text turn keeps the stored id valid (an empty history would
    // clear it). The id is only set inside the resume effect, after the first
    // render: a stale closure would send null here.
    const hook = await mountRestored([turn('user', 'hello')])
    expect(hook.result.current.conversationId).toBe(CONV)

    act(() => {
      hook.result.current.sendMessage('a lemon')
    })
    respondWith(liveResponse(A, [act1('lemon', 1)]))
    act(() => {
      hook.result.current.sendMessage('and a carrot')
    })
    respondWith(liveResponse(B, [act1('carrot', 1)]))

    const owner = assistantOf(hook, 1)
    mockApply.mockResolvedValueOnce(OK)
    await act(async () => {
      await hook.result.current.approveProposal(owner.id)
    })
    expect(mockApply).toHaveBeenCalledWith(B, [act1('lemon', 1), act1('carrot', 1)], {
      conversationId: CONV,
      turnRequestIds: [A, B],
    })
  })

  it('F13: a brand-new chat mints an id on the first send and approve sends that id, not null', async () => {
    const hook = renderHook(() => useChat(), { wrapper })
    act(() => {
      hook.result.current.sendMessage('a lemon')
    })
    respondWith(liveResponse(A, [act1('lemon', 1)]))
    const minted = hook.result.current.conversationId
    expect(minted).not.toBeNull()

    mockApply.mockResolvedValueOnce(OK)
    await act(async () => {
      await hook.result.current.approveProposal(hook.result.current.messages[1].id)
    })
    expect(mockApply).toHaveBeenCalledWith(A, [act1('lemon', 1)], {
      conversationId: minted,
      turnRequestIds: [A],
    })
  })

  it('F13: with a null conversation id the review argument is omitted', async () => {
    const hook = renderHook(() => useChat(), { wrapper })
    act(() => {
      hook.result.current.sendMessage('a lemon')
    })
    // Starting a new chat nulls the id; the in-flight reply still lands.
    act(() => {
      hook.result.current.startNewChat()
    })
    expect(hook.result.current.conversationId).toBeNull()
    respondWith(liveResponse(A, [act1('lemon', 1)]))
    const msgId = Object.keys(hook.result.current.proposalStates)[0]

    mockApply.mockResolvedValueOnce(OK)
    await act(async () => {
      await hook.result.current.approveProposal(msgId)
    })
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply.mock.calls[0]).toHaveLength(2)
  })

  it('F14: rejecting calls the reject route with the conversation and chain; a rejected promise is swallowed', async () => {
    const hook = await mountRestored([turn('user', 'lemons'), pantryTurn([act1('lemon', 2)], A)])
    const msg = assistantOf(hook)
    mockReject.mockRejectedValueOnce(new Error('network down'))

    expect(() => {
      act(() => {
        hook.result.current.rejectProposal(msg.id)
      })
    }).not.toThrow()
    await act(async () => {})

    expect(mockReject).toHaveBeenCalledWith(CONV, [A])
    expect(hook.result.current.proposalStates[msg.id]).toBe('rejected')
  })

  it('F17: a chain ending in a vague-only turn approves with valid ids only and ends approved', async () => {
    const hook = await mountRestored([
      turn('user', 'a lemon and veggies'),
      pantryTurn([act1('lemon', 2)], A),
      turn('user', 'some veggies'),
      pantryTurn([], B, undefined, {
        clarification_suggestions: [{ term: 'veggies', suggestions: ['carrot'] }],
      }),
    ])
    const owner = assistantOf(hook, 1)
    expect(hook.result.current.proposalStates[owner.id]).toBe('pending')

    // Mirror the backend's UUID validation of turn_request_ids.
    mockApply.mockImplementation(async (_rid, _actions, rev) => {
      if (rev?.turnRequestIds.some((id) => !UUID_RE.test(id))) throw new Error('422')
      return OK
    })
    await act(async () => {
      await hook.result.current.approveProposal(owner.id)
    })
    expect(mockApply).toHaveBeenCalledWith(B, [act1('lemon', 2)], {
      conversationId: CONV,
      turnRequestIds: [A, B],
    })
    expect(hook.result.current.proposalStates[owner.id]).toBe('approved')
  })

  // Regression guard: main already survives these turns (it never reads a
  // pantry proposal); this guards the new mapper against clearing the thread.
  it('F18 (regression guard): malformed pantry turns never clear the stored conversation', async () => {
    window.localStorage.setItem(STORAGE_KEY, CONV)
    mockFetchChatHistory.mockResolvedValueOnce([
      turn('user', 'hi'),
      {
        role: 'assistant',
        content: 'oops one',
        intent: 'pantry_update',
        proposal: { actions: 'oops' } as unknown as PantryProposalData,
        metadata: null,
        created_at: new Date().toISOString(),
      },
      {
        role: 'assistant',
        content: 'oops two',
        intent: 'pantry_update',
        proposal: { actions: [{ item: null }] } as unknown as PantryProposalData,
        metadata: { request_id: B },
        created_at: new Date().toISOString(),
      },
      pantryTurn([act1('lemon', 2)], A),
    ])
    const hook = renderHook(() => useChat(), { wrapper })
    await waitFor(() => expect(hook.result.current.messages).toHaveLength(4))

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(CONV)
    expect(hook.result.current.conversationId).toBe(CONV)
    expect(hook.result.current.proposalStates[assistantOf(hook, 2).id]).toBe('pending')
  })
})
