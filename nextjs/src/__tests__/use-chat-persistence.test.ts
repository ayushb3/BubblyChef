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
import { fetchChatHistory, streamChatMessage } from '@/lib/api/chat'
import type { ConversationHistoryTurn, ChatRecipeData } from '@/types/chat'

jest.mock('@/lib/api/chat', () => ({
  fetchChatHistory: jest.fn(),
  streamChatMessage: jest.fn(),
}))

const mockFetchChatHistory = fetchChatHistory as jest.MockedFunction<typeof fetchChatHistory>
const mockStreamChatMessage = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>

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
