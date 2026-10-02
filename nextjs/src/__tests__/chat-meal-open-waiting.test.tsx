/**
 * Issue #887 — through the real ChatPage: tapping a meal option shows a waiting
 * card (the option's title and dish names, an animated Bubbles) until the meal
 * arrives, in place of the bare typing dots. It makes no request of its own:
 * the one `sendMessage` the tap already made is the only call.
 */
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
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
        blurb: 'Bright, quick.',
        dishes: [
          { role: 'main', name: 'Lemon butter chicken', key_ingredients: ['chicken'], est_total_minutes: 30, est_hands_on_minutes: 15 },
          { role: 'side', name: 'Buttered orzo', key_ingredients: ['orzo'], est_total_minutes: 15, est_hands_on_minutes: 5 },
        ],
        est_total_minutes: 35,
        est_hands_on_minutes: 20,
        coverage: { pantry_items_used: 8, to_buy: [] },
        rescues: [],
      },
      {
        option_id: 'opt_2',
        title: 'Sheet pan salmon night',
        blurb: 'One pan.',
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

const OPTIONS_MESSAGE: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: MEAL_OPTIONS_RESPONSE.assistant_message,
  intent: 'meal_plan',
  response: MEAL_OPTIONS_RESPONSE,
  timestamp: new Date(),
}

// The hook is faked, so the test plays the stream: tap, then the user's turn and
// an empty assistant turn appear while `isStreaming` is true.
let mockMessages: ChatMessage[] = []
let mockStreaming = false
const sendMessage = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: mockMessages,
    isStreaming: mockStreaming,
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
jest.mock('@/lib/api/recipes', () => ({ fetchRecipe: jest.fn(), promoteRecipeDraft: jest.fn() }))
jest.mock('@/lib/api/meals', () => ({ createMeal: jest.fn(), updateMeal: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatPage = require('@/app/chat/page').default as () => React.JSX.Element

function ui() {
  return (
    <ThemeProvider>
      <ChatPage />
    </ThemeProvider>
  )
}

const userMsg = (text: string): ChatMessage => ({ id: 'user-2', role: 'user', content: text, timestamp: new Date() })
const emptyAssistant: ChatMessage = { id: 'assistant-2', role: 'assistant', content: '', timestamp: new Date() }

let fetchSpy: jest.SpyInstance

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
  mockMessages = [OPTIONS_MESSAGE]
  mockStreaming = false
  // The page's own mount-time reads (starter pills, pantry) get an empty OK reply.
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
  fetchSpy = jest.spyOn(global, 'fetch')
})

describe('meal open waiting card in chat (issue #887)', () => {
  it("shows the tapped option's title and dishes with Bubbles, not bare typing dots, while the meal is built", async () => {
    const { rerender } = render(ui(), { wrapper: QueryWrapper })
    fireEvent.click(await screen.findByRole('listitem', { name: 'Pick Sheet pan salmon night' }))
    expect(sendMessage).toHaveBeenCalledWith('Sheet pan salmon night', { meal_option_id: 'opt_2' })

    // The stream starts: the user's turn, then an assistant turn with no text yet.
    mockMessages = [OPTIONS_MESSAGE, userMsg('Sheet pan salmon night'), emptyAssistant]
    mockStreaming = true
    rerender(ui())

    const card = await screen.findByTestId('meal-open-waiting')
    expect(within(card).getByText('Sheet pan salmon night')).toBeInTheDocument()
    expect(within(card).getByText('Sheet pan salmon')).toBeInTheDocument()
    expect(within(card).getByText('Roasted broccoli')).toBeInTheDocument()
    expect(within(card).getByAltText('Bubbles thinking')).toBeInTheDocument()
    // It replaces the typing dots rather than stacking on them, and never says "Opening…" alone.
    expect(screen.queryByText('Bubbles is typing')).not.toBeInTheDocument()
    expect(screen.queryByText('Opening…')).not.toBeInTheDocument()
  })

  it('adds no request: the tap made one sendMessage, the card makes none of its own', async () => {
    const { rerender } = render(ui(), { wrapper: QueryWrapper })
    await screen.findByRole('listitem', { name: 'Pick Lemon chicken dinner' })
    fireEvent.click(screen.getByRole('listitem', { name: 'Pick Lemon chicken dinner' }))
    const fetchesAtTap = fetchSpy.mock.calls.length

    mockMessages = [OPTIONS_MESSAGE, userMsg('Lemon chicken dinner'), emptyAssistant]
    mockStreaming = true
    rerender(ui())
    await screen.findByTestId('meal-open-waiting')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    // Showing the card fetched nothing, and in particular touched no AI or meal route.
    expect(fetchSpy.mock.calls.length).toBe(fetchesAtTap)
    for (const [url] of fetchSpy.mock.calls) expect(String(url)).not.toMatch(/\/v1\/|\/api\/ai|\/api\/meals/)
  })

  it('goes away once the stream ends', async () => {
    const { rerender } = render(ui(), { wrapper: QueryWrapper })
    fireEvent.click(await screen.findByRole('listitem', { name: 'Pick Lemon chicken dinner' }))
    mockMessages = [OPTIONS_MESSAGE, userMsg('Lemon chicken dinner'), emptyAssistant]
    mockStreaming = true
    rerender(ui())
    await screen.findByTestId('meal-open-waiting')

    mockStreaming = false
    mockMessages = [
      OPTIONS_MESSAGE,
      userMsg('Lemon chicken dinner'),
      { ...emptyAssistant, content: 'Here is your meal.' },
    ]
    rerender(ui())
    await waitFor(() => expect(screen.queryByTestId('meal-open-waiting')).not.toBeInTheDocument())
  })

  it('a later ordinary message gets the typing dots, not the old pick\'s card', async () => {
    const { rerender } = render(ui(), { wrapper: QueryWrapper })
    fireEvent.click(await screen.findByRole('listitem', { name: 'Pick Lemon chicken dinner' }))
    // The pick finished and the thread moved on; now a plain question is streaming.
    mockMessages = [
      OPTIONS_MESSAGE,
      userMsg('Lemon chicken dinner'),
      { ...emptyAssistant, content: 'Here is your meal.' },
      { id: 'user-3', role: 'user', content: 'Can I swap the rice?', timestamp: new Date() },
      { id: 'assistant-3', role: 'assistant', content: '', timestamp: new Date() },
    ]
    mockStreaming = true
    rerender(ui())

    expect(screen.queryByTestId('meal-open-waiting')).not.toBeInTheDocument()
    expect(await screen.findByText('Bubbles is typing')).toBeInTheDocument()
  })

  it('a plain message with no pick shows the usual typing dots', async () => {
    mockMessages = [userMsg('hi'), emptyAssistant]
    mockStreaming = true
    render(ui(), { wrapper: QueryWrapper })
    expect(await screen.findByText('Bubbles is typing')).toBeInTheDocument()
    expect(screen.queryByTestId('meal-open-waiting')).not.toBeInTheDocument()
  })
})
