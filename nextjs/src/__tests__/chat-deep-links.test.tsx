/**
 * Issues #143 / #138 — the chat page's deep-link seeds, driven end to end
 * through the real `ChatPage` component.
 *
 * What matters here and can't be checked by the type system:
 *  - the seeded question is *auto-sent* (the tap on the dashboard/pantry card is
 *    the single tap both #138 acceptance criteria budget for),
 *  - it fires exactly once, never again on re-render,
 *  - and a bare `/chat` stays a clean, empty conversation (#143's explicit
 *    "no context bleed" criterion).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'

// react-markdown / remark-gfm ship ESM only and jest runs this suite as CJS.
// Stubbing them keeps the transform out of the picture — this suite never
// asserts on rendered markdown.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

const replace = jest.fn()
let searchParams = new URLSearchParams('')

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => searchParams,
}))

const sendMessage = jest.fn()
const startNewChat = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: [],
    isStreaming: false,
    proposalStates: {},
    sendMessage,
    cancelStream: jest.fn(),
    startNewChat,
    approveProposal: jest.fn(),
    rejectProposal: jest.fn(),
  }),
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

const fetchRecipe = jest.fn()
jest.mock('@/lib/api/recipes', () => ({ fetchRecipe: (id: string) => fetchRecipe(id) }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatPage = require('@/app/chat/page').default as () => React.JSX.Element

/** The header's ThemePicker needs the real provider (see ThemePicker.test.tsx). */
function renderChat() {
  return render(
    <ThemeProvider>
      <ChatPage />
    </ThemeProvider>,
  )
}

/** Point the mocked `useSearchParams` at a query string, stable per render. */
function withParams(query: string) {
  searchParams = new URLSearchParams(query)
}

// jsdom ships neither of these, and the chat surface uses both.
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
  withParams('')
})

describe('bare /chat — no context bleed', () => {
  it('sends nothing and shows no context card', async () => {
    renderChat()

    await waitFor(() => expect(screen.getByText('Chat with Bubbles')).toBeInTheDocument())
    expect(sendMessage).not.toHaveBeenCalled()
    expect(screen.queryByText(/Today's tip/i)).toBeNull()
    expect(screen.queryByText(/Using your/i)).toBeNull()
  })

  it('ignores params that are not seeds', async () => {
    withParams('mode=recipe')
    renderChat()

    await waitFor(() => expect(screen.getByText('Chat with Bubbles')).toBeInTheDocument())
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('/chat?tip= — dashboard tip handoff (#143)', () => {
  const tip = 'Pasta water makes sauces silky.'

  it('auto-asks Bubbles to explain the tip, and shows it above the thread', async () => {
    withParams(new URLSearchParams({ tip }).toString())
    renderChat()

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(sendMessage).toHaveBeenCalledWith(
      `Tell me more about this kitchen tip: "${tip}" — why does it work, and when should I use it?`,
    )
    expect(screen.getByText("Today's tip")).toBeInTheDocument()
    expect(screen.getByText(tip)).toBeInTheDocument()
  })

  it('dismissing the card drops the param so a refresh does not re-fire it', async () => {
    withParams(new URLSearchParams({ tip }).toString())
    renderChat()

    await waitFor(() => expect(screen.getByText("Today's tip")).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /dismiss tip context/i }))

    await waitFor(() => expect(screen.queryByText("Today's tip")).toBeNull())
    expect(replace).toHaveBeenCalledWith('/chat', { scroll: false })
  })
})

describe('/chat?use= — expiring item handoff (#138)', () => {
  it('auto-sends the tuned "with my <name>" question, verbatim name', async () => {
    withParams(new URLSearchParams({ use: 'eggs', expires: '2026-07-29' }).toString())
    renderChat()

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(sendMessage).toHaveBeenCalledWith(
      'What can I make with my eggs before they go bad?',
    )
  })

  it('visibly reflects the ingredient and its expiry', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    withParams(new URLSearchParams({ use: 'eggs', expires: tomorrow }).toString())
    renderChat()

    await waitFor(() => expect(screen.getByText('Using your eggs')).toBeInTheDocument())
    expect(screen.getByText('expires tomorrow')).toBeInTheDocument()
  })

  it('fires exactly once across re-renders', async () => {
    withParams(new URLSearchParams({ use: 'spinach' }).toString())
    const { rerender } = renderChat()

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    const tree = (
      <ThemeProvider>
        <ChatPage />
      </ThemeProvider>
    )
    rerender(tree)
    rerender(tree)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('cook handoff still wins', () => {
  it('does not auto-send when ?cooking= is present', async () => {
    fetchRecipe.mockResolvedValue({ id: 'r1', title: 'Carbonara', ingredients: [] })
    withParams('cooking=r1&use=eggs')
    renderChat()

    await waitFor(() => expect(fetchRecipe).toHaveBeenCalledWith('r1'))
    expect(sendMessage).not.toHaveBeenCalled()
    expect(screen.queryByText('Using your eggs')).toBeNull()
  })
})
