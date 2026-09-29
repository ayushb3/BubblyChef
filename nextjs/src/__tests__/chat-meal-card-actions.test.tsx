/**
 * Issue #650 — end to end through the real ChatPage: the compact meal
 * card's Open meal / Save meal actions, and the "a second tap never creates
 * a second meal" guard (contract: `docs/plans/2026-09-29-issue-650-meal-
 * contract.md`, "Open meal ... Save meal ... A second tap never creates a
 * second meal").
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

const routerPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

const MEAL_RESPONSE: ChatResponse = {
  request_id: 'req-meal-2',
  workflow_id: 'wf-meal-2',
  conversation_id: 'conv-1',
  intent: 'meal_plan',
  assistant_message: 'Here is your meal:',
  proposal: {
    proposal_type: 'meal',
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

const MEAL_MESSAGE: ChatMessage = {
  id: 'assistant-meal-1',
  role: 'assistant',
  content: MEAL_RESPONSE.assistant_message,
  intent: 'meal_plan',
  response: MEAL_RESPONSE,
  timestamp: new Date(),
}

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [MEAL_MESSAGE],
    isStreaming: false,
    isResuming: false,
    proposalStates: {},
    proposalErrors: {},
    sendMessage: jest.fn(),
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

/** A promise the test controls the resolution of, for double-tap-before-resolve races. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('compact meal card actions (issue #650)', () => {
  it('Open meal creates a draft (is_draft: true) and routes to /meals/[id]', async () => {
    createMeal.mockResolvedValue({ id: 'meal-1', is_draft: true })
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Open meal' }))

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/meals/meal-1'))
    expect(createMeal).toHaveBeenCalledTimes(1)
    expect(createMeal).toHaveBeenCalledWith(expect.objectContaining({ is_draft: true }))
  })

  it('a second tap on Open meal while the first POST is in flight does not create a second meal', async () => {
    const { promise, resolve } = deferred<{ id: string; is_draft: boolean }>()
    createMeal.mockReturnValue(promise)
    renderChat()

    const button = await screen.findByRole('button', { name: 'Open meal' })
    fireEvent.click(button)
    // The button disables itself once tapped (openState leaves 'idle'), so a
    // second click before the POST resolves cannot re-fire the handler.
    fireEvent.click(button)
    fireEvent.click(button)

    resolve({ id: 'meal-1', is_draft: true })
    await waitFor(() => expect(routerPush).toHaveBeenCalled())

    expect(createMeal).toHaveBeenCalledTimes(1)
  })

  it('Save meal (no prior Open) creates with is_draft: false directly, never calling updateMeal', async () => {
    createMeal.mockResolvedValue({ id: 'meal-2', is_draft: false })
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Save meal' }))

    await screen.findByRole('button', { name: '✓ Saved!' })
    expect(createMeal).toHaveBeenCalledTimes(1)
    expect(createMeal).toHaveBeenCalledWith(expect.objectContaining({ is_draft: false }))
    expect(updateMeal).not.toHaveBeenCalled()
  })

  it('Save meal after Open meal already created a draft promotes it instead of creating a second meal', async () => {
    createMeal.mockResolvedValue({ id: 'meal-3', is_draft: true })
    updateMeal.mockResolvedValue({ id: 'meal-3', is_draft: false })
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Open meal' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/meals/meal-3'))

    fireEvent.click(await screen.findByRole('button', { name: 'Save meal' }))
    await screen.findByRole('button', { name: '✓ Saved!' })

    // Exactly one meal was ever created — Save promoted the existing draft.
    expect(createMeal).toHaveBeenCalledTimes(1)
    expect(updateMeal).toHaveBeenCalledWith('meal-3', { promote: true })
  })
})
