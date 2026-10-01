/**
 * Issue #847 — Retry after a server-emitted `error` event.
 *
 * The AI service saves the user turn BEFORE the reply streams, so an `error`
 * event mid-reply leaves that turn stored server-side. The client must still
 * treat the failure as retryable: Retry resends the identical text exactly once
 * and the thread keeps ONE user bubble (the server dedupes the stored row, see
 * ai-service tests/test_issue_847_user_turn_dedupe.py).
 *
 * Unlike use-chat-send-retry.test.ts this drives the real `streamChatMessage`
 * SSE parser through a mocked `fetch`, so the failure arrives the way the server
 * sends it: a token, then `event: error`.
 */
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TextDecoder, TextEncoder } from 'util'
import { useChat } from '@/hooks/useChat'

// jsdom ships neither encoder; the SSE client constructs a TextDecoder.
Object.assign(global, { TextDecoder, TextEncoder })

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return createElement(QueryClientProvider, { client }, children)
}

/** A 200 SSE Response whose body yields `sse` once, then closes (jsdom has no ReadableStream). */
function sseResponse(sse: string): Response {
  let sent = false
  const reader = {
    read: async () => {
      if (sent) return { done: true, value: undefined }
      sent = true
      return { done: false, value: new TextEncoder().encode(sse) }
    },
    releaseLock: () => {},
  }
  return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response
}

const event = (name: string, data: unknown) =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

const ERROR_STREAM =
  event('token', { type: 'token', content: 'Let me think' }) +
  event('error', { type: 'error', message: 'model overloaded' })

const OK_STREAM = event('envelope', {
  type: 'envelope',
  data: {
    request_id: 'r1',
    workflow_id: 'w1',
    conversation_id: null,
    intent: 'general_chat',
    assistant_message: 'How about pasta?',
    proposal: null,
    confidence: { overall: 0.9 },
    requires_review: false,
    next_action: 'none',
  },
})

describe('useChat — Retry after a server error event (#847)', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    window.localStorage.clear()
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const sentBodies = () =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))

  it('Retry resends the same text once and the thread keeps one user bubble', async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse(ERROR_STREAM))
      .mockResolvedValueOnce(sseResponse(OK_STREAM))
    const { result } = renderHook(() => useChat(), { wrapper })

    await act(async () => {
      result.current.sendMessage('plan dinner')
    })
    await waitFor(() => expect(result.current.messages[1]?.sendFailure).toBeDefined())

    // The server error surfaced as a retryable failed send, with the text kept.
    expect(result.current.messages[1].content).toContain('model overloaded')
    expect(result.current.messages[1].sendFailure).toMatchObject({ text: 'plan dinner' })
    expect(result.current.isStreaming).toBe(false)

    await act(async () => {
      result.current.retryFailedSend(result.current.messages[1].id)
    })
    await waitFor(() =>
      expect(result.current.messages[1]?.content).toBe('How about pasta?'),
    )

    // Exactly one resend, identical text, same conversation.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [first, second] = sentBodies()
    expect(second.message).toBe('plan dinner')
    expect(second.conversation_id).toBe(first.conversation_id)

    // One user bubble, no leftover failure marker.
    const users = result.current.messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].content).toBe('plan dinner')
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages.some((m) => m.sendFailure)).toBe(false)
  })
})
