/**
 * Issue #760 — a saved-lookup turn that matched a saved meal renders the
 * compact meal card (before any recipe cards), and that card acts on the
 * existing meal: Open goes to /meals/<id>, nothing is created, Save is
 * already done. Same real-`ChatPage` harness as `chat-saved-recipe-pick`.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ChatMessage, ChatResponse } from '@/types/chat'
import { getSavedMealMatches, savedMealToProposal } from '@/types/chat'
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
const routerReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

const MEAL_MATCH = {
  id: 'meal-1',
  title: 'Cozy Pasta Night',
  description: null,
  servings: 2,
  dishes: [
    { role: 'main', position: 0, recipe_id: 'r1', title: 'Lemon Pasta' },
    { role: 'side', position: 1, recipe_id: 'r2', title: 'Green Salad' },
  ],
}

function lookupMessage(metadata: Record<string, unknown>): ChatMessage {
  const response: ChatResponse = {
    request_id: 'req-1',
    workflow_id: 'wf-1',
    conversation_id: 'conv-1',
    intent: 'saved_recipe_lookup',
    assistant_message: 'Found it — your saved meal Cozy Pasta Night!',
    proposal: null,
    confidence: { overall: 1 },
    requires_review: false,
    next_action: 'none',
    metadata,
  }
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: response.assistant_message,
    intent: 'saved_recipe_lookup',
    response,
    timestamp: new Date(),
  }
}

let currentMessages: ChatMessage[] = []
const sendMessage = jest.fn()

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
  }),
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
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

describe('saved lookup renders a saved meal as the compact meal card (issue #760)', () => {
  it('shows the meal title and its dishes', async () => {
    currentMessages = [lookupMessage({ saved_recipe_matches: [], saved_meal_matches: [MEAL_MATCH] })]
    renderChat()

    // Issue #744: the compact card is one button, so the title is not a heading, and the
    // dishes share one meta line.
    expect(await screen.findByText('Cozy Pasta Night')).toBeInTheDocument()
    expect(screen.getByText('Lemon Pasta · Green Salad')).toBeInTheDocument()
  })

  it('Open meal goes to the existing meal and creates nothing', async () => {
    currentMessages = [lookupMessage({ saved_recipe_matches: [], saved_meal_matches: [MEAL_MATCH] })]
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: /^Open meal/ }))

    expect(routerPush).toHaveBeenCalledWith('/meals/meal-1')
    expect(createMeal).not.toHaveBeenCalled()
    expect(updateMeal).not.toHaveBeenCalled()
  })

  it('shows the meal as already saved, with Save disabled', async () => {
    currentMessages = [lookupMessage({ saved_recipe_matches: [], saved_meal_matches: [MEAL_MATCH] })]
    renderChat()

    const save = await screen.findByRole('button', { name: /Saved!/ })
    expect(save).toBeDisabled()
  })

  it('puts the meal card before the recipe cards when both matched', async () => {
    currentMessages = [
      lookupMessage({
        saved_recipe_matches: [
          { id: 'rec-1', title: 'Pasta Bake', cuisine: 'Italian' },
          { id: 'rec-2', title: 'Pasta Salad', cuisine: 'Italian' },
        ],
        saved_meal_matches: [MEAL_MATCH],
      }),
    ]
    renderChat()

    const meal = await screen.findByText('Cozy Pasta Night')
    const recipe = screen.getByRole('button', { name: 'Show options for Pasta Bake' })
    expect(
      meal.compareDocumentPosition(recipe) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('still renders recipe-only matches with no meal card', async () => {
    currentMessages = [
      lookupMessage({
        saved_recipe_matches: [
          { id: 'rec-1', title: 'Pasta Bake', cuisine: 'Italian' },
          { id: 'rec-2', title: 'Pasta Salad', cuisine: 'Italian' },
        ],
      }),
    ]
    renderChat()

    expect(await screen.findByRole('button', { name: 'Show options for Pasta Bake' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open meal/ })).not.toBeInTheDocument()
  })
})

describe('getSavedMealMatches', () => {
  const wrap = (metadata: Record<string, unknown> | null) =>
    ({ metadata }) as unknown as ChatResponse

  it('is empty when absent, null or not an array', () => {
    expect(getSavedMealMatches(undefined)).toEqual([])
    expect(getSavedMealMatches(wrap(null))).toEqual([])
    expect(getSavedMealMatches(wrap({}))).toEqual([])
    expect(getSavedMealMatches(wrap({ saved_meal_matches: 'nope' }))).toEqual([])
  })

  it('drops a row missing id or title and a malformed dish', () => {
    const result = getSavedMealMatches(
      wrap({
        saved_meal_matches: [
          { title: 'No id', dishes: [] },
          { id: 'x', dishes: [] },
          null,
          {
            id: 'ok',
            title: 'Fine',
            dishes: [{ role: 'main', position: 0, title: 'Pasta' }, { role: 'dessert', position: 3 }, 7],
          },
        ],
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ok')
    expect(result[0].dishes).toEqual([{ role: 'main', position: 0, title: 'Pasta' }])
  })

  it('adapts to the card proposal without inventing missing ingredients', () => {
    const [match] = getSavedMealMatches(wrap({ saved_meal_matches: [MEAL_MATCH] }))
    const proposal = savedMealToProposal(match)
    expect(proposal.title).toBe('Cozy Pasta Night')
    expect(proposal.dishes.map((d) => d.recipe.title)).toEqual(['Lemon Pasta', 'Green Salad'])
    expect(proposal.missing_ingredients).toEqual([])
  })
})
