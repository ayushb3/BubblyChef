/**
 * Regression test for #241 — a chat stream that ends without emitting an
 * `envelope` or `error` event used to leave the UI streaming forever, because
 * the caller only clears its streaming state from `onDone`/`onError`. The
 * `settle()` guard in `streamChatMessage` must synthesise a terminal callback
 * when the body closes cleanly with no envelope.
 */
import { streamChatMessage } from '@/lib/api/chat'
import type { ChatRequest } from '@/types/chat'
import { TextDecoder, TextEncoder } from 'util'

// jsdom ships neither encoder; the client under test constructs a TextDecoder.
Object.assign(global, { TextDecoder, TextEncoder })

// The client fetches a Supabase token before streaming; stub it out.
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  }),
}))

/**
 * Build a Response whose body yields the given SSE text once then closes.
 *
 * jsdom has no `ReadableStream`, so this hand-rolls the minimal reader surface
 * `streamChatMessage` touches: one `read()` with the payload, one signalling
 * `done`, and a no-op `releaseLock()`.
 */
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
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as unknown as Response
}

const request: ChatRequest = {
  message: 'hi',
  conversation_id: 'c1',
} as ChatRequest

describe('streamChatMessage terminal-callback guarantee (#241)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('fires onError when the stream closes without an envelope', async () => {
    // Tokens arrive, then the body ends — no `envelope`, no `error` event.
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        sseResponse('event: token\ndata: {"content":"partial"}\n\n'),
      ) as unknown as typeof fetch

    const onToken = jest.fn()
    const onDone = jest.fn()
    const onError = jest.fn()

    await streamChatMessage(request, onToken, onDone, onError)

    expect(onToken).toHaveBeenCalledWith('partial')
    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('fires onDone exactly once when an envelope arrives, not the fallback onError', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        sseResponse('event: envelope\ndata: {"data":{"intent":"chat"}}\n\n'),
      ) as unknown as typeof fetch

    const onToken = jest.fn()
    const onDone = jest.fn()
    const onError = jest.fn()

    await streamChatMessage(request, onToken, onDone, onError)

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })
})
