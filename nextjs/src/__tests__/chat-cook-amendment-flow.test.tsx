/**
 * Issues #489 + #490 — the chat page's "Update what I'm cooking" flow, end to end
 * on the client: the card renders in the thread, applying it changes what the
 * banner counts and what "Finished cooking" deducts, and a full reload in the
 * middle of the cook keeps both.
 *
 * `useChat` is mocked (its own state machine is covered in
 * use-chat-amendment.test.ts); the cook-session store, `CookModal` and the page
 * are real, so what is asserted here is the wiring between them.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import {
  startCookSession,
  getAmendedIngredients,
  saveAmendedCook,
} from '@/lib/cook-session'
import type { ChatMessage, RecipeAmendmentProposal } from '@/types/chat'
import type { CookProposal, IngredientMatch } from '@/types/recipes'
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

jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
      const { initial: _i, animate: _a, transition: _t, exit: _e, ...safe } = rest as Record<string, unknown>
      return React.createElement(Tag, safe, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) })
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
    useAnimation: () => ({ start: jest.fn().mockResolvedValue(undefined) }),
  }
})

const replace = jest.fn()
let searchParams = new URLSearchParams('cooking=r1')
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => searchParams,
}))

// ── useChat: a controllable stand-in ──────────────────────────────────────────
const sendMessage = jest.fn()
const applyAmendment = jest.fn()
const dismissAmendment = jest.fn()
let hook: {
  messages: ChatMessage[]
  amendmentStates: Record<string, string>
  amendmentErrors: Record<string, string>
} = { messages: [], amendmentStates: {}, amendmentErrors: {} }

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: hook.messages,
    isStreaming: false,
    isResuming: false,
    conversationId: 'conv-1',
    proposalStates: {},
    proposalErrors: {},
    proposalFailedNames: {},
    amendmentStates: hook.amendmentStates,
    amendmentErrors: hook.amendmentErrors,
    sendMessage,
    sendChipMessage: jest.fn(),
    sendConfirmChoice: jest.fn(),
    cancelStream: jest.fn(),
    startNewChat: jest.fn(),
    approveProposal: jest.fn(),
    rejectProposal: jest.fn(),
    updateProposalActions: jest.fn(),
    applyAmendment: (...a: unknown[]) => applyAmendment(...a),
    dismissAmendment: (...a: unknown[]) => dismissAmendment(...a),
  }),
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

const fetchRecipe = jest.fn()
const cookRecipe = jest.fn()
const confirmCook = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  fetchRecipe: (id: string) => fetchRecipe(id),
  cookRecipe: (...args: unknown[]) => cookRecipe(...args),
  confirmCook: (...args: unknown[]) => confirmCook(...args),
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

const STORED = {
  id: 'r1',
  title: 'Creamy Tomato Garlic Pasta',
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'cream', quantity: 150, unit: 'ml' },
  ],
}

const ROUX: RecipeAmendmentProposal = {
  proposal_type: 'recipe_amendment',
  is_amendment: true,
  amended_ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g', optional: false, notes: null },
    { name: 'butter', quantity: 30, unit: 'g', optional: false, notes: null },
    { name: 'flour', quantity: 30, unit: 'g', optional: false, notes: null },
  ],
  change_summary: 'Swapped the cream for a butter and flour roux.',
  recipe_id: 'r1',
  recipe_title: 'Creamy Tomato Garlic Pasta',
}
const ROUX_LIST = ROUX.amended_ingredients

const amendMsg = (id: string, proposal = ROUX): ChatMessage =>
  ({
    id,
    role: 'assistant',
    content: 'A roux works well here.',
    intent: 'cooking_help',
    timestamp: new Date(),
    response: {
      request_id: `req-${id}`,
      workflow_id: 'w',
      conversation_id: 'conv-1',
      intent: 'cooking_help',
      assistant_message: 'A roux works well here.',
      proposal,
      confidence: { overall: 1 },
      requires_review: true,
      next_action: 'review_proposal',
      metadata: {},
    },
  }) as ChatMessage

const userMsg = (id: string): ChatMessage =>
  ({ id, role: 'user', content: 'no cream, use a roux', timestamp: new Date() }) as ChatMessage

const readyMatch = (over: Partial<IngredientMatch> = {}): IngredientMatch =>
  ({
    ingredient_name: 'butter',
    pantry_item_id: 'p1',
    pantry_item_name: 'butter',
    status: 'ready',
    match_type: 'exact',
    deduct_qty: 30,
    base_unit: 'g',
    substitution_note: null,
    ...over,
  }) as IngredientMatch

const PROPOSAL: CookProposal = {
  recipe_id: 'r1',
  recipe_title: 'Creamy Tomato Garlic Pasta',
  matches: [readyMatch()],
  missing: [],
  unit_conflicts: [],
  compound_suggestions: [],
} as unknown as CookProposal

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  searchParams = new URLSearchParams('cooking=r1')
  hook = { messages: [userMsg('u1'), amendMsg('a1')], amendmentStates: { a1: 'pending' }, amendmentErrors: {} }
  fetchRecipe.mockResolvedValue(STORED)
  cookRecipe.mockResolvedValue(PROPOSAL)
  confirmCook.mockResolvedValue(undefined)
  applyAmendment.mockResolvedValue(ROUX)
})

describe('the amendment card in the thread (#489)', () => {
  it('renders the card with the amended list under the assistant reply', async () => {
    renderChat()
    const card = await screen.findByTestId('cooking-amendment-card')
    expect(within(card).getByText(/butter and flour roux/i)).toBeInTheDocument()
    expect(within(card).getByText('Flour')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /update what i'm cooking/i })).toBeInTheDocument()
  })

  it('tapping Update applies through the hook, then the banner counts the amended list', async () => {
    renderChat()
    expect(await screen.findByText(/2 ingredients/i)).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /update what i'm cooking/i }))

    await waitFor(() => expect(applyAmendment).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(screen.getByText(/3 ingredients/i)).toBeInTheDocument())
    expect(getAmendedIngredients('r1')?.map((i) => i.name)).toEqual(['pasta', 'butter', 'flour'])
  })

  it('Finished cooking deducts against the amended list, not the stored one', async () => {
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /update what i'm cooking/i }))
    await waitFor(() => expect(screen.getByText(/3 ingredients/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /finished cooking/i }))

    await waitFor(() => expect(cookRecipe).toHaveBeenCalledTimes(1))
    const [recipeId, ingredients] = cookRecipe.mock.calls[0]
    expect(recipeId).toBe('r1')
    expect((ingredients as { name: string }[]).map((i) => i.name)).toEqual(['pasta', 'butter', 'flour'])
  })

  it('with no amendment, Finished cooking sends no override (the stored row is the truth)', async () => {
    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /finished cooking/i }))
    await waitFor(() => expect(cookRecipe).toHaveBeenCalledTimes(1))
    expect(cookRecipe.mock.calls[0][1]).toBeUndefined()
  })

  it('a failed apply stores nothing and leaves the banner on the original list', async () => {
    applyAmendment.mockResolvedValueOnce(null)
    renderChat()
    await screen.findByText(/2 ingredients/i)
    fireEvent.click(await screen.findByRole('button', { name: /update what i'm cooking/i }))
    await waitFor(() => expect(applyAmendment).toHaveBeenCalled())
    expect(getAmendedIngredients('r1')).toBeNull()
    expect(screen.getByText(/2 ingredients/i)).toBeInTheDocument()
  })

  it('Keep original hands the dismissal to the hook and stores nothing', async () => {
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /keep original/i }))
    expect(dismissAmendment).toHaveBeenCalledWith('a1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('only the latest amendment card is actionable; an older pending one is inert', async () => {
    hook = {
      messages: [userMsg('u1'), amendMsg('a1'), userMsg('u2'), amendMsg('a2')],
      amendmentStates: { a1: 'pending', a2: 'pending' },
      amendmentErrors: {},
    }
    renderChat()
    await screen.findAllByTestId('cooking-amendment-card')
    expect(screen.getAllByRole('button', { name: /update what i'm cooking/i })).toHaveLength(1)
  })

  it('a card for a recipe that is not the one being cooked is inert', async () => {
    hook = {
      messages: [amendMsg('a1', { ...ROUX, recipe_id: 'other-recipe' })],
      amendmentStates: { a1: 'pending' },
      amendmentErrors: {},
    }
    renderChat()
    await screen.findByTestId('cooking-amendment-card')
    expect(screen.queryByRole('button', { name: /update what i'm cooking/i })).not.toBeInTheDocument()
  })

  it('an applied card stays a terminal status (no live button), as after a reload', async () => {
    hook = { ...hook, amendmentStates: { a1: 'applied' } }
    renderChat()
    const card = await screen.findByTestId('cooking-amendment-card')
    expect(within(card).getByRole('status')).toHaveTextContent(/updated/i)
    expect(screen.queryByRole('button', { name: /update what i'm cooking/i })).not.toBeInTheDocument()
  })

  it('dismissing the cooking banner drops the amendment with the cook', async () => {
    saveAmendedCook('r1', { title: STORED.title, ingredients: ROUX_LIST })
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /dismiss cooking context/i }))
    expect(getAmendedIngredients('r1')).toBeNull()
  })
})

describe('a reload in the middle of the cook (#490)', () => {
  it('the banner still counts the amended list', async () => {
    saveAmendedCook('r1', { title: STORED.title, ingredients: ROUX_LIST })
    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    renderChat()
    expect(await screen.findByText(/3 ingredients/i)).toBeInTheDocument()
  })

  it('Finished cooking, after the reload, still deducts against the amended list', async () => {
    saveAmendedCook('r1', { title: STORED.title, ingredients: ROUX_LIST })
    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /finished cooking/i }))
    await waitFor(() => expect(cookRecipe).toHaveBeenCalledTimes(1))
    expect((cookRecipe.mock.calls[0][1] as { name: string }[]).map((i) => i.name)).toEqual([
      'pasta',
      'butter',
      'flour',
    ])
  })

  it('unmount and remount (a real reload) keeps the amendment applied before it', async () => {
    const first = renderChat()
    await screen.findByText(/2 ingredients/i)
    fireEvent.click(await screen.findByRole('button', { name: /update what i'm cooking/i }))
    await waitFor(() => expect(screen.getByText(/3 ingredients/i)).toBeInTheDocument())
    first.unmount()

    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    renderChat()
    expect(await screen.findByText(/3 ingredients/i)).toBeInTheDocument()
  })

  it('a finished cook clears it: the next cook of the same recipe starts from the original', async () => {
    saveAmendedCook('r1', { title: STORED.title, ingredients: ROUX_LIST })
    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: /finished cooking/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, i cooked this/i }))
    await waitFor(() => expect(confirmCook).toHaveBeenCalledTimes(1))
    expect(getAmendedIngredients('r1')).toBeNull()
    startCookSession('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('the first message after a reload pins the AMENDED list, not the stored one', async () => {
    saveAmendedCook('r1', { title: STORED.title, ingredients: ROUX_LIST })
    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    renderChat()
    await screen.findByText(/3 ingredients/i)

    fireEvent.change(screen.getByLabelText(/message bubbles/i), { target: { value: 'also swap parsley' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const context = sendMessage.mock.calls[0][1] as { cooking_recipe: { id: string; ingredients: { name: string }[] } }
    expect(context.cooking_recipe.id).toBe('r1')
    expect(context.cooking_recipe.ingredients.map((i) => i.name)).toEqual(['pasta', 'butter', 'flour'])
  })
})

describe('the cook context on the first message', () => {
  it('sends the full pin once the recipe has loaded, so the very first turn can carry an amendment', async () => {
    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    renderChat()
    await screen.findByText(/2 ingredients/i)
    fireEvent.change(screen.getByLabelText(/message bubbles/i), { target: { value: 'no cream' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    const context = sendMessage.mock.calls[0][1] as { cooking_recipe: { id: string; title: string } }
    expect(context.cooking_recipe.id).toBe('r1')
    expect(context.cooking_recipe.title).toBe(STORED.title)
  })

  it('falls back to the id-only pin when the recipe has not loaded yet (#155 still holds)', async () => {
    hook = { messages: [], amendmentStates: {}, amendmentErrors: {} }
    fetchRecipe.mockReturnValue(new Promise(() => {}))
    renderChat()
    fireEvent.change(screen.getByLabelText(/message bubbles/i), { target: { value: 'no cream' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    expect(sendMessage.mock.calls[0][1]).toEqual({ cooking_recipe_id: 'r1' })
  })
})
