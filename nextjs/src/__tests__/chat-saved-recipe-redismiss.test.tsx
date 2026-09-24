/**
 * PR #614 round-3 review, inline at app/chat/page.tsx (handlePickSavedRecipe):
 * after dismissing the "Cooking now" banner for a saved-recipe card, tapping
 * that same card again is a silent no-op — the ?cooking=<id> param gets set
 * again, but `cookingRecipe` stays gated behind `cookingRecipeId !==
 * dismissedRecipeId`, and dismissing never clears `dismissedRecipeId`. So the
 * banner never comes back, with no error and no visible reason why.
 *
 * This needs a *dynamic* next/navigation mock (useSearchParams must actually
 * reflect what router.replace/push last set, and re-render subscribers when
 * it changes) — the static `new URLSearchParams('')` mock used by
 * chat-saved-recipe-pick.test.tsx can't observe this, since it never changes.
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

// ── Dynamic next/navigation mock ────────────────────────────────────────────
// A module-level "current URL search string" that router.replace/push updates
// and useSearchParams subscribes to via a tiny listener set, so the component
// tree actually re-renders (and re-derives cookingRecipeId) the way it would
// against the real Next.js router.
let currentSearch = ''
const searchListeners = new Set<() => void>()
function setSearch(next: string) {
  currentSearch = next
  searchListeners.forEach((l) => l())
}

jest.mock('next/navigation', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react')
  return {
    useRouter: () => ({
      replace: (url: string) => {
        const q = url.includes('?') ? url.split('?')[1] : ''
        setSearch(q)
      },
      push: (url: string) => {
        const q = url.includes('?') ? url.split('?')[1] : ''
        setSearch(q)
      },
      refresh: () => {},
    }),
    useSearchParams: () => {
      const [, forceRender] = ReactLib.useState(0)
      ReactLib.useEffect(() => {
        const listener = () => forceRender((n: number) => n + 1)
        searchListeners.add(listener)
        return () => {
          searchListeners.delete(listener)
        }
      }, [])
      return new URLSearchParams(currentSearch)
    },
  }
})

const RECIPE_ID = 'r2'
const RECIPE: Recipe = {
  id: RECIPE_ID,
  user_id: 'user-1',
  title: 'Chicken Tikka Masala',
  ingredients: ['chicken', 'tomato', 'cream'],
  instructions: ['Marinate.', 'Grill.', 'Simmer in sauce.'],
}

const MANY_MATCH_RESPONSE: ChatResponse = {
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
      { id: RECIPE_ID, title: 'Chicken Tikka Masala', description: 'Smoky and rich.', cuisine: 'Indian' },
    ],
  },
}

// A single match — exercises SingleMatchCard's Cook this button rather than
// the many-match listitem, so the two entry points are each proven to route
// through the same handler (PR #614 round 4).
const SINGLE_MATCH_RESPONSE: ChatResponse = {
  ...MANY_MATCH_RESPONSE,
  request_id: 'req-saved-2',
  metadata: {
    saved_recipe_matches: [
      { id: RECIPE_ID, title: 'Chicken Tikka Masala', description: 'Smoky and rich.', cuisine: 'Indian' },
    ],
  },
}

function messageWith(response: ChatResponse): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: response.assistant_message,
    intent: 'saved_recipe_lookup',
    response,
    timestamp: new Date(),
  }
}

// Mutable so each describe block below can pick which fixture useChat
// returns without a fresh jest.mock per test file.
let currentMessage: ChatMessage = messageWith(MANY_MATCH_RESPONSE)

const sendMessage = jest.fn()
const sendChipMessage = jest.fn()
const sendConfirmChoice = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [currentMessage],
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

const fetchRecipe = jest.fn(async (id: string) => (id === RECIPE_ID ? RECIPE : null))
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
})

describe('re-tapping a saved-recipe card after dismissing its banner (PR #614 round 3)', () => {
  beforeEach(() => {
    currentMessage = messageWith(MANY_MATCH_RESPONSE)
  })

  it('re-shows the Cooking now banner on a second tap of the same card (many-match)', async () => {
    renderChat()

    // First tap — pins the recipe, banner appears.
    const card = await screen.findByRole('listitem', { name: 'Pick Chicken Tikka Masala' })
    fireEvent.click(card)
    expect(await screen.findByText('Chicken Tikka Masala', { selector: 'p' })).toBeInTheDocument()

    // Dismiss the banner.
    const dismissButton = screen.getByRole('button', { name: 'Dismiss cooking context' })
    fireEvent.click(dismissButton)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Dismiss cooking context' })).not.toBeInTheDocument()
    })

    // Second tap of the SAME card — this is the regression: without clearing
    // dismissedRecipeId, the banner would stay hidden even though the
    // ?cooking= param is set again.
    fireEvent.click(card)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss cooking context' })).toBeInTheDocument()
    })
  })
})

describe('re-tapping the single-match "Cook this" button after dismissing (PR #614 round 4)', () => {
  // Round 3's dismiss fix landed only in handlePickSavedRecipe, which the
  // many-match tap calls. The single-match card's "Cook this" was still a
  // <Link> with its own, separate startCookSession call and no knowledge of
  // dismissedRecipeId — so this exact same regression survived round 3 for
  // the single-match path. This test targets that button specifically, not
  // the many-match listitem, so the two entry points are each proven to
  // route through the same handler rather than one being fixed and the
  // other quietly left behind again.
  beforeEach(() => {
    currentMessage = messageWith(SINGLE_MATCH_RESPONSE)
  })

  it('re-shows the Cooking now banner on a second tap of Cook this (single match)', async () => {
    renderChat()

    const cookButton = await screen.findByRole('button', { name: 'Cook this' })
    fireEvent.click(cookButton)
    expect(await screen.findByText('Chicken Tikka Masala', { selector: 'p' })).toBeInTheDocument()

    const dismissButton = screen.getByRole('button', { name: 'Dismiss cooking context' })
    fireEvent.click(dismissButton)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Dismiss cooking context' })).not.toBeInTheDocument()
    })

    // Re-tap the same Cook this button.
    fireEvent.click(screen.getByRole('button', { name: 'Cook this' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss cooking context' })).toBeInTheDocument()
    })
  })
})
