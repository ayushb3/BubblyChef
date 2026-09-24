/**
 * Issue #494 / PR #614 review finding 1 — tapping a card in the many-match
 * saved-recipe list must act on the recipe by id, not by re-sending its
 * title as chat text.
 *
 * A live verification during review confirmed the original wiring
 * (`sendMessage(match.title)`) sends the bare title back through the chat
 * endpoint, which the backend's `classify_intent` reads as a
 * `recipe_generation` request — the many-match tap generated a
 * near-duplicate recipe instead of opening the saved one, exactly what
 * issue #494's AC1 forbids ("does not generate a new recipe"). The fix
 * routes to `/chat?cooking=<id>`, the same id-based contract the
 * single-match card's "Cook this" action already uses (read reactively via
 * `useSearchParams` in `app/chat/page.tsx`).
 *
 * Driven end to end through the real `ChatPage`, same harness as
 * `chat-recipe-card-render.test.tsx`: mock `useChat` at the module level,
 * feed it a fixed `messages` array carrying a `saved_recipe_lookup` turn
 * with several matches, render the real page tree, tap a card.
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

// react-markdown / remark-gfm ship ESM only and jest runs this suite as CJS.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

const routerPush = jest.fn()
const routerReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

const SAVED_RECIPE_RESPONSE: ChatResponse = {
  request_id: 'req-saved-1',
  workflow_id: 'wf-saved-1',
  conversation_id: 'conv-1',
  intent: 'saved_recipe_lookup',
  assistant_message: 'Here is what I found in your saved recipes:',
  proposal: null,
  confidence: { overall: 0.9 },
  requires_review: false,
  next_action: 'none',
  metadata: {
    saved_recipe_matches: [
      { id: 'r1', title: 'Butter Chicken', description: 'Creamy tomato curry.', cuisine: 'Indian' },
      { id: 'r2', title: 'Chicken Tikka Masala', description: 'Smoky and rich.', cuisine: 'Indian' },
      { id: 'r3', title: 'Chicken Curry', cuisine: 'Indian' },
    ],
  },
}

const SAVED_RECIPE_MESSAGE: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: SAVED_RECIPE_RESPONSE.assistant_message,
  intent: 'saved_recipe_lookup',
  response: SAVED_RECIPE_RESPONSE,
  timestamp: new Date(),
}

const sendMessage = jest.fn()
const sendChipMessage = jest.fn()
const sendConfirmChoice = jest.fn()
const startNewChat = jest.fn()
const approveProposal = jest.fn()
const rejectProposal = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [SAVED_RECIPE_MESSAGE],
    isStreaming: false,
    isResuming: false,
    proposalStates: {},
    proposalErrors: {},
    sendMessage,
    sendChipMessage,
    sendConfirmChoice,
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
})

describe('saved_recipe_lookup many-match tap acts by id (issue #494)', () => {
  it('navigates to /chat?cooking=<id> and never sends the title as chat text', async () => {
    renderChat()

    const card = await screen.findByRole('listitem', { name: 'Pick Chicken Tikka Masala' })
    fireEvent.click(card)

    expect(routerPush).toHaveBeenCalledWith('/chat?cooking=r2', { scroll: false })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalledWith('Chicken Tikka Masala')
  })

  it('still renders the saved_recipe_lookup follow-up chips alongside the cards', async () => {
    renderChat()

    // The escape hatch: chips must survive a lookup turn that returned
    // matches, so the user can bail to a full list or a fresh generation
    // if the cards are wrong (PR #614 review, finding 2).
    expect(await screen.findByText('My saved recipes')).toBeInTheDocument()
    expect(screen.getByText('Generate a new one')).toBeInTheDocument()
  })

  it('tapping the "Generate a new one" chip sends its message', async () => {
    renderChat()

    const chip = await screen.findByText('Generate a new one')
    fireEvent.click(chip)

    expect(sendChipMessage).toHaveBeenCalledWith('Generate a new recipe instead')
  })
})
