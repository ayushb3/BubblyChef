/**
 * Issue #513 — a recipe-card reply renders as an empty bubble.
 *
 * useChat's onDone handler reads `proposal.actions.length` unconditionally,
 * for every intent — including `recipe_card`/`recipe_generation`, whose
 * proposal is a `RecipeCardProposal` with no `actions` field at all. That
 * throws inside `onDone`, and `streamChatMessage`'s SSE line handler
 * swallows the throw with a bare `catch {}` (it's invoked from inside that
 * try/catch), so the crash is silent: `setMessages` never runs for this
 * turn, and the assistant bubble stays empty forever.
 *
 * The envelope shape used below is the real backend one
 * (`ai-service/bubbly_chef/models/recipe.py:141` — `RecipeCardProposal`):
 * `{ proposal_type: 'recipe_card', recipe: {...} }`, NOT a flat
 * `ChatRecipeData`. `chat/page.tsx`'s `MessageRenderer` unwraps that
 * `recipe` key before handing it to `ChatRecipeCard` — a flat proposal
 * object would happen to work by accident (`'recipe' in rawProposal` is
 * false, so it falls through to using the object itself) and wouldn't catch
 * a regression in that unwrap.
 *
 * This file pins the `useChat` layer (same harness as
 * `pantry-card-merge.test.tsx`) — `onDone` doesn't throw and attaches the
 * wrapped proposal to the message as-is. `chat-recipe-card-render.test.tsx`
 * covers the render layer: feeding `ChatPage` that same wrapped envelope and
 * asserting the actual `ChatRecipeCard` shows up on screen.
 */

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import type { ChatResponse } from '@/types/chat'

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
  applyPantryProposal: jest.fn(),
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  streamChatMessage.mockReset()
  jest.clearAllMocks()
})

/**
 * The real backend envelope for a recipe-card turn — a `RecipeCardProposal`
 * (`proposal_type: 'recipe_card'`, `recipe: {...}`), not a flat
 * `ChatRecipeData`. Cast through `unknown` because `ChatResponse.proposal`
 * is currently typed as `PantryProposalData | ChatRecipeData | null` and
 * doesn't yet model the wrapper the backend actually sends — the same gap
 * `MessageRenderer`'s `'recipe' in rawProposal` runtime check papers over.
 */
const RECIPE_CARD_ENVELOPE = {
  proposal_type: 'recipe_card',
  recipe: {
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
}

const RECIPE_CARD_RESPONSE: ChatResponse = {
  request_id: 'req-recipe-1',
  workflow_id: 'wf-recipe-1',
  conversation_id: 'conv-1',
  intent: 'recipe_card',
  assistant_message: 'Here is a recipe you can make right now!',
  proposal: RECIPE_CARD_ENVELOPE as unknown as ChatResponse['proposal'],
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
  it('does not throw and attaches the wrapped recipe proposal to the assistant message', () => {
    const { result } = renderHook(() => useChat(), { wrapper })

    act(() => {
      result.current.sendMessage('give me a pasta recipe')
    })

    // The bug: proposal.actions.length throws for a RecipeCardProposal (no
    // `actions` field), which onDone does unconditionally today. Wrapping in
    // `act` surfaces that throw as a test failure rather than letting it
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

    const proposal = assistantMsg.response?.proposal as
      | { proposal_type?: string; recipe?: { title?: string; ingredients?: unknown[] } }
      | null
    expect(proposal?.proposal_type).toBe('recipe_card')
    expect(proposal?.recipe?.title).toBe('Garlic Butter Pasta')
    expect(proposal?.recipe?.ingredients).toHaveLength(2)
  })
})
