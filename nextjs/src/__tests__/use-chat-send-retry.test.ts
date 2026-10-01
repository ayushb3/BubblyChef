/**
 * Issue #847 — a failed send is not a dead end.
 *
 * When the stream fails ("Failed to fetch"), the assistant reply is marked as a
 * failed send that remembers exactly what was sent. Retry resends the identical
 * text (and its context) once; Dismiss drops the failed pair and hands the text
 * back so the page can put it in the input.
 */
import { createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import { streamChatMessage } from '@/lib/api/chat'

jest.mock('@/lib/api/chat', () => ({
  fetchChatHistory: jest.fn(),
  streamChatMessage: jest.fn(),
  applyPantryProposal: jest.fn(),
  rejectPantryProposal: jest.fn(),
}))

const mockStream = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return createElement(QueryClientProvider, { client }, children)
}

/** Fail the next stream the way a dropped connection does. */
function failNextStream() {
  mockStream.mockImplementationOnce(async (_req, _onToken, _onDone, onError) => {
    onError(new Error('Failed to fetch'))
  })
}

describe('useChat — failed send (#847)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    mockStream.mockResolvedValue(undefined)
  })

  it('marks the reply as a failed send that remembers the text', async () => {
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('plan dinner')
    })

    const [user, reply] = result.current.messages
    expect(user.content).toBe('plan dinner')
    expect(reply.content).toContain('Failed to fetch')
    expect(reply.sendFailure).toMatchObject({ text: 'plan dinner' })
    expect(result.current.isStreaming).toBe(false)
  })

  it('Retry resends the identical text once and keeps a single user bubble', async () => {
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('plan dinner')
    })
    const failedId = result.current.messages[1].id

    await act(async () => {
      result.current.retryFailedSend(failedId)
    })

    expect(mockStream).toHaveBeenCalledTimes(2)
    expect(mockStream.mock.calls[1][0].message).toBe('plan dinner')
    expect(mockStream.mock.calls[1][0].conversation_id).toBe(
      mockStream.mock.calls[0][0].conversation_id,
    )
    const users = result.current.messages.filter((m) => m.role === 'user')
    expect(users).toHaveLength(1)
    expect(result.current.messages.some((m) => m.sendFailure)).toBe(false)
  })

  it('Retry carries the original context, so a failed meal pick still picks that option', async () => {
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('Lemon chicken dinner', { meal_option_id: 'opt_1' })
    })

    await act(async () => {
      result.current.retryFailedSend(result.current.messages[1].id)
    })

    expect(mockStream.mock.calls[1][0].context).toEqual({ meal_option_id: 'opt_1' })
  })

  it('Dismiss removes the failed pair and returns the text for the input', async () => {
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('plan dinner')
    })

    let restored: string | null = null
    act(() => {
      restored = result.current.dismissFailedSend(result.current.messages[1].id)
    })

    expect(restored).toBe('plan dinner')
    expect(result.current.messages).toHaveLength(0)
    expect(mockStream).toHaveBeenCalledTimes(1)
  })

  it('a second failure on Retry is again a retryable failed send', async () => {
    failNextStream()
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('plan dinner')
    })
    await act(async () => {
      result.current.retryFailedSend(result.current.messages[1].id)
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1].sendFailure).toMatchObject({ text: 'plan dinner' })
  })
})
