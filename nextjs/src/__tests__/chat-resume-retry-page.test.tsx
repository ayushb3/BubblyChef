/**
 * Issue #847 through the real ChatPage (same harness as
 * `chat-meal-option-pick.test.tsx`):
 *
 *  - an option set restored without `pick_meal` (older, or already picked)
 *    still draws its cards, read-only;
 *  - a failed send shows Retry first, and Retry / Dismiss reach the hook; a
 *    dismissed send puts its text back in the input.
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

function optionsResponse(nextAction: ChatResponse['next_action']): ChatResponse {
  return {
    request_id: 'req-meal-1',
    workflow_id: '',
    conversation_id: 'conv-1',
    intent: 'meal_plan',
    assistant_message: "Here's what I'm thinking for dinner:",
    proposal: {
      proposal_type: 'meal_options',
      options: [
        {
          option_id: 'opt_1',
          title: 'Lemon chicken dinner',
          blurb: '',
          dishes: [
            { role: 'main', name: 'Lemon butter chicken', key_ingredients: [], est_total_minutes: 30, est_hands_on_minutes: 15 },
          ],
          est_total_minutes: 30,
          est_hands_on_minutes: 15,
          coverage: null,
          rescues: [],
        },
      ],
      servings: 2,
      constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
    },
    confidence: { overall: 0 },
    requires_review: false,
    next_action: nextAction,
  }
}

function optionsMessage(nextAction: ChatResponse['next_action']): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: "Here's what I'm thinking for dinner:",
    intent: 'meal_plan',
    response: optionsResponse(nextAction),
    timestamp: new Date(),
  }
}

let currentMessages: ChatMessage[] = []
const sendMessage = jest.fn()
const retryFailedSend = jest.fn()
const dismissFailedSend = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: currentMessages,
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
    retryFailedSend,
    dismissFailedSend,
  }),
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))
jest.mock('@/lib/api/recipes', () => ({ fetchRecipe: jest.fn(), promoteRecipeDraft: jest.fn() }))
jest.mock('@/lib/api/meals', () => ({ createMeal: jest.fn(), updateMeal: jest.fn() }))

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

describe('restored meal option cards (#847)', () => {
  it('draws the cards of a restored set that is no longer pickable, read-only', async () => {
    currentMessages = [
      optionsMessage('none'),
      { id: 'u-2', role: 'user', content: 'thanks', timestamp: new Date() },
      { id: 'a-2', role: 'assistant', content: 'Anytime!', timestamp: new Date() },
    ]
    renderChat()

    const card = await screen.findByRole('listitem', { name: 'Pick Lemon chicken dinner' })
    expect(card).toBeDisabled()
    fireEvent.click(card)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('a restored pick_meal set that ends the thread is tappable', async () => {
    currentMessages = [optionsMessage('pick_meal')]
    renderChat()

    const card = await screen.findByRole('listitem', { name: 'Pick Lemon chicken dinner' })
    expect(card).toBeEnabled()
    fireEvent.click(card)
    expect(sendMessage).toHaveBeenCalledWith('Lemon chicken dinner', { meal_option_id: 'opt_1' })
  })
})

describe('failed send (#847)', () => {
  const failedThread = (): ChatMessage[] => [
    { id: 'u-1', role: 'user', content: 'plan dinner', timestamp: new Date() },
    {
      id: 'a-1',
      role: 'assistant',
      content: 'Oops! Something went wrong (Failed to fetch). Please try again!',
      timestamp: new Date(),
      sendFailure: { text: 'plan dinner' },
    },
  ]

  it('offers Retry first, and no generic follow-ups', async () => {
    currentMessages = failedThread()
    renderChat()

    const retry = await screen.findByRole('button', { name: /Retry/ })
    const dismiss = screen.getByRole('button', { name: /Dismiss/ })
    expect(retry.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Try another/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tell me more/ })).not.toBeInTheDocument()
  })

  it('Retry asks the hook to resend that failed turn', async () => {
    currentMessages = failedThread()
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: /Retry/ }))
    expect(retryFailedSend).toHaveBeenCalledTimes(1)
    expect(retryFailedSend).toHaveBeenCalledWith('a-1')
  })

  it('Dismiss puts the unsent text back in the input', async () => {
    currentMessages = failedThread()
    dismissFailedSend.mockReturnValue('plan dinner')
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: /Dismiss/ }))
    expect(dismissFailedSend).toHaveBeenCalledWith('a-1')
    expect(screen.getByRole('textbox', { name: 'Message Bubbles' })).toHaveValue('plan dinner')
  })
})
