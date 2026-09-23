/**
 * BubblePop (issue #525) — the "🫧 +N" pop that fires when the bubbles
 * balance increases. Mocks useBubbles() directly rather than mocking fetch,
 * since the balance needs to change across re-renders of the same query key.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

jest.mock('framer-motion', () => {
  const MOTION_ONLY_PROPS = ['initial', 'animate', 'exit', 'transition']
  function passthrough(Tag: string) {
    function MotionStub({
      children,
      ...rest
    }: Record<string, unknown> & { children?: React.ReactNode }) {
      const domProps = Object.fromEntries(
        Object.entries(rest).filter(([key]) => !MOTION_ONLY_PROPS.includes(key)),
      )
      return React.createElement(Tag, domProps, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_t: unknown, tag: string) => passthrough(tag) })
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  }
})

let mockPathname = '/'
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

const useBubblesMock = jest.fn()
jest.mock('@/lib/api/bubbles', () => ({
  useBubbles: (options?: { enabled?: boolean }) => useBubblesMock(options),
}))

import BubblePop from '@/components/ui/BubblePop'

function setBalance(balance: number | undefined) {
  useBubblesMock.mockReturnValue({ data: balance === undefined ? undefined : { balance, recent: [] } })
}

describe('BubblePop (#525)', () => {
  beforeEach(() => {
    mockPathname = '/'
  })

  afterEach(() => {
    useBubblesMock.mockReset()
  })

  it('does not pop on the first observation of a balance', () => {
    setBalance(10)
    const { rerender } = render(<BubblePop />)
    rerender(<BubblePop />)
    expect(screen.queryByTestId('bubble-pop')).toBeNull()
  })

  it('pops "+N" when the balance increases', async () => {
    setBalance(10)
    const { rerender } = render(<BubblePop />)

    setBalance(15)
    rerender(<BubblePop />)

    await waitFor(() => expect(screen.getByTestId('bubble-pop')).toBeInTheDocument())
    expect(screen.getByTestId('bubble-pop').textContent).toContain('+5')
  })

  it('does not pop when the balance decreases', () => {
    setBalance(10)
    const { rerender } = render(<BubblePop />)

    setBalance(3)
    rerender(<BubblePop />)

    expect(screen.queryByTestId('bubble-pop')).toBeNull()
  })

  it('does not pop when the balance is unchanged', () => {
    setBalance(10)
    const { rerender } = render(<BubblePop />)

    setBalance(10)
    rerender(<BubblePop />)

    expect(screen.queryByTestId('bubble-pop')).toBeNull()
  })

  it('renders nothing while the balance is still loading (undefined)', () => {
    setBalance(undefined)
    render(<BubblePop />)
    expect(screen.queryByTestId('bubble-pop')).toBeNull()
  })

  it('disables the bubbles query on /login', () => {
    mockPathname = '/login'
    setBalance(undefined)
    render(<BubblePop />)
    expect(useBubblesMock).toHaveBeenCalledWith({ enabled: false })
  })

  it('enables the bubbles query on every other page', () => {
    mockPathname = '/pantry'
    setBalance(undefined)
    render(<BubblePop />)
    expect(useBubblesMock).toHaveBeenCalledWith({ enabled: true })
  })

  it('resets lastSeen when the balance goes back to unknown, so the next value is a fresh baseline (no pop)', () => {
    // 100 -> undefined (e.g. sign-out clearing the query cache) -> 50: the
    // 50 is a first observation off the reset baseline, not a decrease-then-
    // increase, so it must stay silent even though 50 < 100.
    setBalance(100)
    const { rerender } = render(<BubblePop />)

    setBalance(undefined)
    rerender(<BubblePop />)
    expect(screen.queryByTestId('bubble-pop')).toBeNull()

    setBalance(50)
    rerender(<BubblePop />)
    expect(screen.queryByTestId('bubble-pop')).toBeNull()
  })
})
