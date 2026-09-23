/**
 * Issue #498 rework: context-aware follow-up chips arrive AFTER the envelope.
 *
 * The server sends the envelope as soon as the reply is done (with
 * `metadata.follow_ups_pending`), then the chip suggestions as a separate
 * `follow_ups` SSE event. The client settles the turn — and unlocks the input
 * — on the envelope, patches the chips in when they land, and falls back to
 * the static set if the stream ends without them.
 */
import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TextDecoder, TextEncoder } from 'util'
import { streamChatMessage } from '@/lib/api/chat'
import { useChat } from '@/hooks/useChat'
import { isFollowUpsPending, getFollowUpSuggestions } from '@/types/chat'
import type { ChatRequest, ChatResponse } from '@/types/chat'

Object.assign(global, { TextDecoder, TextEncoder })

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  }),
}))

const ENVELOPE = {
  intent: 'cooking_help',
  assistant_message: 'Chicken is done at 74°C.',
  proposal: null,
  requires_review: false,
  next_action: 'none',
  metadata: { follow_ups_pending: true },
}
const SUGGESTIONS = ['How long should it rest?', 'Where do I measure?']

/** A body that hands out one SSE chunk per read(), then closes. */
function chunkedResponse(chunks: string[]): Response {
  let i = 0
  const reader = {
    read: async () =>
      i < chunks.length
        ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
        : { done: true, value: undefined },
    releaseLock: () => {},
  }
  return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response
}

const sse = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify({ type, data })}\n\n`

const request = { message: 'is my chicken done?', conversation_id: 'c1' } as ChatRequest

describe('streamChatMessage — follow_ups after the envelope', () => {
  afterEach(() => jest.restoreAllMocks())

  it('settles on the envelope, then delivers the chips, then reports the end', async () => {
    const order: string[] = []
    global.fetch = jest.fn().mockResolvedValue(
      chunkedResponse([sse('envelope', ENVELOPE), sse('follow_ups', { suggestions: SUGGESTIONS })]),
    ) as unknown as typeof fetch

    await streamChatMessage(
      request,
      () => {},
      () => order.push('done'),
      () => order.push('error'),
      undefined,
      {
        onFollowUps: (s) => order.push(`follow_ups:${s.length}`),
        onStreamEnd: () => order.push('end'),
      },
    )

    expect(order).toEqual(['done', 'follow_ups:2', 'end'])
  })

  it('still reports the end when no follow_ups event ever comes', async () => {
    const onFollowUps = jest.fn()
    const onStreamEnd = jest.fn()
    global.fetch = jest
      .fn()
      .mockResolvedValue(chunkedResponse([sse('envelope', ENVELOPE)])) as unknown as typeof fetch

    await streamChatMessage(request, () => {}, jest.fn(), jest.fn(), undefined, {
      onFollowUps,
      onStreamEnd,
    })

    expect(onFollowUps).not.toHaveBeenCalled()
    expect(onStreamEnd).toHaveBeenCalledTimes(1)
  })
})

jest.mock('@/lib/api/chat', () => {
  const actual = jest.requireActual('@/lib/api/chat')
  return { ...actual, fetchChatHistory: jest.fn(), streamChatMessage: jest.fn(actual.streamChatMessage) }
})

// useChat reads the React Query client (#543), so it needs a provider to render.
function Wrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useChat — input unlocks before the chips arrive', () => {
  beforeEach(() => window.localStorage.clear())

  it('clears isStreaming on the envelope and patches chips in later', async () => {
    let releaseChips!: () => void
    const chipsGate = new Promise<void>((r) => (releaseChips = r))
    const mocked = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>
    mocked.mockImplementationOnce(async (_req, _onToken, onDone, _onError, _signal, extra) => {
      onDone(ENVELOPE as unknown as ChatResponse)
      await chipsGate
      extra?.onFollowUps?.(SUGGESTIONS)
      extra?.onStreamEnd?.()
    })

    const { result } = renderHook(() => useChat({ skipResume: true }), { wrapper: Wrapper })
    await act(async () => {
      result.current.sendMessage('is my chicken done?')
    })

    // The envelope has landed: the turn is settled (input unlocked) and the
    // chips are still on their way.
    await waitFor(() => expect(result.current.isStreaming).toBe(false))
    const pending = result.current.messages.find((m) => m.role === 'assistant')!
    expect(isFollowUpsPending(pending.response)).toBe(true)
    expect(getFollowUpSuggestions(pending.response)).toEqual([])

    await act(async () => {
      releaseChips()
    })
    await waitFor(() => {
      const m = result.current.messages.find((msg) => msg.role === 'assistant')!
      expect(getFollowUpSuggestions(m.response)).toEqual(SUGGESTIONS)
      expect(isFollowUpsPending(m.response)).toBe(false)
    })
  })

  it('stops waiting when the stream ends without chips (static fallback)', async () => {
    const mocked = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>
    mocked.mockImplementationOnce(async (_req, _onToken, onDone, _onError, _signal, extra) => {
      onDone(ENVELOPE as unknown as ChatResponse)
      extra?.onStreamEnd?.()
    })

    const { result } = renderHook(() => useChat({ skipResume: true }), { wrapper: Wrapper })
    await act(async () => {
      result.current.sendMessage('is my chicken done?')
    })

    await waitFor(() => {
      const m = result.current.messages.find((msg) => msg.role === 'assistant')!
      expect(m.response).toBeTruthy()
      expect(isFollowUpsPending(m.response)).toBe(false)
    })
    const m = result.current.messages.find((msg) => msg.role === 'assistant')!
    expect(getFollowUpSuggestions(m.response)).toEqual([])
  })

  it('a restored turn is never left waiting for chips', async () => {
    const { fetchChatHistory } = jest.requireMock('@/lib/api/chat') as {
      fetchChatHistory: jest.Mock
    }
    fetchChatHistory.mockResolvedValueOnce([
      { role: 'user', content: 'is my chicken done?', intent: null, created_at: new Date().toISOString() },
      {
        role: 'assistant',
        content: 'Chicken is done at 74°C.',
        intent: 'cooking_help',
        created_at: new Date().toISOString(),
        proposal: null,
        metadata: { follow_ups_pending: true },
      },
    ])
    window.localStorage.setItem('bubblychef:chat:conversationId', 'conv-restore-498')

    const { result } = renderHook(() => useChat(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    const restored = result.current.messages[1]
    expect(isFollowUpsPending(restored.response)).toBe(false)
  })
})
