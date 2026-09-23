/**
 * Two-tab double deduction guard (PR #475).
 *
 * `isCookSessionEnded` (backed by `localStorage`, shared across tabs) only
 * used to get read once, at render, to decide whether to show the COOKING
 * banner (`CookingContextCard`). That's stale the moment a *different* tab
 * confirms the same recipe's deduction: tab 1's banner (and its "Finished
 * cooking →" button) sat there unaware, and tapping it still opened the
 * confirm sheet and could deduct the same ingredients a second time.
 *
 * The fix re-checks `isCookSessionEnded` at two points instead of trusting
 * the stale render-time value:
 *   1. The instant "Finished cooking →" is tapped (`onFinishCooking` in
 *      `app/chat/page.tsx`) — if the session already ended, the confirm
 *      sheet never opens and the banner is dismissed instead.
 *   2. The instant the confirm button inside `CookModal` is tapped
 *      (`handleConfirm`) — closes the gap between opening the sheet and
 *      actually tapping confirm, during which another tab could finish.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { endCookSession } from '@/lib/cook-session'
import type { CookProposal, IngredientMatch } from '@/types/recipes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The chat page reads useQueryClient() (#520, to invalidate the bubbles balance), so
// it needs a QueryClientProvider to render.
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
      return React.createElement(Tag, rest, children)
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

const sendMessage = jest.fn()
jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [],
    isStreaming: false,
    proposalStates: {},
    sendMessage,
    cancelStream: jest.fn(),
    startNewChat: jest.fn(),
    approveProposal: jest.fn(),
    rejectProposal: jest.fn(),
  }),
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

const fetchRecipe = jest.fn()
const cookRecipe = jest.fn()
const confirmCook = jest.fn()
const promoteRecipeDraft = jest.fn()
jest.mock('@/lib/api/recipes', () => ({
  fetchRecipe: (id: string) => fetchRecipe(id),
  cookRecipe: (id: string) => cookRecipe(id),
  confirmCook: (id: string, deductions: unknown) => confirmCook(id, deductions),
  promoteRecipeDraft: (id: string) => promoteRecipeDraft(id),
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

const readyMatch = (over: Partial<IngredientMatch> = {}): IngredientMatch => ({
  ingredient_name: 'egg',
  pantry_item_id: 'p1',
  pantry_item_name: 'egg',
  status: 'ready',
  match_type: 'exact',
  deduct_qty: 2,
  base_unit: 'item',
  substitution_note: null,
  ...over,
} as IngredientMatch)

const PROPOSAL: CookProposal = {
  recipe_id: 'r1',
  recipe_title: 'Carbonara',
  matches: [readyMatch()],
  missing: [],
  unit_conflicts: [],
  compound_suggestions: [],
} as unknown as CookProposal

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  searchParams = new URLSearchParams('cooking=r1')
  fetchRecipe.mockResolvedValue({ id: 'r1', title: 'Carbonara', ingredients: [{ name: 'egg' }] })
  cookRecipe.mockResolvedValue(PROPOSAL)
  confirmCook.mockResolvedValue(undefined)
})

describe('two-tab double deduction guard (PR #475)', () => {
  it('checkpoint 1: a session already ended by another tab does not open the confirm sheet when "Finished cooking" is tapped', async () => {
    renderChat()

    const finishBtn = await screen.findByRole('button', { name: /finished cooking/i })

    // Another tab confirmed this exact recipe's deduction in between — this
    // tab's banner is stale (it only read isCookSessionEnded at render).
    endCookSession('r1')

    fireEvent.click(finishBtn)

    // The confirm sheet must never open — no proposal fetch, no deduction.
    expect(cookRecipe).not.toHaveBeenCalled()
    // ...and the stale banner is dismissed rather than left dangling.
    await waitFor(() => expect(screen.queryByRole('button', { name: /finished cooking/i })).not.toBeInTheDocument())
  })

  it('checkpoint 2: a session that ends while the confirm sheet is already open blocks the deduction on tap', async () => {
    renderChat()

    const finishBtn = await screen.findByRole('button', { name: /finished cooking/i })
    fireEvent.click(finishBtn)

    // Confirm sheet is open and has loaded its proposal.
    const confirmBtn = await screen.findByRole('button', { name: /yes, i cooked this/i })
    expect(cookRecipe).toHaveBeenCalledWith('r1')

    // Another tab finishes the exact same cook while this sheet sits open.
    endCookSession('r1')

    fireEvent.click(confirmBtn)

    // The network deduction must never fire a second time.
    expect(confirmCook).not.toHaveBeenCalled()
  })

  it('control: confirming normally (no other tab involved) does deduct', async () => {
    renderChat()

    const finishBtn = await screen.findByRole('button', { name: /finished cooking/i })
    fireEvent.click(finishBtn)

    const confirmBtn = await screen.findByRole('button', { name: /yes, i cooked this/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(confirmCook).toHaveBeenCalledTimes(1))
  })
})
