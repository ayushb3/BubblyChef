/**
 * Issue #513 — a recipe-card reply renders as an empty bubble.
 *
 * useChat's onDone handler reads `proposal.actions.length` unconditionally,
 * for every intent — including `recipe_card`/`recipe_generation`, whose
 * proposal is a `ChatRecipeData` with no `actions` field at all. That throws
 * inside `onDone`, and `streamChatMessage`'s SSE line handler swallows the
 * throw with a bare `catch {}` (it's invoked from inside that try/catch), so
 * the crash is silent: `setMessages` never runs for this turn, and the
 * assistant bubble stays empty forever.
 *
 * This test drives `useChat` exactly the way the app does — mocking
 * `streamChatMessage` and invoking the captured `onDone` directly, same
 * harness as `pantry-card-merge.test.tsx` — with a `recipe_card` envelope
 * whose `proposal` has no `actions` key. It must not throw, and the
 * resulting assistant message must carry the recipe data.
 */

import { act, renderHook } from '@testing-library/react'
import { useChat } from '@/hooks/useChat'
import type { ChatResponse } from '@/types/chat'

const streamChatMessage = jest.fn()

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: (...args: unknown[]) => streamChatMessage(...args),
  fetchChatHistory: jest.fn().mockResolvedValue([]),
  applyPantryProposal: jest.fn(),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  streamChatMessage.mockReset()
})

const RECIPE_CARD_RESPONSE: ChatResponse = {
  request_id: 'req-recipe-1',
  workflow_id: 'wf-recipe-1',
  conversation_id: 'conv-1',
  intent: 'recipe_card',
  assistant_message: 'Here is a recipe you can make right now!',
  // No `actions` key — this is the ChatRecipeData shape, not PantryProposalData.
  proposal: {
    title: 'Garlic Butter Pasta',
    description: 'A quick weeknight pasta.',
    prep_time_minutes: 10,
    cook_time_minutes: 15,
    servings: 2,
    ingredients: [
      { name: 'pasta', quantity: 200, unit: 'g' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
    ],
    instructions: ['Boil pasta.', 'Sauté garlic in butter.', 'Toss together.'],
  },
  confidence: { overall: 0.9 },
  requires_review: false,
  next_action: 'none',
}

/** Resolve a sendMessage call by invoking onDone with the given response. */
function respondWith(response: ChatResponse) {
  const [, , onDone] = streamChatMessage.mock.calls[streamChatMessage.mock.calls.length - 1]
  onDone(response)
}

describe('recipe_card onDone envelope (issue #513)', () => {
  it('does not throw and attaches the recipe proposal to the assistant message', () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      result.current.sendMessage('give me a pasta recipe')
    })

    // The bug: proposal.actions.length throws for a ChatRecipeData proposal
    // (no `actions` field), which onDone does unconditionally today. Wrapping
    // in `act` surfaces that throw as a test failure rather than letting it
    // vanish the way the real swallowed-catch in chat.ts does.
    expect(() => {
      act(() => {
        respondWith(RECIPE_CARD_RESPONSE)
      })
    }).not.toThrow()

    // user + assistant
    expect(result.current.messages).toHaveLength(2)
    const assistantMsg = result.current.messages[1]

    // The crash happens before setMessages runs, so on the buggy code this
    // never gets set — the bubble stays on its empty placeholder content.
    expect(assistantMsg.intent).toBe('recipe_card')
    expect(assistantMsg.content).toBe(RECIPE_CARD_RESPONSE.assistant_message)

    const proposal = assistantMsg.response?.proposal as { title?: string; ingredients?: unknown[] } | null
    expect(proposal?.title).toBe('Garlic Butter Pasta')
    expect(proposal?.ingredients).toHaveLength(2)
  })
})
