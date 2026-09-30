/**
 * Issue #651 PR B — "Make it a meal" wired through the real `ChatPage`.
 *
 * Clicks the real card buttons (chat recipe card, saved-recipe lookup card)
 * and asserts on the request each one sends: `context.meal_fixed_main` is a
 * payload for an unsaved (or draft) card and `{ recipe_id }` for a saved one,
 * and a double tap sends exactly one request. No model call anywhere — the
 * chat stream is mocked at the `useChat` boundary.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ChatMessage, ChatResponse } from '@/types/chat'

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

let mockSearchParams = new URLSearchParams('')
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}))

// The cook-preview modal is not under test; it would fetch its own data.
jest.mock('@/components/recipes/CookModal', () => ({
  __esModule: true,
  default: () => null,
}))

// The chat stream, mocked at the hook boundary. `sendMessage` mirrors the real
// hook's behaviour that matters here: it flips `isStreaming` on and returns
// early while streaming, so the disabled-button guard is exercised for real.
const mockChat: { messages: ChatMessage[] } = { messages: [] }
const sendMessageSpy = jest.fn()
const sendChipMessage = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useState } = require('react') as typeof import('react')
    const [isStreaming, setIsStreaming] = useState(false)
    return {
      messages: mockChat.messages,
      isStreaming,
      isResuming: false,
      proposalStates: {},
      proposalErrors: {},
      sendMessage: (...args: unknown[]) => {
        if (isStreaming) return
        sendMessageSpy(...args)
        setIsStreaming(true)
      },
      sendChipMessage,
      sendConfirmChoice: jest.fn(),
      cancelStream: jest.fn(),
      startNewChat: jest.fn(),
      approveProposal: jest.fn(),
      rejectProposal: jest.fn(),
      updateProposalActions: jest.fn(),
    }
  },
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

const fetchRecipe = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  fetchRecipe: (id: string) => fetchRecipe(id),
  promoteRecipeDraft: jest.fn(),
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

const RECIPE = {
  title: 'Garlic Butter Pasta',
  description: 'A quick weeknight pasta.',
  prep_time_minutes: 10,
  cook_time_minutes: 15,
  servings: 2,
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'garlic', quantity: 3, unit: 'clove' },
  ],
  instructions: ['Boil pasta.', 'Saute garlic in butter.', 'Toss together.'],
  ingredient_availability: [{ name: 'pasta', status: 'have' }],
}

function assistantMessage(
  id: string,
  intent: ChatResponse['intent'],
  proposal: unknown,
  extra: Partial<ChatResponse> = {},
): ChatMessage {
  const response: ChatResponse = {
    request_id: `req-${id}`,
    workflow_id: `wf-${id}`,
    conversation_id: 'conv-1',
    intent,
    assistant_message: `reply ${id}`,
    proposal: proposal as ChatResponse['proposal'],
    confidence: { overall: 0.9 },
    requires_review: false,
    next_action: 'none',
    ...extra,
  }
  return {
    id,
    role: 'assistant',
    content: response.assistant_message,
    intent,
    response,
    timestamp: new Date(),
  }
}

const recipeCardMessage = () =>
  assistantMessage('a1', 'recipe_card', { proposal_type: 'recipe_card', recipe: RECIPE })

const mealButton = () => screen.queryByRole('button', { name: /make it a meal/i })

/**
 * A `POST /api/recipes` that succeeds with the given row id. Any other request
 * the page makes (the starter context, say) gets an empty 200.
 */
const recipePosts = jest.fn()
function mockRecipeSave(id: string) {
  global.fetch = jest.fn(async (url: string) => {
    if (url === '/api/recipes') {
      recipePosts()
      return { ok: true, status: 201, json: async () => ({ id }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }) as unknown as typeof fetch
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
  mockSearchParams = new URLSearchParams('')
  mockChat.messages = [recipeCardMessage()]
})

describe('Make it a meal on a chat recipe card', () => {
  it('sends the recipe as a payload, without ingredient_availability', async () => {
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /make it a meal/i }))

    expect(sendMessageSpy).toHaveBeenCalledTimes(1)
    const [message, context] = sendMessageSpy.mock.calls[0]
    expect(message).toBe('Make Garlic Butter Pasta into a meal')
    expect(context.meal_fixed_main).not.toHaveProperty('recipe_id')
    expect(context.meal_fixed_main.recipe).toMatchObject({
      title: 'Garlic Butter Pasta',
      instructions: RECIPE.instructions,
      servings: 2,
    })
    expect(context.meal_fixed_main.recipe.ingredients).toEqual(RECIPE.ingredients)
    expect(context.meal_fixed_main.recipe).not.toHaveProperty('ingredient_availability')
  })

  it("sends { recipe_id } once this card's own Save has succeeded", async () => {
    mockRecipeSave('saved-1')
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: /save to library/i }))
    // The Save button disappears once a real library entry exists.
    await waitFor(() => expect(screen.queryByRole('button', { name: /save to library/i })).toBeNull())
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /make it a meal/i }))

    expect(sendMessageSpy).toHaveBeenCalledWith('Make Garlic Butter Pasta into a meal', {
      meal_fixed_main: { recipe_id: 'saved-1' },
    })
  })

  it('sends a payload, not the id, after Cook with me made a draft row', async () => {
    mockRecipeSave('draft-1')
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: /cook with me/i }))
    // The draft POST resolves and the pending state clears.
    await waitFor(() => expect(recipePosts).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /make it a meal/i })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: /make it a meal/i }))

    const [, context] = sendMessageSpy.mock.calls[0]
    expect(context.meal_fixed_main).not.toHaveProperty('recipe_id')
    expect(context.meal_fixed_main.recipe.title).toBe('Garlic Butter Pasta')
  })

  it('two synchronous clicks send exactly one request', async () => {
    renderChat()
    const button = await screen.findByRole('button', { name: /make it a meal/i })

    fireEvent.click(button)
    fireEvent.click(button)

    expect(sendMessageSpy).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
  })

  it('has no button while a cook is pinned in chat (?cooking=)', async () => {
    mockSearchParams = new URLSearchParams('cooking=r1')
    fetchRecipe.mockResolvedValue({ id: 'r1', title: 'Carbonara', ingredients: [] })
    renderChat()

    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledWith('r1'))
    await screen.findByText('Garlic Butter Pasta')
    await waitFor(() => expect(screen.getByText('Carbonara')).toBeInTheDocument())
    expect(mealButton()).toBeNull()
  })
})

describe('Make it a meal on the saved-recipe lookup card', () => {
  it('sends { recipe_id: match.id } from the single-match card', async () => {
    mockChat.messages = [
      assistantMessage('a2', 'saved_recipe_lookup', null, {
        metadata: {
          saved_recipe_matches: [{ id: 'saved-9', title: 'Butter Chicken', cuisine: 'Indian' }],
        },
      }),
    ]
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /make it a meal/i }))

    expect(sendMessageSpy).toHaveBeenCalledWith('Make Butter Chicken into a meal', {
      meal_fixed_main: { recipe_id: 'saved-9' },
    })
  })
})

describe('The options reply for a fixed main', () => {
  const option = (id: string) => ({
    option_id: id,
    title: `Option ${id}`,
    blurb: 'A blurb',
    dishes: [
      {
        role: 'main',
        name: 'Garlic Butter Pasta',
        key_ingredients: ['pasta'],
        est_total_minutes: 25,
        est_hands_on_minutes: 15,
      },
      {
        role: 'side',
        name: 'Green salad',
        key_ingredients: ['lettuce'],
        est_total_minutes: 5,
        est_hands_on_minutes: 5,
      },
    ],
    est_total_minutes: 25,
    est_hands_on_minutes: 15,
    coverage: null,
    rescues: [],
  })
  const optionsMessage = (fixedMain: boolean) =>
    assistantMessage(
      'a3',
      'meal_plan',
      {
        proposal_type: 'meal_options',
        options: [option('opt_1'), option('opt_2')],
        servings: 2,
        constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
        ...(fixedMain ? { fixed_main: { recipe_id: null, title: 'Garlic Butter Pasta' } } : {}),
      },
      { next_action: 'pick_meal' },
    )

  it('renders the side-only pills when fixed_main is present', async () => {
    mockChat.messages = [optionsMessage(true)]
    renderChat()

    expect(await screen.findByRole('button', { name: 'Quicker sides' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lighter sides' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Something quicker' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Make it vegetarian' })).toBeNull()
  })

  it('renders the ordinary pills without fixed_main', async () => {
    mockChat.messages = [optionsMessage(false)]
    renderChat()

    expect(await screen.findByRole('button', { name: 'Something quicker' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quicker sides' })).toBeNull()
  })
})
