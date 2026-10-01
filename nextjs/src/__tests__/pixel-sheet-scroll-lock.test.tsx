/**
 * Issue #844 — a PixelSheet over a scrolled page must not move the page, and
 * closing it must put the page back exactly where it was.
 *
 * jsdom has no layout, so a browser's "scroll to reveal what took focus" is
 * simulated: `focus` is wrapped to bump `scrollY` unless `preventScroll` was
 * passed, the way a browser behaves. (The real browser is covered by
 * `e2e/pixel-sheet-scroll.spec.ts` at 390px.)
 */
import React, { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import PixelSheet from '@/components/ui/PixelSheet'

jest.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) =>
        function MotionStub(props: Record<string, unknown> & { children?: React.ReactNode }) {
          const { children, ...rest } = props
          for (const key of ['initial', 'animate', 'exit', 'transition']) delete rest[key]
          return React.createElement(tag, rest, children as React.ReactNode)
        },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

let scrollY = 0
let scrollTo: jest.Mock
const realFocus = HTMLElement.prototype.focus

beforeEach(() => {
  scrollY = 0
  document.body.style.overflow = ''
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => 0 })
  scrollTo = jest.fn((arg: ScrollToOptions | number) => {
    scrollY = typeof arg === 'number' ? 0 : (arg.top ?? 0)
  })
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  // A browser reveals a focused element by scrolling the page, unless told not to.
  HTMLElement.prototype.focus = function focus(this: HTMLElement, options?: FocusOptions) {
    if (!options?.preventScroll) scrollY += 100
    realFocus.call(this, options)
  }
})
afterEach(() => {
  HTMLElement.prototype.focus = realFocus
})

function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      <PixelSheet open={open} onClose={() => setOpen(false)} title="Fridge">
        <button>Inside</button>
      </PixelSheet>
    </div>
  )
}

describe('PixelSheet leaves the page where it was (#844)', () => {
  it('opening does not move the page, however focus moves in', () => {
    scrollY = 214
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(scrollY).toBe(214)
  })

  it('closing puts the page back exactly, even if something scrolled it meanwhile', () => {
    scrollY = 214
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    // Something scrolls the page while the sheet is up (a layout shift, a stray scrollIntoView).
    scrollY = 107
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 214 }))
    expect(scrollY).toBe(214)
  })

  it('closing does not scroll the page to reveal the opener it hands focus back to', () => {
    scrollY = 300
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(scrollY).toBe(300)
  })

  it('leaves the scroll alone when the page did not move', () => {
    scrollY = 50
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('does not drag a new page back to the old position when the address changed meanwhile', () => {
    scrollY = 214
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    // A link inside the sheet navigated: the new page starts at the top.
    window.history.pushState({}, '', '/chat')
    scrollY = 0
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    })
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollY).toBe(0)
    window.history.pushState({}, '', '/')
  })
})
