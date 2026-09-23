/**
 * Issue #513 — a recipe-card reply renders as an empty bubble.
 *
 * `chat-recipe-card-envelope.test.tsx` pins the `useChat` layer (onDone
 * doesn't throw on a `recipe_card` envelope). That guards the crash but not
 * what the user actually sees: `chat/page.tsx`'s `MessageRenderer` unwraps
 * the real backend envelope — a `RecipeCardProposal`
 * (`ai-service/bubbly_chef/models/recipe.py:141`): `{ proposal_type:
 * 'recipe_card', recipe: {...} }` — before handing `recipe` to
 * `ChatRecipeCard`. A flat `ChatRecipeData` proposal would happen to render
 * correctly by accident (`'recipe' in rawProposal` is false, so the object
 * falls through to being used as-is), so this test uses the real wrapped
 * shape to actually exercise that unwrap.
 *
 * Driven end to end through the real `ChatPage` component, same harness as
 * `chat-deep-links.test.tsx` (mock `useChat` at the module level, feed it a
 * fixed `messages` array, render the real page tree).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ChatMessage, ChatResponse } from '@/types/chat'

// react-markdown / remark-gfm ship ESM only and jest runs this suite as CJS.
// Stubbing them keeps the transform out of the picture — this suite never
// asserts on rendered markdown.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

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

const RECIPE_CARD_MESSAGE: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: RECIPE_CARD_RESPONSE.assistant_message,
  intent: 'recipe_card',
  response: RECIPE_CARD_RESPONSE,
  timestamp: new Date(),
}

const sendMessage = jest.fn()
const startNewChat = jest.fn()
const approveProposal = jest.fn()
const rejectProposal = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [RECIPE_CARD_MESSAGE],
    isStreaming: false,
    proposalStates: {},
    proposalErrors: {},
    sendMessage,
    cancelStream: jest.fn(),
    startNewChat,
    approveProposal,
    rejectProposal,
    updateProposalActions: jest.fn(),
  }),
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

const fetchRecipe = jest.fn()
const promoteRecipeDraft = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  fetchRecipe: (id: string) => fetchRecipe(id),
  promoteRecipeDraft: (...args: unknown[]) => promoteRecipeDraft(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatPage = require('@/app/chat/page').default as () => React.JSX.Element

function renderChat() {
  return render(
    <ThemeProvider>
      <ChatPage />
    </ThemeProvider>,
  )
}

// jsdom ships neither of these, and the chat surface uses both.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('recipe_card renders through the real page (issue #513)', () => {
  it('shows the ChatRecipeCard (title + ingredient) instead of an empty bubble', async () => {
    renderChat()

    // The card itself rendered — title and an ingredient from the wrapped
    // `recipe` payload are visible on screen. This is the thing #513
    // reported as broken: the assistant turn coming back with the "Try
    // another / Tell me more" chips but no card content underneath them.
    expect(await screen.findByText('Garlic Butter Pasta')).toBeInTheDocument()
    expect(screen.getByText('Boil pasta.')).toBeInTheDocument()

    // The assistant intro bubble is not left empty either — it renders
    // alongside the card.
    expect(screen.getByText(RECIPE_CARD_RESPONSE.assistant_message)).toBeInTheDocument()
  })
})
