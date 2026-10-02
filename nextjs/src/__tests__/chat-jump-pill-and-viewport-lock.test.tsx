/**
 * Issue #900 — the chat column owns the whole viewport, and "Jump to latest" is
 * a bare floating pill. jsdom can't lay anything out, so these assert the
 * contract (what is rendered, which classes, what the hook does to the document);
 * the real geometry is covered by e2e/chat-cooking-banner-layout.spec.ts.
 */

import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import JumpToLatestPill from '@/components/chat/JumpToLatestPill'
import { useChatViewportLock } from '@/hooks/useChatViewportLock'

describe('JumpToLatestPill', () => {
  it('renders just the button: no wrapper element around it', () => {
    const { container } = render(<JumpToLatestPill onClick={() => {}} />)
    const pill = screen.getByTestId('jump-to-latest')
    expect(container.firstElementChild).toBe(pill)
    expect(pill.tagName).toBe('BUTTON')
  })

  it('floats over the list, out of normal flow, so showing it shifts nothing', () => {
    render(<JumpToLatestPill onClick={() => {}} />)
    const classes = screen.getByTestId('jump-to-latest').className.split(/\s+/)
    expect(classes).toContain('absolute')
    expect(classes).not.toContain('w-full')
  })

  it('calls onClick when tapped', () => {
    const onClick = jest.fn()
    render(<JumpToLatestPill onClick={onClick} />)
    fireEvent.click(screen.getByTestId('jump-to-latest'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('useChatViewportLock', () => {
  let scrollTo: jest.SpyInstance

  beforeEach(() => {
    scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
  })

  afterEach(() => {
    scrollTo.mockRestore()
    document.documentElement.classList.remove('overflow-hidden')
  })

  it('stops the document scrolling while mounted and releases it on unmount', () => {
    const { unmount } = renderHook(() => useChatViewportLock())
    expect(document.documentElement.classList.contains('overflow-hidden')).toBe(true)
    unmount()
    expect(document.documentElement.classList.contains('overflow-hidden')).toBe(false)
  })

  it('puts the page back at the top if anything scrolls the document', () => {
    renderHook(() => useChatViewportLock())
    ;(window as { scrollY: number }).scrollY = 76
    fireEvent.scroll(window)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' })
  })

  it('leaves the page alone when it is already at the top', () => {
    renderHook(() => useChatViewportLock())
    fireEvent.scroll(window)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('stops watching once unmounted', () => {
    const { unmount } = renderHook(() => useChatViewportLock())
    unmount()
    ;(window as { scrollY: number }).scrollY = 76
    fireEvent.scroll(window)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
