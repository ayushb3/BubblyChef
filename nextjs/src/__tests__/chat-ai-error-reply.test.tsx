/**
 * Issue #732 — when the AI is down, chat says so in user terms and offers only
 * a retry that can work.
 *
 *  - the unavailable banner speaks to users, not developers;
 *  - a reply the backend flagged `metadata.ai_error_kind` gets no normal
 *    follow-up pills ("Try another" / "Tell me more" just fail the same way);
 *  - a transient failure gets one "Try again" pill that resends the last
 *    message; quota / auth / model / not-configured get none, since retrying
 *    can't help.
 *
 * Mirrors the mocking style of `chat-pills-page.test.tsx`.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import type { ChatMessage, ChatResponse } from '@/types/chat'
import { getAiErrorKind } from '@/types/chat'
import { resolveAiErrorChips } from '@/lib/chat-chips'
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

let currentMessages: ChatMessage[] = []
const sendMessage = jest.fn()
const sendChipMessage = jest.fn()

jest.mock('@/hooks/useChat', () => ({
  useChat: () => ({
    messages: currentMessages,
    isStreaming: false,
    isResuming: false,
    proposalStates: {},
    proposalErrors: {},
    sendMessage,
    sendChipMessage,
    sendConfirmChoice: jest.fn(),
    cancelStream: jest.fn(),
    startNewChat: jest.fn(),
    approveProposal: jest.fn(),
    rejectProposal: jest.fn(),
    updateProposalActions: jest.fn(),
  }),
}))

let aiAvailable = true
jest.mock('@/lib/api/chat', () => ({
  checkAIHealth: jest.fn(async () => ({ ai_available: aiAvailable, providers: [] })),
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

const FAILURE_TEXT = "Bubbly's AI is having trouble connecting, try again in a moment."

function replyWith(metadata: Record<string, unknown>): ChatMessage {
  const response = {
    intent: 'general_chat',
    assistant_message: FAILURE_TEXT,
    proposal: null,
    next_action: 'none',
    metadata: { follow_ups_pending: false, ...metadata },
  } as unknown as ChatResponse
  return {
    id: 'a1',
    role: 'assistant',
    content: FAILURE_TEXT,
    intent: 'general_chat',
    response,
    timestamp: new Date(),
  }
}

function conversation(assistant: ChatMessage): ChatMessage[] {
  return [
    { id: 'u1', role: 'user', content: 'What can I cook tonight?', timestamp: new Date() },
    assistant,
  ]
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
  currentMessages = []
  aiAvailable = true
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response)
})

describe('resolveAiErrorChips', () => {
  it.each(['timeout', 'network', 'rate_limited', 'overloaded', 'bad_request', 'unknown'])(
    '%s offers a single Try again that resends the last message',
    (kind) => {
      const chips = resolveAiErrorChips(kind, 'What can I cook tonight?')
      expect(chips).toHaveLength(1)
      expect(chips[0].label).toBe('Try again')
      expect(chips[0].message).toBe('What can I cook tonight?')
    },
  )

  it.each(['quota_exhausted', 'auth', 'model_not_found', 'not_configured'])(
    '%s offers no pill, since retrying cannot help',
    (kind) => {
      expect(resolveAiErrorChips(kind, 'What can I cook tonight?')).toEqual([])
    },
  )

  it('offers nothing when there is no message to resend', () => {
    expect(resolveAiErrorChips('timeout', undefined)).toEqual([])
    expect(resolveAiErrorChips('timeout', '   ')).toEqual([])
  })
})

describe('getAiErrorKind', () => {
  it('reads metadata.ai_error_kind and ignores anything else', () => {
    expect(getAiErrorKind(replyWith({ ai_error_kind: 'quota_exhausted' }).response)).toBe(
      'quota_exhausted',
    )
    expect(getAiErrorKind(replyWith({}).response)).toBeNull()
    expect(getAiErrorKind(replyWith({ ai_error_kind: 7 }).response)).toBeNull()
    expect(getAiErrorKind(undefined)).toBeNull()
  })
})

describe('the unavailable banner', () => {
  it('speaks to users and no longer tells them to check a key or start Ollama', async () => {
    aiAvailable = false
    renderChat()

    expect(
      await screen.findByText(
        'Bubbly is taking a break — chat will be back soon. Your pantry and recipes still work.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Gemini|Ollama|API key/i)).not.toBeInTheDocument()
  })
})

describe('an AI-error reply under the chat', () => {
  it('timeout: shows one Try again pill and none of the normal follow-ups', async () => {
    currentMessages = conversation(replyWith({ ai_error_kind: 'timeout' }))
    renderChat()

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try another' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tell me more' })).not.toBeInTheDocument()
    // The only button that can carry a pill's label is the one pill itself, and
    // no per-pill edit button rides alongside it.
    expect(screen.queryByRole('button', { name: /Edit .* before sending/ })).not.toBeInTheDocument()
  })

  it('Try again resends the last user message', async () => {
    currentMessages = conversation(replyWith({ ai_error_kind: 'network' }))
    renderChat()

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(sendChipMessage).toHaveBeenCalledTimes(1))
    expect(sendChipMessage).toHaveBeenCalledWith('What can I cook tonight?')
  })

  it('quota_exhausted: shows no pill at all', async () => {
    currentMessages = conversation(replyWith({ ai_error_kind: 'quota_exhausted' }))
    renderChat()

    expect(await screen.findByText(FAILURE_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try another' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tell me more' })).not.toBeInTheDocument()
  })

  it('a normal reply still gets its usual pills', async () => {
    currentMessages = conversation(replyWith({}))
    renderChat()

    expect(await screen.findByRole('button', { name: 'Try another' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
