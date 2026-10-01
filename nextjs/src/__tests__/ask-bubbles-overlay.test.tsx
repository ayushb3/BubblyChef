/**
 * Component tests for `AskBubblesOverlay` (issue #654 PR B, §4/§6 ui-ux of
 * `docs/plans/2026-09-29-issue-654-b-meal-amendments-contract.md`).
 *
 * Covers the pinned mode added in this PR:
 *  - a stable `conversation_id` across turns, reading the latest
 *    `pinned.ingredients` prop at send time;
 *  - the "Asking about ‹title›" header;
 *  - the amendment card (Use this change / Keep original) for a matching
 *    `recipe_id`;
 *  - only the latest card stays actionable;
 *  - a mismatched `recipe_id` renders no card;
 *  - the unpinned request stays byte-identical to before this PR.
 *
 * `guided-cook-flow.test.tsx` covers the unpinned mode's own regression
 * suite (valid mode, framed message, null conversation_id, no follow-up
 * chips) against the same extracted component and is left unmodified.
 */

import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ChatResponse } from '@/types/chat'

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: jest.fn(),
}))

// Only `useReducedMotion` is faked (issue #672's scroll behaviour); the rest of
// framer-motion stays real.
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: jest.fn(() => false),
}))

import { useReducedMotion } from 'framer-motion'
import AskBubblesOverlay, { type AskBubblesPin } from '@/components/cook/AskBubblesOverlay'
import { streamChatMessage } from '@/lib/api/chat'

const streamChatMessageMock = streamChatMessage as jest.Mock
const useReducedMotionMock = useReducedMotion as jest.Mock

beforeEach(() => {
  streamChatMessageMock.mockReset()
  useReducedMotionMock.mockReturnValue(false)
})

function baseResponse(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    request_id: 'req-1',
    workflow_id: 'wf-1',
    conversation_id: 'conv-1',
    intent: 'cooking_help',
    assistant_message: 'Sure!',
    proposal: null,
    confidence: { overall: 0.9 },
    requires_review: false,
    next_action: 'none',
    ...overrides,
  }
}

const AMENDMENT_PROPOSAL = {
  proposal_type: 'recipe_amendment' as const,
  is_amendment: true,
  amended_ingredients: [
    { name: 'greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null },
  ],
  change_summary: 'Swapped the cream for Greek yoghurt.',
  recipe_id: 'dish-1',
  recipe_title: 'Creamy pasta',
}

/** Queues the next `streamChatMessage` call to resolve immediately via `onDone`. */
function queueResponse(response: ChatResponse) {
  streamChatMessageMock.mockImplementationOnce(async (_req, _onToken, onDone) => {
    onDone(response)
  })
}

function sendMessage(text: string) {
  const input = screen.getByPlaceholderText(/ask about this step/i)
  fireEvent.change(input, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: /send question/i }))
}

const PIN: AskBubblesPin = {
  recipe_id: 'dish-1',
  title: 'Creamy pasta',
  ingredients: ['200 g pasta', { name: 'cream', quantity: 150, unit: 'ml' }],
}

describe('AskBubblesOverlay — pinned mode', () => {
  it('sends context.cooking_recipe and a stable conversation_id across turns, reading the latest ingredients prop', async () => {
    queueResponse(baseResponse())
    const { rerender } = render(
      <AskBubblesOverlay stepN={3} stepText='Stir in the cream' recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )

    sendMessage('can I use yoghurt instead of cream?')
    expect(streamChatMessageMock).toHaveBeenCalledTimes(1)
    const firstRequest = streamChatMessageMock.mock.calls[0][0]
    expect(firstRequest.context).toEqual({
      cooking_recipe: { id: 'dish-1', title: 'Creamy pasta', ingredients: PIN.ingredients },
    })
    expect(typeof firstRequest.conversation_id).toBe('string')
    const conversationId = firstRequest.conversation_id

    // Simulate the parent re-deriving `pinned.ingredients` after an amendment.
    const updatedPin: AskBubblesPin = {
      ...PIN,
      ingredients: [{ name: 'greek yoghurt', quantity: 150, unit: 'ml' }],
    }
    rerender(
      <AskBubblesOverlay stepN={3} stepText='Stir in the cream' recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={updatedPin} />,
    )

    queueResponse(baseResponse())
    sendMessage('what about a second change?')
    expect(streamChatMessageMock).toHaveBeenCalledTimes(2)
    const secondRequest = streamChatMessageMock.mock.calls[1][0]
    expect(secondRequest.conversation_id).toBe(conversationId)
    expect(secondRequest.context.cooking_recipe.ingredients).toEqual(updatedPin.ingredients)
  })

  it('the header reads "Asking about ‹title›"', () => {
    render(
      <AskBubblesOverlay stepN={1} stepText="text" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    expect(screen.getByText('Asking about Creamy pasta')).toBeInTheDocument()
  })

  it('renders an amendment card for a matching recipe_id; Use this change calls onApplyAmendment, Keep original does not', () => {
    const onApplyAmendment = jest.fn()
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(
      <AskBubblesOverlay
        stepN={3}
        stepText="Stir in the cream"
        recipeTitle="Creamy pasta"
        onClose={jest.fn()}
        pinned={PIN}
        onApplyAmendment={onApplyAmendment}
      />,
    )
    sendMessage('can I use yoghurt instead of cream?')

    expect(screen.getByTestId('ask-bubbles-amendment-card')).toBeInTheDocument()
    expect(screen.getByText('Swapped the cream for Greek yoghurt.')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ask-bubbles-amendment-use'))
    expect(onApplyAmendment).toHaveBeenCalledTimes(1)
    expect(onApplyAmendment).toHaveBeenCalledWith({
      recipe_id: 'dish-1',
      ingredients: [{ name: 'greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null }],
      change_summary: 'Swapped the cream for Greek yoghurt.',
    })
    expect(screen.getByTestId('ask-bubbles-amendment-resolved')).toHaveTextContent(
      'Updated Creamy pasta. Your pantry update will use this.',
    )
  })

  it('Keep original resolves the card without calling onApplyAmendment', () => {
    const onApplyAmendment = jest.fn()
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(
      <AskBubblesOverlay
        stepN={3}
        stepText="Stir in the cream"
        recipeTitle="Creamy pasta"
        onClose={jest.fn()}
        pinned={PIN}
        onApplyAmendment={onApplyAmendment}
      />,
    )
    sendMessage('can I use yoghurt instead of cream?')

    fireEvent.click(screen.getByTestId('ask-bubbles-amendment-keep'))
    expect(onApplyAmendment).not.toHaveBeenCalled()
    expect(screen.getByTestId('ask-bubbles-amendment-resolved')).toHaveTextContent('Kept the original ingredients.')
  })

  it('only the latest amendment card is actionable', () => {
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(
      <AskBubblesOverlay stepN={3} stepText="Stir in the cream" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    sendMessage('can I use yoghurt instead of cream?')
    expect(screen.getAllByTestId('ask-bubbles-amendment-card')).toHaveLength(1)

    const secondProposal = { ...AMENDMENT_PROPOSAL, change_summary: 'Halved the pasta.' }
    queueResponse(baseResponse({ proposal: secondProposal, requires_review: true, next_action: 'review_proposal' }))
    sendMessage('and can I use less pasta?')

    // Only one actionable card (the latest) — the older one's buttons are gone.
    expect(screen.getAllByTestId('ask-bubbles-amendment-use')).toHaveLength(1)
    expect(screen.getAllByTestId('ask-bubbles-amendment-keep')).toHaveLength(1)
    // The older card's prompt text is still present, just with no buttons.
    expect(screen.getByText('Swapped the cream for Greek yoghurt.')).toBeInTheDocument()
    expect(screen.getByText('Halved the pasta.')).toBeInTheDocument()
  })

  it('drops amended lines with a blank name, and keeps the rest usable', () => {
    const onApplyAmendment = jest.fn()
    queueResponse(
      baseResponse({
        proposal: {
          ...AMENDMENT_PROPOSAL,
          amended_ingredients: [
            { name: '  ', quantity: 1, unit: 'item', optional: false, notes: null },
            { name: 'greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null },
          ],
        },
        requires_review: true,
        next_action: 'review_proposal',
      }),
    )
    render(
      <AskBubblesOverlay
        stepN={3}
        stepText="Stir in the cream"
        recipeTitle="Creamy pasta"
        onClose={jest.fn()}
        pinned={PIN}
        onApplyAmendment={onApplyAmendment}
      />,
    )
    sendMessage('can I use yoghurt instead of cream?')

    expect(screen.getByTestId('ask-bubbles-amendment-card')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ask-bubbles-amendment-use'))
    expect(onApplyAmendment).toHaveBeenCalledWith({
      recipe_id: 'dish-1',
      ingredients: [{ name: 'greek yoghurt', quantity: 150, unit: 'ml', optional: false, notes: null }],
      change_summary: 'Swapped the cream for Greek yoghurt.',
    })
  })

  it('renders no card at all when every amended line has a blank name', () => {
    queueResponse(
      baseResponse({
        proposal: {
          ...AMENDMENT_PROPOSAL,
          amended_ingredients: [{ name: '   ', quantity: 1, unit: 'item', optional: false, notes: null }],
        },
        requires_review: true,
        next_action: 'review_proposal',
      }),
    )
    render(
      <AskBubblesOverlay stepN={3} stepText="Stir in the cream" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    sendMessage('can I use yoghurt instead of cream?')

    expect(screen.queryByTestId('ask-bubbles-amendment-card')).not.toBeInTheDocument()
  })

  it('disables the amendment card buttons while a later question is streaming', () => {
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(
      <AskBubblesOverlay stepN={3} stepText="Stir in the cream" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    sendMessage('can I use yoghurt instead of cream?')
    expect(screen.getByTestId('ask-bubbles-amendment-use')).not.toBeDisabled()

    // A second question that never resolves — still streaming.
    streamChatMessageMock.mockImplementationOnce(() => new Promise(() => {}))
    sendMessage('and what about the pasta amount?')

    expect(screen.getByTestId('ask-bubbles-amendment-use')).toBeDisabled()
    expect(screen.getByTestId('ask-bubbles-amendment-keep')).toBeDisabled()
  })

  it('moves focus onto the resolved card, never dropping to body', () => {
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(
      <AskBubblesOverlay stepN={3} stepText="Stir in the cream" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    sendMessage('can I use yoghurt instead of cream?')

    fireEvent.click(screen.getByTestId('ask-bubbles-amendment-use'))
    expect(document.activeElement).toBe(screen.getByTestId('ask-bubbles-amendment-resolved'))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('the amendment card is announced via role="status"', () => {
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(
      <AskBubblesOverlay stepN={3} stepText="Stir in the cream" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    sendMessage('can I use yoghurt instead of cream?')
    expect(screen.getByTestId('ask-bubbles-amendment-card')).toHaveAttribute('role', 'status')
  })

  it('renders no card for a proposal whose recipe_id does not match the pin', () => {
    queueResponse(
      baseResponse({
        proposal: { ...AMENDMENT_PROPOSAL, recipe_id: 'some-other-dish' },
        requires_review: true,
        next_action: 'review_proposal',
      }),
    )
    render(
      <AskBubblesOverlay stepN={3} stepText="Stir in the cream" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    sendMessage('can I use yoghurt instead of cream?')

    expect(screen.queryByTestId('ask-bubbles-amendment-card')).not.toBeInTheDocument()
  })
})

// Issue #672: a new turn scrolls the thread (only the thread) to the bottom.
describe('AskBubblesOverlay — scrolls a new turn into view', () => {
  interface ScrollCall {
    target: HTMLElement
    options: ScrollToOptions
    useThisChangeInDom: boolean
  }
  let calls: ScrollCall[]
  let original: PropertyDescriptor | undefined

  beforeEach(() => {
    calls = []
    original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: jest.fn(function (this: HTMLElement, options: ScrollToOptions) {
        calls.push({
          target: this,
          options,
          // Recorded at call time: the card must already be mounted, or the
          // scroll would land short of its buttons.
          useThisChangeInDom: screen.queryByText('Use this change') !== null,
        })
      }),
    })
  })

  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollTo', original)
    else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
  })

  function renderPinned() {
    render(
      <AskBubblesOverlay stepN={3} stepText="Stir in the cream" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
  }

  it('the last scrollTo is on the thread, smooth, with the amendment card already in the DOM', () => {
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    renderPinned()
    sendMessage('can I use yoghurt instead of cream?')

    expect(screen.getByText('Use this change')).toBeInTheDocument()
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1]
    expect(last.target).toBe(screen.getByTestId('ask-bubbles-thread'))
    expect(last.options.behavior).toBe('smooth')
    expect(last.useThisChangeInDom).toBe(true)
  })

  it('uses behavior "auto" when the user prefers reduced motion', () => {
    useReducedMotionMock.mockReturnValue(true)
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    renderPinned()
    sendMessage('can I use yoghurt instead of cream?')

    const last = calls[calls.length - 1]
    expect(last.target).toBe(screen.getByTestId('ask-bubbles-thread'))
    expect(last.options.behavior).toBe('auto')
  })

  it('does not scroll while streamed tokens arrive', () => {
    let emitToken: (t: string) => void = () => {}
    streamChatMessageMock.mockImplementationOnce(async (_req, onToken) => {
      emitToken = onToken
      await new Promise(() => {})
    })
    renderPinned()
    sendMessage('why al dente?')
    const before = calls.length
    act(() => emitToken('Because '))
    act(() => emitToken('it holds its bite.'))
    expect(screen.getByText('Because it holds its bite.')).toBeInTheDocument()
    expect(calls.length).toBe(before)
  })
})

describe('AskBubblesOverlay — single-recipe cook context (#814)', () => {
  it('cookContext + conversationId send the dish and the given id, with no amendment card', () => {
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(
      <AskBubblesOverlay
        stepN={1}
        stepText="Boil the pasta"
        recipeTitle="Creamy pasta"
        onClose={jest.fn()}
        cookContext={PIN}
        conversationId="cook-session-1"
      />,
    )
    sendMessage('why al dente?')

    const request = streamChatMessageMock.mock.calls[0][0]
    expect(request.conversation_id).toBe('cook-session-1')
    expect(request.context).toEqual({
      cooking_recipe: { id: 'dish-1', title: 'Creamy pasta', ingredients: PIN.ingredients },
    })
    expect(request.follow_up_chips).toBe(false)
    expect(screen.getByText('Asking about step 1')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-bubbles-amendment-card')).not.toBeInTheDocument()
  })
})

describe('AskBubblesOverlay — meal constraints (#814)', () => {
  const CONSTRAINTS = {
    kitchen_limits: ['one pan'],
    exclusive_tags: ['pan'],
    recipe_constraints: { dietary: ['dairy-free'], excluded_ingredients: ['peanuts'] },
  }

  it('sends the meal constraints as context.meal_constraints on every turn, next to the pin', () => {
    queueResponse(baseResponse())
    render(
      <AskBubblesOverlay
        stepN={1}
        stepText="text"
        recipeTitle="Creamy pasta"
        onClose={jest.fn()}
        pinned={PIN}
        mealConstraints={CONSTRAINTS}
      />,
    )
    sendMessage('can I use butter?')
    queueResponse(baseResponse())
    sendMessage('and cheese?')

    for (const [request] of streamChatMessageMock.mock.calls) {
      expect(request.context).toEqual({
        cooking_recipe: { id: 'dish-1', title: 'Creamy pasta', ingredients: PIN.ingredients },
        meal_constraints: CONSTRAINTS,
      })
    }
  })

  it('omits meal_constraints when none are given (a saved-recipe cook, or a meal planned without chat)', () => {
    queueResponse(baseResponse())
    render(
      <AskBubblesOverlay stepN={1} stepText="text" recipeTitle="Creamy pasta" onClose={jest.fn()} pinned={PIN} />,
    )
    sendMessage('can I use butter?')
    expect('meal_constraints' in streamChatMessageMock.mock.calls[0][0].context).toBe(false)
  })
})

describe('AskBubblesOverlay — unpinned mode (unchanged)', () => {
  it('never mints a conversation id when unpinned', () => {
    const spy = jest.spyOn(crypto, 'randomUUID')
    queueResponse(baseResponse())
    render(<AskBubblesOverlay stepN={1} stepText="Boil the pasta" recipeTitle="Creamy pasta" onClose={jest.fn()} />)
    sendMessage('why al dente?')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('sends conversation_id: null, no context, and follow_up_chips: false — no card ever renders', () => {
    queueResponse(baseResponse({ proposal: AMENDMENT_PROPOSAL, requires_review: true, next_action: 'review_proposal' }))
    render(<AskBubblesOverlay stepN={1} stepText="Boil the pasta" recipeTitle="Creamy pasta" onClose={jest.fn()} />)
    sendMessage('why al dente?')

    const request = streamChatMessageMock.mock.calls[0][0]
    expect(request).toEqual({
      message: expect.stringMatching(/why al dente\?/i),
      conversation_id: null,
      follow_up_chips: false,
    })
    expect('context' in request).toBe(false)
    expect(screen.getByText('Asking about step 1')).toBeInTheDocument()
    // Even though the response carried a matching-shaped proposal, unpinned
    // mode never renders a card.
    expect(screen.queryByTestId('ask-bubbles-amendment-card')).not.toBeInTheDocument()
  })
})
