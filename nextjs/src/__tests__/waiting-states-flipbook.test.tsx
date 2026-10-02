/**
 * Issue #887 — waiting states. The thinking Bubbles is a two-frame flip-book
 * (the original image, then the mirrored one, a hard cut every ~450 ms, still
 * under reduced motion); the meal-open waiting card names the picked option and
 * its dishes; the compact card's "Opening…" carries the animated Bubbles.
 *
 * Behaviour, not markup: what is drawn after how much time, and what a user of
 * assistive tech is told.
 */
import React from 'react'
import { act, render, screen, within } from '@testing-library/react'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

import BubblesMascot, { FLIP_MS, THINKING_FLIP_MS } from '@/components/ui/BubblesMascot'
import TypingIndicator from '@/components/chat/TypingIndicator'
import MealOpenWaitingCard, { MEAL_OPEN_STATUS_MS } from '@/components/chat/MealOpenWaitingCard'
import CompactVariant from '@/components/recipes/recipe-card/CompactVariant'

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

const isMirrored = (img: HTMLElement) => img.style.transform.replace(/\s/g, '') === 'scaleX(-1)'

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  mockReduced = false
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('thinking Bubbles is a two-frame flip-book (issue #887)', () => {
  it('starts on the original image, then cuts to the mirrored one, then back, on a ~450 ms beat', () => {
    expect(THINKING_FLIP_MS).toBeGreaterThanOrEqual(400)
    expect(THINKING_FLIP_MS).toBeLessThanOrEqual(500)

    render(<BubblesMascot state="thinking" />)
    const img = screen.getByAltText('Bubbles thinking')
    expect(isMirrored(img)).toBe(false)

    advance(THINKING_FLIP_MS - 10)
    expect(isMirrored(img)).toBe(false)
    advance(10)
    expect(isMirrored(img)).toBe(true)
    advance(THINKING_FLIP_MS)
    expect(isMirrored(img)).toBe(false)
    advance(THINKING_FLIP_MS)
    expect(isMirrored(img)).toBe(true)
  })

  it('is a hard cut: no CSS transition on the flip', () => {
    render(<BubblesMascot state="thinking" />)
    const img = screen.getByAltText('Bubbles thinking')
    advance(THINKING_FLIP_MS)
    expect(isMirrored(img)).toBe(true)
    expect(img.style.transition).toBe('')
  })

  it('stays on one still frame under prefers-reduced-motion', () => {
    mockReduced = true
    render(<BubblesMascot state="thinking" />)
    const img = screen.getByAltText('Bubbles thinking')
    advance(THINKING_FLIP_MS * 6)
    expect(isMirrored(img)).toBe(false)
  })

  it('stays still when animate is off', () => {
    render(<BubblesMascot state="thinking" animate={false} />)
    const img = screen.getByAltText('Bubbles thinking')
    advance(THINKING_FLIP_MS * 6)
    expect(isMirrored(img)).toBe(false)
  })

  it('only the thinking pose flips by default', () => {
    render(<BubblesMascot state="happy" />)
    const img = screen.getByAltText('Bubbles happy')
    advance(THINKING_FLIP_MS * 3)
    expect(isMirrored(img)).toBe(false)
  })

  it('any pose can take the flip with the flip prop, and thinking can be held still with flip={false}', () => {
    const { unmount } = render(<BubblesMascot state="happy" flip />)
    const happy = screen.getByAltText('Bubbles happy')
    expect(isMirrored(happy)).toBe(false)
    advance(FLIP_MS)
    expect(isMirrored(happy)).toBe(true)
    unmount()

    render(<BubblesMascot state="thinking" flip={false} />)
    const still = screen.getByAltText('Bubbles thinking')
    advance(FLIP_MS * 4)
    expect(isMirrored(still)).toBe(false)
  })

  it('the flip prop is still under reduced motion', () => {
    mockReduced = true
    render(<BubblesMascot state="happy" flip />)
    const img = screen.getByAltText('Bubbles happy')
    advance(FLIP_MS * 4)
    expect(isMirrored(img)).toBe(false)
  })

  it('stops its timer on unmount', () => {
    const { unmount } = render(<BubblesMascot state="thinking" />)
    unmount()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('the chat typing indicator flips its Bubbles and still announces "Bubbles is typing"', () => {
    render(<TypingIndicator />)
    const img = screen.getByAltText('Bubbles thinking')
    expect(isMirrored(img)).toBe(false)
    advance(THINKING_FLIP_MS)
    expect(isMirrored(img)).toBe(true)
    expect(screen.getByRole('status')).toHaveTextContent('Bubbles is typing')
  })
})

describe('MealOpenWaitingCard (issue #887)', () => {
  const DISHES = ['Lemon butter chicken', 'Buttered orzo']

  it("shows the picked option's title and its dish names beside an animated Bubbles", () => {
    render(<MealOpenWaitingCard title="Lemon chicken dinner" dishes={DISHES} />)
    expect(screen.getByText('Lemon chicken dinner')).toBeInTheDocument()
    expect(screen.getByText('Lemon butter chicken')).toBeInTheDocument()
    expect(screen.getByText('Buttered orzo')).toBeInTheDocument()

    const img = screen.getByAltText('Bubbles thinking')
    expect(isMirrored(img)).toBe(false)
    advance(THINKING_FLIP_MS)
    expect(isMirrored(img)).toBe(true)
  })

  it('is one polite status region naming what is opening', () => {
    render(<MealOpenWaitingCard title="Lemon chicken dinner" dishes={DISHES} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('Opening Lemon chicken dinner')
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('rotates a short status line so the wait reads as progress', () => {
    render(<MealOpenWaitingCard title="Lemon chicken dinner" dishes={DISHES} />)
    const line = screen.getByTestId('meal-open-status-line')
    const first = line.textContent
    expect(first).toMatch(/\S/)
    advance(MEAL_OPEN_STATUS_MS)
    const second = line.textContent
    expect(second).not.toBe(first)
    advance(MEAL_OPEN_STATUS_MS)
    expect(line.textContent).not.toBe(second)
  })

  it('never claims a dish is done (it cannot see per-dish progress)', () => {
    render(<MealOpenWaitingCard title="Lemon chicken dinner" dishes={DISHES} />)
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      seen.push(screen.getByTestId('meal-open-status-line').textContent ?? '')
      advance(MEAL_OPEN_STATUS_MS)
    }
    for (const text of seen) expect(text).not.toMatch(/done|ready|finished|✓|✔/i)
    expect(screen.queryByText('Opening…')).not.toBeInTheDocument()
  })

  it('holds one status line and a still Bubbles under reduced motion', () => {
    mockReduced = true
    render(<MealOpenWaitingCard title="Lemon chicken dinner" dishes={DISHES} />)
    const line = screen.getByTestId('meal-open-status-line')
    const first = line.textContent
    advance(MEAL_OPEN_STATUS_MS * 3)
    expect(line.textContent).toBe(first)
    expect(isMirrored(screen.getByAltText('Bubbles thinking'))).toBe(false)
  })

  it('copes with an option that has no dishes and a very long title', () => {
    const long = 'A'.repeat(180)
    render(<MealOpenWaitingCard title={long} dishes={[]} />)
    expect(screen.getByText(long).className).toMatch(/break-words|\[overflow-wrap:anywhere\]/)
  })
})

describe('the compact meal card while it opens (issue #887)', () => {
  it('pairs "Opening…" with the animated Bubbles instead of bare text', () => {
    render(<CompactVariant title="Lemon chicken dinner" dishes={['Lemon chicken']} onOpen={() => {}} openState="pending" />)
    const button = screen.getByRole('button', { name: 'Opening…' })
    expect(button).toBeDisabled()
    const img = within(button).getByAltText('Bubbles thinking')
    expect(isMirrored(img)).toBe(false)
    advance(THINKING_FLIP_MS)
    expect(isMirrored(img)).toBe(true)
  })
})
