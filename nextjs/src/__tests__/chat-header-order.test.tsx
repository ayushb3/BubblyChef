/**
 * Issue #906 — through the real ChatPage: the header controls read, left to
 * right, New Chat, then the notification bell, then the profile icon.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ChatMessage } from '@/types/chat'
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

const messages: ChatMessage[] = [
  { id: 'user-1', role: 'user', content: 'hello', timestamp: new Date() },
  { id: 'assistant-1', role: 'assistant', content: 'hi there', timestamp: new Date() },
]

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages,
    isStreaming: false,
    isResuming: false,
    proposalStates: {},
    proposalErrors: {},
    sendMessage: jest.fn(),
    sendChipMessage: jest.fn(),
    sendConfirmChoice: jest.fn(),
    cancelStream: jest.fn(),
    startNewChat: jest.fn(),
    dismissFailedSend: jest.fn(),
    retryFailedSend: jest.fn(),
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
  fetchRecipeCookMeta: jest.fn(async () => []),
}))
jest.mock('@/lib/api/meals', () => ({ createMeal: jest.fn(), updateMeal: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatPage = require('@/app/chat/page').default as () => React.JSX.Element

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
  window.localStorage.clear()
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
})

describe('chat header order (issue #906)', () => {
  it('lays out New Chat, then the bell, then the profile icon', async () => {
    render(
      <ThemeProvider>
        <ChatPage />
      </ThemeProvider>,
      { wrapper: QueryWrapper },
    )

    const newChat = await screen.findByRole('button', { name: /^New Chat$/i })
    const bell = screen.getByTestId('notification-bell')
    const profile = screen.getByRole('link', { name: 'Profile' })

    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(newChat, bell)).toBe(true)
    expect(follows(bell, profile)).toBe(true)
  })
})
