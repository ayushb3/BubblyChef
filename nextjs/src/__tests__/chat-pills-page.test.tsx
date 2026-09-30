/**
 * Issue #651 — page-level coverage for the predictive-pills wiring in
 * `app/chat/page.tsx`, on top of the unit coverage in
 * `chat-chip-resolver.test.ts` / `starter-pills.test.ts`. Mirrors the mocking
 * style of `chat-meal-card-actions.test.tsx` / `chat-saved-recipe-redismiss.test.tsx`:
 * `@/hooks/useChat` is mocked directly, and `messages` is a mutable
 * module-level fixture so each test picks its own without a fresh
 * `jest.mock` call.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ChatMessage, ChatResponse } from '@/types/chat'
import type { Recipe } from '@/components/recipes/RecipePage'
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

let currentSearch = ''
const routerPush = jest.fn()
const routerReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

// Mutable so each test picks its own fixture without a fresh jest.mock call.
let currentMessages: ChatMessage[] = []

const sendMessage = jest.fn()
const sendChipMessage = jest.fn()
const sendConfirmChoice = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: currentMessages,
    isStreaming: false,
    isResuming: false,
    proposalStates: {},
    proposalErrors: {},
    sendMessage,
    sendChipMessage,
    sendConfirmChoice,
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

const fetchRecipe = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  fetchRecipe: (id: string) => fetchRecipe(id),
  promoteRecipeDraft: jest.fn(),
}))

const createMeal = jest.fn()
const updateMeal = jest.fn()
jest.mock('@/lib/api/meals', () => ({
  createMeal: (...args: unknown[]) => createMeal(...args),
  updateMeal: (...args: unknown[]) => updateMeal(...args),
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

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

/** A promise the test controls the resolution of. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Every fetch call not aimed at the starter-context route gets a harmless empty 200. */
function makeFetchMock(starterHandler: () => Promise<Response>) {
  return jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/chat/starter-context')) return starterHandler()
    return Promise.resolve(jsonResponse({}))
  }) as unknown as typeof fetch
}

const originalFetch = global.fetch

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
  currentSearch = ''
  currentMessages = []
})

afterEach(() => {
  global.fetch = originalFetch
  jest.useRealTimers()
})

// ─── The starter row (§4/§7) ────────────────────────────────────────────────

describe('starter pills on the empty chat (issue #651)', () => {
  it('renders the time pill + fillers while the query is pending, then updates once it resolves', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 1, 18, 30))
    const pending = deferred<Response>()
    global.fetch = makeFetchMock(() => pending.promise)

    renderChat()

    expect(await screen.findByRole('button', { name: 'Plan dinner for 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What can I make tonight?' })).toBeInTheDocument()

    pending.resolve(jsonResponse({ default_servings: 4, pantry_count: 0 }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Plan dinner for 4' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Scan a receipt' })).toBeInTheDocument()
  })

  it('tapping the "Scan a receipt" action pill pushes /pantry?add=scan', async () => {
    global.fetch = makeFetchMock(() => Promise.resolve(jsonResponse({ pantry_count: 0 })))
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Scan a receipt' }))

    expect(routerPush).toHaveBeenCalledWith('/pantry?add=scan')
  })

  it('tapping a send pill calls sendMessage with the chip message', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 5, 1, 18, 30))
    global.fetch = makeFetchMock(() => Promise.resolve(jsonResponse({})))
    renderChat()

    const pill = await screen.findByRole('button', { name: 'What can I make tonight?' })
    fireEvent.click(pill)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith('What can I make tonight?', undefined)
  })
})

describe('the pinned-cooking row is unchanged while ?cooking= is set (issue #651)', () => {
  it('shows the cooking chips, not the starter row, and never fetches starter context', async () => {
    currentSearch = 'cooking=r1'
    const recipe: Recipe = {
      id: 'r1',
      user_id: 'user-1',
      title: 'Carbonara',
      ingredients: ['egg', 'pasta', 'pecorino'],
      instructions: ['Boil.', 'Toss.'],
    }
    fetchRecipe.mockResolvedValue(recipe)
    const starterFetch = jest.fn()
    global.fetch = makeFetchMock(() => {
      starterFetch()
      return Promise.resolve(jsonResponse({}))
    })

    renderChat()

    expect(await screen.findByRole('button', { name: /What can I substitute/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan dinner for 2' })).toBeNull()
    expect(starterFetch).not.toHaveBeenCalled()
  })
})

// ─── Meal-stage pills (§2/§4) ────────────────────────────────────────────────

const MEAL_READY_RESPONSE: ChatResponse = {
  request_id: 'req-meal-pills',
  workflow_id: 'wf-meal-pills',
  conversation_id: 'conv-1',
  intent: 'meal_plan',
  assistant_message: "Here's your Lemon chicken dinner: Lemon butter chicken with Buttered orzo!",
  proposal: {
    proposal_type: 'meal',
    meal_ref: 'ref-pills-1',
    title: 'Lemon chicken dinner',
    servings: 2,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
    dishes: [
      { role: 'main', position: 0, recipe: { title: 'Lemon butter chicken', ingredients: [], instructions: [] } },
      { role: 'side', position: 1, recipe: { title: 'Buttered orzo', ingredients: [], instructions: [] } },
    ],
    missing_ingredients: [],
  },
  confidence: { overall: 0.9 },
  requires_review: false,
  next_action: 'review_proposal',
}

const MEAL_OPTIONS_RESPONSE: ChatResponse = {
  request_id: 'req-options-pills',
  workflow_id: 'wf-options-pills',
  conversation_id: 'conv-1',
  intent: 'meal_plan',
  assistant_message: "Here's what I'm thinking for dinner:",
  proposal: {
    proposal_type: 'meal_options',
    options: [
      {
        option_id: 'opt_1',
        title: 'Lemon chicken dinner',
        blurb: 'Bright and quick.',
        dishes: [
          { role: 'main', name: 'Lemon butter chicken', key_ingredients: ['chicken'], est_total_minutes: 30, est_hands_on_minutes: 15 },
        ],
        est_total_minutes: 30,
        est_hands_on_minutes: 15,
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

function messageWith(response: ChatResponse): ChatMessage {
  return {
    id: 'assistant-pills-1',
    role: 'assistant',
    content: response.assistant_message,
    intent: 'meal_plan',
    response,
    timestamp: new Date(),
  }
}

describe('meal-ready pills (issue #651)', () => {
  beforeEach(() => {
    currentMessages = [messageWith(MEAL_READY_RESPONSE)]
    global.fetch = makeFetchMock(() => Promise.resolve(jsonResponse({})))
  })

  it('shows the fixed meal-ready pills under the card', async () => {
    renderChat()
    expect(await screen.findByRole('button', { name: 'Save this meal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Swap a side' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start cooking' })).toBeInTheDocument()
  })

  it('tapping "Save this meal" writes nothing and focuses the card\'s own Save meal button', async () => {
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Save this meal' }))

    const saveButton = screen.getByRole('button', { name: 'Save meal' })
    await waitFor(() => expect(saveButton).toHaveFocus())
    expect(createMeal).not.toHaveBeenCalled()
  })
})

describe('option-stage pills stamp the meal_followup context (issue #651)', () => {
  beforeEach(() => {
    currentMessages = [messageWith(MEAL_OPTIONS_RESPONSE)]
    global.fetch = makeFetchMock(() => Promise.resolve(jsonResponse({})))
  })

  it('tapping "Something quicker" sends context.meal_followup === true', async () => {
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Something quicker' }))

    expect(sendChipMessage).toHaveBeenCalledWith('Something quicker, under 30 minutes', {
      meal_followup: true,
    })
  })

  it('✎ fills the input with the pill message and sends nothing', async () => {
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit "Something quicker" before sending' }))

    expect(screen.getByRole('textbox', { name: 'Message Bubbles' })).toHaveValue(
      'Something quicker, under 30 minutes',
    )
    expect(sendChipMessage).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
