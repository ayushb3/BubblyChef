/**
 * Issue #871 -- Dismiss on a failed send also drops the stored turn.
 *
 * The AI service saves the user turn before it streams the reply, so a failed
 * stream leaves it stored with no reply. Dismiss clears the bubble AND asks the
 * service to delete that unanswered turn, once, so it does not return on reload.
 * Retry must not call it (the resend reuses the stored turn, #847).
 */
import { createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import { streamChatMessage, dismissUnansweredTurn } from '@/lib/api/chat'

jest.mock('@/lib/api/chat', () => ({
  fetchChatHistory: jest.fn(),
  streamChatMessage: jest.fn(),
  applyPantryProposal: jest.fn(),
  rejectPantryProposal: jest.fn(),
  dismissUnansweredTurn: jest.fn(),
}))

const mockStream = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>
const mockDismiss = dismissUnansweredTurn as jest.MockedFunction<typeof dismissUnansweredTurn>

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return createElement(QueryClientProvider, { client }, children)
}

function failNextStream() {
  mockStream.mockImplementationOnce(async (_req, _onToken, _onDone, onError) => {
    onError(new Error('Failed to fetch'))
  })
}

describe('useChat -- Dismiss deletes the stored unanswered turn (#871)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    mockStream.mockResolvedValue(undefined)
    mockDismiss.mockResolvedValue(true)
  })

  it('Dismiss after a server error calls the endpoint once, for that conversation', async () => {
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('plan dinner')
    })
    const conversationId = mockStream.mock.calls[0][0].conversation_id

    await act(async () => {
      result.current.dismissFailedSend(result.current.messages[1].id)
    })

    expect(mockDismiss).toHaveBeenCalledTimes(1)
    expect(mockDismiss).toHaveBeenCalledWith(conversationId)
    expect(result.current.messages).toHaveLength(0)
  })

  it('still clears the bubble and returns the text when the delete call fails', async () => {
    mockDismiss.mockRejectedValue(new Error('offline'))
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('plan dinner')
    })

    let restored: string | null = null
    await act(async () => {
      restored = result.current.dismissFailedSend(result.current.messages[1].id)
    })

    expect(restored).toBe('plan dinner')
    expect(result.current.messages).toHaveLength(0)
  })

  it('Retry does not delete the stored turn', async () => {
    failNextStream()
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.sendMessage('plan dinner')
    })

    await act(async () => {
      result.current.retryFailedSend(result.current.messages[1].id)
    })

    expect(mockDismiss).not.toHaveBeenCalled()
  })

  it('dismissing something that is not a failed send calls nothing', async () => {
    const { result } = renderHook(() => useChat(), { wrapper })
    await act(async () => {
      result.current.dismissFailedSend('no-such-message')
    })

    expect(mockDismiss).not.toHaveBeenCalled()
  })
})
