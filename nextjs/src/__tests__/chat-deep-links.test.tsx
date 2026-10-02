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
import React, { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/ThemeProvider'
import { addDaysToDateString, localDateString } from '@/lib/date'

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

const useChatOptions = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: (options?: unknown) => {
    useChatOptions(options)
    return {
      messages: [],
      isStreaming: false,
      proposalStates: {},
      sendMessage,
      cancelStream: jest.fn(),
      startNewChat,
      approveProposal: jest.fn(),
      rejectProposal: jest.fn(),
    }
  },
}))

jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: true, providers: [] })),
}))

const fetchRecipe = jest.fn()
jest.mock('@/lib/api/recipes', () => ({ fetchRecipe: (id: string) => fetchRecipe(id) }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatPage = require('@/app/chat/page').default as () => React.JSX.Element

/**
 * The header's ThemePicker needs the real provider (see ThemePicker.test.tsx).
 * ChatSurface reads useQueryClient() (#520, to invalidate the bubbles balance
 * after a chat recipe save), so it also needs a QueryClientProvider.
 */
function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ChatPage />
      </ThemeProvider>
    </QueryClientProvider>,
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

    await waitFor(() => expect(screen.getByText('Chat with Bubbly')).toBeInTheDocument())
    expect(sendMessage).not.toHaveBeenCalled()
    expect(screen.queryByText(/Today's tip/i)).toBeNull()
    expect(screen.queryByText(/Using your/i)).toBeNull()
  })

  it('ignores params that are not seeds', async () => {
    withParams('mode=recipe')
    renderChat()

    await waitFor(() => expect(screen.getByText('Chat with Bubbly')).toBeInTheDocument())
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
    // Built from the client's own local calendar date, not `toISOString`
    // (UTC) — see `expiryPhrase`'s `parseLocalDate` comment and issue #438.
    // A UTC-sliced "tomorrow" can land on the wrong local calendar day
    // depending on timezone and time of day, which is exactly what made
    // this test flaky.
    const tomorrow = addDaysToDateString(localDateString(), 1)
    withParams(new URLSearchParams({ use: 'eggs', expires: tomorrow }).toString())
    renderChat()

    await waitFor(() => expect(screen.getByText('Using your eggs')).toBeInTheDocument())
    expect(screen.getByText('expires tomorrow')).toBeInTheDocument()
  })

  it('fires exactly once across re-renders', async () => {
    withParams(new URLSearchParams({ use: 'spinach' }).toString())
    const { rerender } = renderChat()

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ChatPage />
        </ThemeProvider>
      </QueryClientProvider>
    )
    rerender(tree)
    rerender(tree)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('/chat?plan=dinner — home screen handoff (#651)', () => {
  it('auto-sends "Plan dinner for tonight" exactly once under a StrictMode double mount, with no context; the context card shows and there is no starter row', async () => {
    withParams('plan=dinner')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <ChatPage />
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    )

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(sendMessage).toHaveBeenCalledWith('Plan dinner for tonight')
    expect(screen.getByText('Planning dinner')).toBeInTheDocument()
    // No starter row under a seed — none of the always-present fallback pills
    // render. Queried by role: RotatingPlaceholder's input placeholder text
    // ("What can I make for dinner?") is a <span>, not a button, so this is
    // unambiguous against it.
    expect(screen.queryByRole('button', { name: /what can i make/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /quick weeknight dinner/i })).toBeNull()
  })

  it('dismissing the card drops the param so a refresh does not re-fire it', async () => {
    withParams('plan=dinner')
    renderChat()

    await waitFor(() => expect(screen.getByText('Planning dinner')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /dismiss dinner planning context/i }))

    await waitFor(() => expect(screen.queryByText('Planning dinner')).toBeNull())
    expect(replace).toHaveBeenCalledWith('/chat', { scroll: false })
  })
})

describe('/chat?suggest=1 — cook nudge handoff (#905)', () => {
  it('auto-sends the suggestion request exactly once under a StrictMode double mount, starts fresh (no resume), and shows the context card', async () => {
    withParams('suggest=1')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <ChatPage />
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    )

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(sendMessage).toHaveBeenCalledWith(
      "I haven't cooked in a while. What should I make today?",
    )
    expect(useChatOptions).toHaveBeenCalledWith(expect.objectContaining({ skipResume: true }))
    expect(screen.getByRole('button', { name: /dismiss .*context/i })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('/chat?ask= — Home "What\'s for dinner?" input (#854)', () => {
  it('sends the typed text as the first message exactly once under a StrictMode double mount', async () => {
    withParams(new URLSearchParams({ ask: 'something with eggs & rice' }).toString())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <ChatPage />
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    )

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(sendMessage).toHaveBeenCalledWith('something with eggs & rice')
    // Settle: a late second effect pass must not add a second send.
    await new Promise((r) => setTimeout(r, 50))
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('a consumed seed is stripped from the URL (#854)', () => {
  /** The address bar after `history.replaceState(…, '/chat')`: a bare `/chat`. */
  let replaceState: jest.SpyInstance
  function urlFollowsReplace() {
    replaceState = jest.spyOn(window.history, 'replaceState').mockImplementation(() => {
      searchParams = new URLSearchParams('')
    })
  }
  afterEach(() => replaceState?.mockRestore())

  it.each([
    ['ask', 'ask=something+with+eggs'],
    ['plan', 'plan=dinner&with=eggs|rice'],
    ['suggest', 'suggest=1'],
    ['tip', 'tip=salt+early'],
    ['use', 'use=eggs&expires=2099-01-01'],
    ['meal', 'meal=0b6e2f1a-1111-4222-8333-444455556666&title=Lemon+pasta'],
  ])('%s: sends once, drops its params, and a remount after that sends nothing', async (_kind, query) => {
    urlFollowsReplace()
    withParams(query)
    const first = renderChat()

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/chat')

    // A refresh: a fresh mount at the stripped URL.
    first.unmount()
    renderChat()
    await waitFor(() => expect(screen.getByText('Chat with Bubbly')).toBeInTheDocument())
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps the context card after the params are gone, until it is dismissed', async () => {
    urlFollowsReplace()
    withParams('plan=dinner')
    const { rerender } = renderChat()
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    // The router's replace re-renders the page at the bare URL.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider>
          <ChatPage />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Planning dinner')).toBeInTheDocument()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('/chat?new=1 — Home input, submitted empty (#854)', () => {
  it('drops the param, so a refresh resumes the conversation again', async () => {
    const replaceState = jest.spyOn(window.history, 'replaceState').mockImplementation(() => {
      searchParams = new URLSearchParams('')
    })
    withParams('new=1')
    const first = renderChat()
    await waitFor(() => expect(replaceState).toHaveBeenCalledWith(window.history.state, '', '/chat'))
    expect(useChatOptions).toHaveBeenLastCalledWith(expect.objectContaining({ skipResume: true }))

    first.unmount()
    useChatOptions.mockClear()
    renderChat()
    expect(useChatOptions).toHaveBeenCalledWith(expect.objectContaining({ skipResume: false }))
    replaceState.mockRestore()
  })

  it('starts a fresh conversation (no resume) and sends nothing', async () => {
    withParams('new=1')
    renderChat()

    await waitFor(() => expect(screen.getByText('Chat with Bubbly')).toBeInTheDocument())
    expect(sendMessage).not.toHaveBeenCalled()
    expect(useChatOptions).toHaveBeenCalledWith(expect.objectContaining({ skipResume: true }))
    // The starter chips are the empty state's affordance.
    expect(screen.queryByText(/Using your|Planning dinner/)).toBeNull()
  })

  it('a bare /chat still resumes', async () => {
    renderChat()
    await waitFor(() => expect(screen.getByText('Chat with Bubbly')).toBeInTheDocument())
    expect(useChatOptions).toHaveBeenCalledWith(expect.objectContaining({ skipResume: false }))
  })
})

describe('/chat?meal= — recipe page make-it-a-meal handoff (#651 PR B)', () => {
  const ID = '0b6e2f1a-1111-4222-8333-444455556666'

  it('auto-sends once under a StrictMode double mount, with the fixed-main context; the card shows', async () => {
    withParams(new URLSearchParams({ meal: ID, title: 'Lemon pasta' }).toString())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <ChatPage />
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    )

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
    expect(sendMessage).toHaveBeenCalledWith('Make Lemon pasta into a meal', {
      meal_fixed_main: { recipe_id: ID },
    })
    expect(screen.getByText('Making it a meal')).toBeInTheDocument()
    expect(screen.getByText('Lemon pasta')).toBeInTheDocument()
    expect(fetchRecipe).not.toHaveBeenCalled()
  })

  it('a non-UUID meal param sends nothing', async () => {
    withParams('meal=nope')
    renderChat()

    await waitFor(() => expect(screen.getByText('Chat with Bubbly')).toBeInTheDocument())
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('dismissing the card drops the param', async () => {
    withParams(new URLSearchParams({ meal: ID, title: 'Lemon pasta' }).toString())
    renderChat()

    await waitFor(() => expect(screen.getByText('Making it a meal')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /dismiss make-it-a-meal context/i }))

    await waitFor(() => expect(screen.queryByText('Making it a meal')).toBeNull())
    expect(replace).toHaveBeenCalledWith('/chat', { scroll: false })
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
