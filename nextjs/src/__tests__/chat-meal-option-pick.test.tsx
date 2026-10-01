/**
 * Issue #650 — end to end through the real ChatPage (same harness as
 * `chat-saved-recipe-pick.test.tsx`): tapping a meal option card sends the
 * option's title as the visible message, with the structured option id in
 * `context.meal_option_id` — never fuzzy-matched from the title text.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ChatMessage, ChatResponse } from '@/types/chat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

function QueryWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

const MEAL_OPTIONS_RESPONSE: ChatResponse = {
  request_id: 'req-meal-1',
  workflow_id: 'wf-meal-1',
  conversation_id: 'conv-1',
  intent: 'meal_plan',
  assistant_message: "Here's what I'm thinking for dinner:",
  proposal: {
    proposal_type: 'meal_options',
    options: [
      {
        option_id: 'opt_1',
        title: 'Lemon chicken dinner',
        blurb: 'Bright, quick, uses the romaine tonight.',
        dishes: [
          { role: 'main', name: 'Lemon butter chicken', key_ingredients: ['chicken'], est_total_minutes: 30, est_hands_on_minutes: 15 },
          { role: 'side', name: 'Buttered orzo', key_ingredients: ['orzo'], est_total_minutes: 15, est_hands_on_minutes: 5 },
        ],
        est_total_minutes: 35,
        est_hands_on_minutes: 20,
        coverage: { pantry_items_used: 8, to_buy: ['parsley'] },
        rescues: ['romaine'],
      },
      {
        option_id: 'opt_2',
        title: 'Sheet pan salmon',
        blurb: 'One pan, twenty minutes.',
        dishes: [
          { role: 'main', name: 'Sheet pan salmon', key_ingredients: ['salmon'], est_total_minutes: 20, est_hands_on_minutes: 10 },
          { role: 'side', name: 'Roasted broccoli', key_ingredients: ['broccoli'], est_total_minutes: 20, est_hands_on_minutes: 5 },
        ],
        est_total_minutes: 20,
        est_hands_on_minutes: 10,
        coverage: { pantry_items_used: 5, to_buy: [] },
        rescues: [],
      },
    ],
    servings: 2,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
  },
  confidence: { overall: 0.9 },
  requires_review: false,
  next_action: 'pick_meal',
}

const MEAL_OPTIONS_MESSAGE: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: MEAL_OPTIONS_RESPONSE.assistant_message,
  intent: 'meal_plan',
  response: MEAL_OPTIONS_RESPONSE,
  timestamp: new Date(),
}

const sendMessage = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [MEAL_OPTIONS_MESSAGE],
    isStreaming: false,
    isResuming: false,
    proposalStates: {},
    proposalErrors: {},
    sendMessage,
    sendChipMessage: jest.fn(),
    sendConfirmChoice: jest.fn(),
    cancelStream: jest.fn(),
    startNewChat: jest.fn(),
    approveProposal: jest.fn(),
    rejectProposal: jest.fn(),
    updateProposalActions: jest.fn(),
  }),
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

jest.mock('@/lib/api/recipes', () => ({
  fetchRecipe: jest.fn(),
  promoteRecipeDraft: jest.fn(),
}))

jest.mock('@/lib/api/meals', () => ({
  createMeal: jest.fn(),
  updateMeal: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatPage = require('@/app/chat/page').default as () => React.JSX.Element

function renderChat() {
  return render(
    <ThemeProvider>
      <ChatPage />
    </ThemeProvider>,
    { wrapper: QueryWrapper },
  )
}

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
  window.localStorage.clear()
})

describe('meal option cards in chat send the structured option id (issue #650)', () => {
  it('renders both option cards from the meal_options proposal', async () => {
    renderChat()
    // Issue #744: each option is one card (a button named "Pick <title>"), so its title is
    // no longer a heading. "Sheet pan salmon" is both an option's title and its main dish
    // name, so the cards themselves are the unambiguous thing to count.
    expect(await screen.findByRole('listitem', { name: 'Pick Lemon chicken dinner' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Pick Sheet pan salmon' })).toBeInTheDocument()
  })

  it('sends the option title as the message and the option_id in context.meal_option_id — never a fuzzy match', async () => {
    renderChat()

    const card = await screen.findByRole('listitem', { name: 'Pick Sheet pan salmon' })
    fireEvent.click(card)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith('Sheet pan salmon', { meal_option_id: 'opt_2' })
  })
})
