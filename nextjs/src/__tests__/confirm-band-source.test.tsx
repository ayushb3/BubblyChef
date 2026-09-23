/**
 * #436 verify findings on the confirm band ("Tweak this recipe" / "Start fresh").
 *
 * 1. A tap posts the button label as the visible message, so the request that
 *    raised the band has to travel with it as `forced_intent_source` — without
 *    it, "hmm what about something with mushrooms" became a refine of the
 *    literal words "Tweak this recipe" and produced a chicken curry.
 * 2. The band's options are real buttons to assistive tech, not list items.
 */
import * as React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import ConfirmBand from '@/components/chat/ConfirmBand'
import { useChat } from '@/hooks/useChat'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// useChat reads useQueryClient() (#520, to invalidate the bubbles balance
// after a chat approval), so it needs a QueryClientProvider to render.
function QueryWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
import { streamChatMessage } from '@/lib/api/chat'

jest.mock('@/lib/api/chat', () => ({
  fetchChatHistory: jest.fn(),
  streamChatMessage: jest.fn(),
}))

const mockStream = streamChatMessage as jest.MockedFunction<typeof streamChatMessage>
type Envelope = Parameters<Parameters<typeof streamChatMessage>[2]>[0]

const CONFIRM_OPTIONS = [
  { label: 'Tweak this recipe', forced_intent: 'recipe_card' as const },
  { label: 'Start fresh', forced_intent: 'recipe_brainstorm' as const },
]

const bandEnvelope = {
  intent: 'recipe_brainstorm',
  assistant_message: 'Did you want to tweak this recipe or start fresh with new ideas?',
  proposal: null,
  requires_review: true,
  next_action: 'confirm_choice',
  metadata: { confirm_options: CONFIRM_OPTIONS },
} as unknown as Envelope

describe('confirm band carries the request that raised it', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    mockStream.mockResolvedValue(undefined)
  })

  it('stamps the triggering message on the band turn and sends it with the tap', async () => {
    mockStream.mockImplementationOnce(async (_req, _onToken, onDone) => {
      onDone(bandEnvelope)
    })
    const { result } = renderHook(() => useChat({ skipResume: true }), { wrapper: QueryWrapper })

    await act(async () => {
      result.current.sendMessage('hmm what about something with mushrooms')
    })
    const band = await waitFor(() => {
      const m = result.current.messages.find((msg) => msg.role === 'assistant')
      expect(m?.confirmSource).toBe('hmm what about something with mushrooms')
      return m!
    })

    await act(async () => {
      result.current.sendConfirmChoice('Tweak this recipe', 'recipe_card', band.confirmSource)
    })

    const req = mockStream.mock.calls[1][0]
    expect(req.message).toBe('Tweak this recipe')
    expect(req.forced_intent).toBe('recipe_card')
    expect(req.forced_intent_source).toBe('hmm what about something with mushrooms')
  })

  it('a turn that does not raise the band carries no confirm source', async () => {
    mockStream.mockImplementationOnce(async (_req, _onToken, onDone) => {
      onDone({ ...bandEnvelope, next_action: 'none', metadata: {} } as unknown as Envelope)
    })
    const { result } = renderHook(() => useChat({ skipResume: true }), { wrapper: QueryWrapper })

    await act(async () => {
      result.current.sendMessage('no cheese')
    })
    await waitFor(() =>
      expect(result.current.messages.find((m) => m.role === 'assistant')?.response).toBeTruthy(),
    )
    expect(result.current.messages.find((m) => m.role === 'assistant')?.confirmSource).toBeUndefined()
    expect(mockStream.mock.calls[0][0].forced_intent_source).toBeUndefined()
  })
})

describe('ConfirmBand accessibility', () => {
  it('exposes each option as a button', () => {
    render(<ConfirmBand options={CONFIRM_OPTIONS} onSelect={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Tweak this recipe' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
