/**
 * Issue #746 (Goal 3, signature #5): chat bubbles and the shared chat-card header.
 *
 * Behaviour, not markup: the two bubbles are distinguishable and legible (ink
 * text on both, never white), a streaming reply shows a caret only while it is
 * streaming, the typing indicator announces itself, an AI-error reply is drawn
 * as an error, and the four structured cards all render the one shared header.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'
import TypingIndicator from '@/components/chat/TypingIndicator'
import ChatCardHeader from '@/components/chat/ChatCardHeader'
import PantryProposalCard from '@/components/chat/PantryProposalCard'
import ClarificationCard from '@/components/chat/ClarificationCard'
import CookingAmendmentCard from '@/components/chat/CookingAmendmentCard'
import CookingContextCard from '@/components/chat/CookingContextCard'
import PostMessageChips from '@/components/chat/PostMessageChips'
import type { ChatMessage, ChatResponse } from '@/types/chat'

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

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
})

function msg(role: 'user' | 'assistant', content: string, metadata?: Record<string, unknown>): ChatMessage {
  return {
    id: `${role}-1`,
    role,
    content,
    timestamp: new Date(),
    ...(metadata
      ? {
          response: {
            intent: 'general_chat',
            assistant_message: content,
            proposal: null,
            next_action: 'none',
            metadata,
          } as unknown as ChatResponse,
        }
      : {}),
  }
}

describe('MessageBubble', () => {
  it('draws the user bubble on the primary fill with ink text, never white', () => {
    render(<MessageBubble message={msg('user', 'Dinner for two, something cozy')} />)
    const bubble = screen.getByText('Dinner for two, something cozy').closest('[data-bubble]')
    expect(bubble).toHaveAttribute('data-bubble', 'user')
    expect(bubble?.className).not.toMatch(/text-white/)
    expect(bubble?.className).toMatch(/--color-primary/)
    expect(bubble?.className).toMatch(/border-\[color:var\(--color-text\)\]/)
  })

  it("draws Bubbles' bubble with an accent edge, distinct from the user's", () => {
    render(<MessageBubble message={msg('assistant', 'Three options coming up.')} />)
    const bubble = screen.getByText('Three options coming up.').closest('[data-bubble]')
    expect(bubble).toHaveAttribute('data-bubble', 'assistant')
    expect(bubble?.className).toMatch(/border-\[color:var\(--color-accent\)\]/)
    expect(bubble?.className).not.toMatch(/--color-primary/)
  })

  it('shows a block caret only while the reply is streaming', () => {
    const { rerender } = render(<MessageBubble message={msg('assistant', 'Lemon pasta it is')} streaming />)
    expect(screen.getByTestId('stream-caret')).toHaveAttribute('aria-hidden', 'true')
    rerender(<MessageBubble message={msg('assistant', 'Lemon pasta it is')} />)
    expect(screen.queryByTestId('stream-caret')).not.toBeInTheDocument()
  })

  it('draws an AI-error reply as an error: dashed edge and a wobbly-face marker', () => {
    render(
      <MessageBubble
        message={msg('assistant', 'Bubbly is having trouble connecting.', { ai_error_kind: 'timeout' })}
      />,
    )
    const bubble = screen.getByText(/having trouble connecting/).closest('[data-bubble]')
    expect(bubble).toHaveAttribute('data-variant', 'error')
    expect(bubble?.className).toMatch(/border-dashed/)
    expect(screen.getByText('😵‍💫')).toHaveAttribute('aria-hidden', 'true')
  })

  it('a normal reply is not drawn as an error', () => {
    render(<MessageBubble message={msg('assistant', 'Hello', { follow_ups_pending: false })} />)
    expect(screen.getByText('Hello').closest('[data-bubble]')).not.toHaveAttribute('data-variant', 'error')
  })

  it('wraps a long unbroken word instead of overflowing', () => {
    render(<MessageBubble message={msg('user', 'x'.repeat(200))} />)
    const bubble = screen.getByText('x'.repeat(200)).closest('[data-bubble]')
    expect(bubble?.className).toMatch(/break-words|\[overflow-wrap:anywhere\]/)
  })
})

describe('TypingIndicator', () => {
  it('announces that Bubbly is typing, with three decorative pixel dots', () => {
    render(<TypingIndicator />)
    expect(screen.getByRole('status')).toHaveTextContent('Bubbly is typing')
    expect(screen.getAllByTestId('typing-dot')).toHaveLength(3)
  })
})

describe('the shared chat-card header', () => {
  it('renders emoji, optional eyebrow, title and a trailing slot', () => {
    render(
      <ChatCardHeader
        emoji="🧺"
        emojiLabel="basket"
        eyebrow="Cooking now"
        title="Pantry Update"
        trailing={<span>3 items</span>}
      />,
    )
    expect(screen.getByRole('img', { name: 'basket' })).toBeInTheDocument()
    expect(screen.getByText('Cooking now')).toBeInTheDocument()
    expect(screen.getByText('Pantry Update')).toBeInTheDocument()
    expect(screen.getByText('3 items')).toBeInTheDocument()
  })

  const noop = () => {}
  const cards: Array<[string, React.ReactElement, string]> = [
    [
      'PantryProposalCard',
      <PantryProposalCard
        key="p"
        state="pending"
        onApprove={noop}
        onReject={noop}
        proposal={{
          actions: [
            { action_type: 'add', confidence: 0.95, item: { name: 'eggs', quantity: 12, unit: 'each' } },
          ],
        }}
      />,
      'Pantry Update',
    ],
    [
      'ClarificationCard',
      <ClarificationCard key="c" terms={[{ term: 'veggies', suggestions: ['carrot'] }]} />,
      'What did you mean?',
    ],
    [
      'CookingAmendmentCard',
      <CookingAmendmentCard
        key="a"
        state="pending"
        actionable
        onApply={noop}
        onDismiss={noop}
        proposal={{
          proposal_type: 'recipe_amendment',
          is_amendment: true,
          amended_ingredients: [],
          change_summary: 'x',
          recipe_id: 'r1',
          recipe_title: 'Creamy pasta',
        }}
      />,
      'Creamy pasta, your way',
    ],
    [
      'CookingContextCard',
      <CookingContextCard key="k" title="Lemon pasta" ingredientCount={4} onDismiss={noop} />,
      'Lemon pasta',
    ],
  ]

  it.each(cards)('%s renders the one shared header inside a PixelPanel', (_name, element, title) => {
    const { container } = render(element)
    const header = container.querySelector('[data-chat-card-header]')
    expect(header).not.toBeNull()
    expect(header).toHaveTextContent(title)
    expect(header?.closest('[data-pixel-panel]')).not.toBeNull()
    // exactly one header per card: no card keeps its own emoji + title copy
    expect(container.querySelectorAll('[data-chat-card-header]')).toHaveLength(1)
  })
})

describe('suggestion pills', () => {
  it('are 44px keycap pills on one surface fill, with no edit affordance', () => {
    render(
      <PostMessageChips
        chips={[
          { label: 'Add a side salad', message: 'Add a side salad', tone: 'fresh', emoji: '🥗' },
          { label: 'Try again', message: 'hi', tone: 'accent', emoji: '🔄' },
        ]}
        onChipTap={() => {}}
      />,
    )
    const pills = screen.getAllByRole('button')
    expect(pills).toHaveLength(2)
    for (const pill of pills) {
      expect(pill.className).toMatch(/min-h-\[44px\]/)
      expect(pill.className).toMatch(/shadow-\[0_2px_0_var\(--color-text\)\]/)
      expect((pill as HTMLElement).style.background).toBe('var(--color-surface)')
    }
    expect(screen.queryByText('✎')).not.toBeInTheDocument()
  })
})
