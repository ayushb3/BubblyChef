/**
 * BubblesMascot (issue #525, art swapped in #527) — five states, the
 * one-shot celebrate bounce/sparkle burst, and reduced-motion gating.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'

let mockReducedMotion = false
jest.mock('framer-motion', () => {
  // framer-motion-only prop names that must not leak onto the stubbed DOM node.
  const MOTION_ONLY_PROPS = [
    'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap',
    'drag', 'dragControls', 'dragListener', 'dragConstraints', 'dragElastic',
    'onDragEnd', 'layout',
  ]
  function passthrough(Tag: string) {
    function MotionStub({
      children,
      ...rest
    }: Record<string, unknown> & { children?: React.ReactNode }) {
      const domProps = Object.fromEntries(
        Object.entries(rest).filter(([key]) => !MOTION_ONLY_PROPS.includes(key)),
      )
      // Surface the `animate` keyframes actually handed to framer-motion as a
      // DOM attribute so tests can assert on it directly, instead of only
      // inferring motion from the presence/absence of testid wrapper elements.
      if ('animate' in rest) {
        domProps['data-motion-animate'] = JSON.stringify(rest.animate ?? {})
      }
      return React.createElement(Tag, domProps, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_t: unknown, tag: string) => passthrough(tag) })
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => mockReducedMotion,
  }
})

import BubblesMascot from '@/components/ui/BubblesMascot'

describe('BubblesMascot (#525)', () => {
  beforeEach(() => {
    mockReducedMotion = false
  })

  it.each(['happy', 'surprised', 'thinking', 'worried', 'celebrate'] as const)(
    'renders the %s state',
    (state) => {
      render(<BubblesMascot state={state} />)
      expect(screen.getByAltText(`Bubbles ${state}`)).toBeInTheDocument()
    },
  )

  it('fires the sparkle burst when celebrating with motion enabled', () => {
    render(<BubblesMascot state="celebrate" />)
    expect(screen.getByTestId('bubbles-sparkle-burst')).toBeInTheDocument()
  })

  it('skips the sparkle burst and bounce under prefers-reduced-motion', () => {
    mockReducedMotion = true
    render(<BubblesMascot state="celebrate" />)
    expect(screen.queryByTestId('bubbles-sparkle-burst')).toBeNull()
  })

  it('skips the sparkle burst when the animate prop is false', () => {
    render(<BubblesMascot state="celebrate" animate={false} />)
    expect(screen.queryByTestId('bubbles-sparkle-burst')).toBeNull()
  })

  it('still swaps to the worried image under reduced motion (only motion is skipped)', () => {
    mockReducedMotion = true
    render(<BubblesMascot state="worried" />)
    expect(screen.getByAltText('Bubbles worried')).toBeInTheDocument()
  })

  it.each(['happy', 'surprised', 'thinking', 'worried', 'celebrate'] as const)(
    'sends no motion keyframes for the %s state under prefers-reduced-motion (no infinite float)',
    (state) => {
      mockReducedMotion = true
      render(<BubblesMascot state={state} />)
      const img = screen.getByAltText(`Bubbles ${state}`)
      const motionWrapper = img.closest('[data-motion-animate]')
      expect(motionWrapper).not.toBeNull()
      // Empty object == no keyframes handed to framer-motion == nothing to
      // animate, i.e. the idle float (`y: [0, -6, 0]`, repeat: Infinity)
      // does not leak through for any state when motion is disabled.
      expect(motionWrapper?.getAttribute('data-motion-animate')).toBe('{}')
    },
  )
})
