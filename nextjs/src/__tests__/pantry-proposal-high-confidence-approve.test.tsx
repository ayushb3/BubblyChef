/**
 * Issue #311 — high-confidence pantry proposals (`requires_review: false`)
 * render a card (chat/page.tsx gates purely on `intent === 'pantry_update' &&
 * actions.length > 0`), but useChat's onDone only populates `pendingProposals`
 * when `response.requires_review` is true. Approve then has nothing to look
 * up in `pendingProposals`, `approveProposal` bails out immediately, and
 * `applyPantryProposal` is never called — the button silently no-ops.
 *
 * This test streams a confident pantry_update response (requires_review:
 * false, non-empty proposal.actions), calls approveProposal, and asserts
 * applyPantryProposal actually fires. It must fail on the current code.
 */
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import { applyPantryProposal } from '@/lib/api/chat'
import type { ChatResponse, PantryProposalData } from '@/types/chat'

// useChat invalidates the ['bubbles'] query on proposal approval (#520) —
// it needs a QueryClientProvider to render.
function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const streamChatMessage = jest.fn()

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: (...args: unknown[]) => streamChatMessage(...args),
  fetchChatHistory: jest.fn().mockResolvedValue([]),
  applyPantryProposal: jest.fn().mockResolvedValue({
    success: true,
    appliedCount: 1,
    failedCount: 0,
    errors: [],
  }),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true })

const HIGH_CONFIDENCE_RESPONSE: ChatResponse = {
  request_id: 'req-high-confidence',
  workflow_id: 'wf-high-confidence',
  conversation_id: 'conv-1',
  intent: 'pantry_update',
  assistant_message: 'Added 2 apples to your pantry.',
  proposal: {
    actions: [
      { action_type: 'add', item: { name: 'apples', quantity: 2, unit: 'item' }, confidence: 0.95 },
    ],
  },
  confidence: { overall: 0.95 },
  // High confidence — the backend didn't ask for review.
  requires_review: false,
  next_action: 'none',
}

beforeEach(() => {
  streamChatMessage.mockReset()
  ;(applyPantryProposal as jest.Mock).mockClear()
})

/** Resolve a sendMessage call by invoking onDone with the given response. */
function respondWith(response: ChatResponse) {
  const [, , onDone] = streamChatMessage.mock.calls[streamChatMessage.mock.calls.length - 1]
  act(() => {
    onDone(response)
  })
}

describe('approving a high-confidence (requires_review: false) pantry proposal', () => {
  it('actually calls applyPantryProposal instead of silently no-oping', async () => {
    const { result } = renderHook(() => useChat(), { wrapper })

    act(() => {
      result.current.sendMessage('add 2 apples')
    })
    respondWith(HIGH_CONFIDENCE_RESPONSE)

    const assistantMsgId = result.current.messages[1].id

    await act(async () => {
      await result.current.approveProposal(assistantMsgId)
    })

    expect(applyPantryProposal).toHaveBeenCalledWith(
      'req-high-confidence',
      (HIGH_CONFIDENCE_RESPONSE.proposal as PantryProposalData).actions,
    )
    expect(result.current.proposalStates[assistantMsgId]).toBe('approved')
  })
})
