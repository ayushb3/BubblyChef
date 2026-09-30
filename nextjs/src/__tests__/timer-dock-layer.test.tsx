/**
 * Issue #657 — the timer dock rises above guided cook while it is open.
 * jsdom ignores z-index, so these assert the class/data hooks the dock
 * publishes (`data-raised`, `z-[9991]`); that the dock is actually reachable
 * above the flow is proven by the in-page hit-test in `verify`.
 */

import React, { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Same shape as guided-cook-flow.test.tsx's mock, plus `layout` on the dock's
// motion elements, which a plain DOM node would warn about.
jest.mock('framer-motion', () => {
  const strip = (props: Record<string, unknown>) => {
    const rest = { ...props }
    for (const k of ['layout', 'initial', 'animate', 'exit', 'transition']) delete rest[k]
    return rest
  }
  const make = (Tag: 'div' | 'button' | 'span') =>
    function Mock({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) {
      return <Tag {...(strip(rest) as object)}>{children}</Tag>
    }
  return {
    motion: { div: make('div'), button: make('button'), span: make('span') },
    // Calls `onExitComplete` when the children go from present to empty, the
    // way the real one does once the exit animation ends.
    AnimatePresence: function MockPresence({
      children,
      onExitComplete,
    }: {
      children: React.ReactNode
      onExitComplete?: () => void
    }) {
      const present = React.Children.toArray(children).length > 0
      const wasPresent = React.useRef(present)
      React.useEffect(() => {
        if (wasPresent.current && !present) onExitComplete?.()
        wasPresent.current = present
      })
      return <>{children}</>
    },
    useReducedMotion: () => false,
  }
})

jest.mock('@/lib/motion', () => ({
  useMotionConfig: () => ({ reduced: false, springs: { soft: {}, snappy: {}, pop: {}, page: {} } }),
  springs: { soft: {}, snappy: {}, pop: {}, page: {} },
  heartPopVariants: {},
}))

jest.mock('@/lib/api/chat', () => ({ streamChatMessage: jest.fn() }))
jest.mock('@/lib/api/recipes', () => ({ ensureSteps: jest.fn(() => new Promise(() => {})) }))

import GuidedCookFlow from '@/components/recipes/GuidedCookFlow'
import TimerDock from '@/components/timers/TimerDock'
import { TimerDockLayerProvider } from '@/components/timers/TimerDockLayer'
import type { Recipe } from '@/components/recipes/RecipePage'
import { CookingTimersProvider, useCookingTimers } from '@/lib/useCookingTimers'

const RECIPE: Recipe = {
  id: 'r1',
  user_id: 'u1',
  title: 'Creamy Tomato Pasta',
  description: 'Quick weeknight pasta',
  ingredients: [{ name: 'pasta', quantity: 200, unit: 'g' }],
  instructions: ['Boil salted water and cook pasta.', 'Add tomatoes and simmer for 8 minutes.'],
  servings: 2,
}

const startRef: { current: ((label: string, seconds: number) => void) | null } = { current: null }
function TimerStarter() {
  const { start } = useCookingTimers()
  useEffect(() => {
    startRef.current = (label, seconds) => start(label, seconds)
  }, [start])
  return null
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function Harness({ showFlow = true, withProvider = true }: { showFlow?: boolean; withProvider?: boolean }) {
  const body = (
    <CookingTimersProvider>
      <TimerStarter />
      {showFlow && <GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} />}
      <TimerDock />
    </CookingTimersProvider>
  )
  return (
    <QueryClientProvider client={client}>
      {withProvider ? <TimerDockLayerProvider>{body}</TimerDockLayerProvider> : body}
    </QueryClientProvider>
  )
}

function stepBody() {
  return screen.getByTestId('guided-cook-flow').querySelector('.overflow-y-auto') as HTMLElement
}

function startTimer() {
  act(() => startRef.current!('Simmer', 480))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('TimerDock over guided cook (issue #657)', () => {
  it('rises above guided cook (z-[9991], raised bottom) once expanded', () => {
    render(<Harness />)
    startTimer()
    fireEvent.click(screen.getByLabelText('Expand timers'))
    const dock = screen.getByTestId('timer-dock')
    expect(dock).toHaveAttribute('data-raised', 'true')
    expect(dock.className).toContain('z-[9991]')
    expect(dock.className).not.toContain('z-40')
    expect(dock.style.bottom).toContain('96px')
  })

  it('pads the step scroll body while raised with a timer, and not without one', () => {
    render(<Harness />)
    expect(stepBody().className).not.toContain('pb-[calc(6rem+env(safe-area-inset-bottom))]')
    startTimer()
    expect(stepBody().className).toContain('pb-[calc(6rem+env(safe-area-inset-bottom))]')
  })

  it('drops back to z-40 while Ask Bubbles is open, and rises again on close', () => {
    render(<Harness />)
    startTimer()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep so a step exists
    expect(screen.getByTestId('timer-dock')).toHaveAttribute('data-raised', 'true')

    fireEvent.click(screen.getByLabelText('Ask Bubbles about this step'))
    expect(screen.getByTestId('timer-dock')).toHaveAttribute('data-raised', 'false')
    expect(screen.getByTestId('timer-dock').className).toContain('z-40')

    fireEvent.click(screen.getByRole('button', { name: /Back to step/i }))
    expect(screen.getByTestId('timer-dock')).toHaveAttribute('data-raised', 'true')
  })

  it('drops back once guided cook unmounts', () => {
    const { rerender } = render(<Harness />)
    startTimer()
    expect(screen.getByTestId('timer-dock')).toHaveAttribute('data-raised', 'true')
    rerender(<Harness showFlow={false} />)
    const dock = screen.getByTestId('timer-dock')
    expect(dock).toHaveAttribute('data-raised', 'false')
    expect(dock.className).toContain('z-40')
    expect(dock.style.bottom).toContain('64px')
  })

  it('stays z-40 with no provider (isolated renders unchanged)', () => {
    render(<Harness withProvider={false} />)
    startTimer()
    const dock = screen.getByTestId('timer-dock')
    expect(dock).toHaveAttribute('data-raised', 'false')
    expect(dock.className).toContain('z-40')
  })
})
