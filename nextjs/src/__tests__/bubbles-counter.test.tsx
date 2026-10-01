/**
 * BubblesCounter (issue #741, Goal 3 signature #7): pixel digits in a stepped
 * frame. Accessible name is always the final value; it pops and counts up only
 * when the value rises (not on first render, not on a drop); with reduced
 * motion it only updates the number.
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react'

let mockReduced = false
const mockStart = jest.fn()
// stable identity, like the real hook's controls
const mockControls = { start: mockStart }

jest.mock('framer-motion', () => {
  const PASS = ['initial', 'animate', 'exit', 'transition', 'variants', 'whileTap', 'onAnimationComplete']
  function stub(Tag: string) {
    function MotionStub({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) {
      const dom = Object.fromEntries(Object.entries(rest).filter(([k]) => !PASS.includes(k)))
      return React.createElement(Tag, dom, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  return {
    motion: new Proxy({} as Record<string, unknown>, {
      // cache per tag: a fresh component type each render would remount the subtree
      get: (t, tag: string) => (t[tag] ??= stub(tag)),
    }),
    useReducedMotion: () => mockReduced,
    useAnimationControls: () => mockControls,
  }
})

import BubblesCounter from '@/components/ui/BubblesCounter'

beforeEach(() => {
  mockReduced = false
  mockStart.mockClear()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

describe('BubblesCounter (#741)', () => {
  it('names itself with the balance and shows pixel-font digits', () => {
    render(<BubblesCounter value={240} testId="c" />)
    const counter = screen.getByLabelText('240 bubbles')
    expect(counter).toBe(screen.getByTestId('c'))
    expect(counter).toHaveTextContent('240')
    // pixel lettering: the digits sit in the `font-pixel` frame
    expect(counter.querySelector('.font-pixel')).not.toBeNull()
  })

  it('shows 0 for a new user and groups thousands', () => {
    const { rerender } = render(<BubblesCounter value={0} />)
    expect(screen.getByLabelText('0 bubbles')).toHaveTextContent('0')
    rerender(<BubblesCounter value={1240} />)
    act(() => jest.advanceTimersByTime(1000))
    expect(screen.getByLabelText('1240 bubbles')).toHaveTextContent('1,240')
  })

  it('does not pop or show +N on first render', () => {
    render(<BubblesCounter value={240} />)
    expect(mockStart).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bubbles-counter-rise')).not.toBeInTheDocument()
  })

  it('pops, shows +N and counts up from the old value when the balance rises', () => {
    const { rerender } = render(<BubblesCounter value={240} />)
    rerender(<BubblesCounter value={252} />)

    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('bubbles-counter-rise')).toHaveTextContent('+12')
    // the label is the final value immediately; the visible digits climb
    const counter = screen.getByLabelText('252 bubbles')
    expect(counter).toHaveTextContent('240')
    act(() => jest.advanceTimersByTime(300))
    const mid = Number(counter.textContent)
    expect(mid).toBeGreaterThan(240)
    expect(mid).toBeLessThan(252)
    act(() => jest.advanceTimersByTime(600))
    expect(counter).toHaveTextContent('252')
  })

  it('does not pop on a drop; the number just updates', () => {
    const { rerender } = render(<BubblesCounter value={50} />)
    rerender(<BubblesCounter value={20} />)
    expect(mockStart).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bubbles-counter-rise')).not.toBeInTheDocument()
    expect(screen.getByLabelText('20 bubbles')).toHaveTextContent('20')
  })

  it('under reduced motion only updates the number: no pop, no count-up', () => {
    mockReduced = true
    const { rerender } = render(<BubblesCounter value={240} />)
    rerender(<BubblesCounter value={252} />)
    expect(mockStart).not.toHaveBeenCalled()
    expect(screen.getByLabelText('252 bubbles')).toHaveTextContent('252') // no timers advanced
  })

  it('pops again on a second rise', () => {
    const { rerender } = render(<BubblesCounter value={1} />)
    rerender(<BubblesCounter value={3} />)
    act(() => jest.advanceTimersByTime(1000))
    rerender(<BubblesCounter value={9} />)
    expect(mockStart).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('bubbles-counter-rise')).toHaveTextContent('+6')
  })
})
