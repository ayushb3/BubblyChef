/**
 * Issue #742 — PixelSheet: the one bottom sheet. Behaviour only: focus moves
 * in on open, Tab stays inside, Escape and a scrim tap close, focus returns to
 * the opener, the close button is named and big enough, body scroll is locked,
 * the handle drags to dismiss, and reduced motion makes the open a fade.
 */

import React, { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PixelSheet from '@/components/ui/PixelSheet'

// Reduced motion is driven per test; `motion.*` stubs record their `initial`
// so a test can tell a slide (has `y`) from a fade (opacity only).
let mockReduced = false
jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub(props: Record<string, unknown> & { children?: React.ReactNode }) {
      const { children, initial, ...rest } = props
      // Drop the motion-only props so they don't reach the DOM.
      delete rest.animate
      delete rest.exit
      delete rest.transition
      return React.createElement(
        Tag,
        { ...rest, 'data-initial': initial ? JSON.stringify(initial) : undefined },
        children as React.ReactNode,
      )
    }
    return MotionStub
  }
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => mockReduced,
  }
})

function Harness({
  initialOpen = false,
  closeDisabled = false,
  onCloseSpy,
}: {
  initialOpen?: boolean
  closeDisabled?: boolean
  onCloseSpy?: () => void
}) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      <PixelSheet
        open={open}
        onClose={() => {
          onCloseSpy?.()
          setOpen(false)
        }}
        title="Fridge"
        subtitle="23 items"
        closeDisabled={closeDisabled}
        footer={<button>Footer action</button>}
        testId="the-sheet"
        backdropTestId="the-scrim"
      >
        <button>First action</button>
        <button>Second action</button>
      </PixelSheet>
    </div>
  )
}

beforeEach(() => {
  mockReduced = false
  document.body.style.overflow = ''
})

describe('PixelSheet', () => {
  it('renders nothing when closed and a dialog labelled by its title when open', () => {
    const { rerender } = render(
      <PixelSheet open={false} onClose={jest.fn()} title="Fridge">
        <p>content</p>
      </PixelSheet>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(
      <PixelSheet open onClose={jest.fn()} title="Fridge">
        <p>content</p>
      </PixelSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Fridge' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('moves focus into the sheet on open', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Open sheet'))
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
  })

  it('focuses the element named by initialFocus instead of the first focusable', () => {
    render(
      <PixelSheet open onClose={jest.fn()} title="Edit" initialFocus="#name">
        <input id="name" aria-label="Name" />
      </PixelSheet>,
    )
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('keeps Tab inside the sheet, wrapping in both directions', () => {
    render(<Harness initialOpen />)
    const close = screen.getByRole('button', { name: 'Close' })
    const footer = screen.getByRole('button', { name: 'Footer action' })

    footer.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(footer).toHaveFocus()
  })

  it('closes on Escape', () => {
    const onCloseSpy = jest.fn()
    render(<Harness initialOpen onCloseSpy={onCloseSpy} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCloseSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a scrim tap, but not on a tap inside the sheet', () => {
    const onCloseSpy = jest.fn()
    render(<Harness initialOpen onCloseSpy={onCloseSpy} />)

    fireEvent.click(screen.getByText('First action'))
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCloseSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('the-scrim'))
    expect(onCloseSpy).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the opener when it closes', () => {
    render(<Harness />)
    const opener = screen.getByText('Open sheet')
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(opener).toHaveFocus()
  })

  it('has a round close button named "Close" that is at least 44 px', () => {
    const onCloseSpy = jest.fn()
    render(<Harness initialOpen onCloseSpy={onCloseSpy} />)
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveStyle({ width: '44px', height: '44px' })
    expect(close.className).toMatch(/rounded-full/)

    fireEvent.click(close)
    expect(onCloseSpy).toHaveBeenCalledTimes(1)
  })

  it('lets a caller rename the close button and disable it', () => {
    render(
      <PixelSheet
        open
        onClose={jest.fn()}
        title="Timeline"
        closeLabel="Close timeline"
        closeDisabled
      >
        <p>x</p>
      </PixelSheet>,
    )
    expect(screen.getByRole('button', { name: 'Close timeline' })).toBeDisabled()
  })

  it('locks body scroll while open and releases it on close', () => {
    render(<Harness />)
    expect(document.body.style.overflow).toBe('')
    fireEvent.click(screen.getByText('Open sheet'))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })

  it('scrolls its own body, not the page', () => {
    render(<Harness initialOpen />)
    const body = screen.getByText('First action').parentElement as HTMLElement
    expect(body.className).toMatch(/overflow-y-auto/)
  })

  describe('drag the handle to dismiss', () => {
    function drag(to: number, ms = 400) {
      const handle = screen.getByTestId('pixel-sheet-handle')
      fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 })
      fireEvent.pointerMove(handle, { clientY: to / 2, timeStamp: ms / 2 })
      fireEvent.pointerMove(handle, { clientY: to, timeStamp: ms })
      fireEvent.pointerUp(handle, { clientY: to, timeStamp: ms })
    }

    it('closes when dragged down past the threshold', () => {
      const onCloseSpy = jest.fn()
      render(<Harness initialOpen onCloseSpy={onCloseSpy} />)
      drag(300)
      expect(onCloseSpy).toHaveBeenCalledTimes(1)
    })

    it('does not close on a tiny slow drag, and springs back', () => {
      const onCloseSpy = jest.fn()
      render(<Harness initialOpen onCloseSpy={onCloseSpy} />)
      // jsdom has no layout, so the sheet is "1px" tall: a 0px drag is the
      // honest "let go early" case.
      drag(0)
      expect(onCloseSpy).not.toHaveBeenCalled()
      expect(screen.getByTestId('the-sheet').style.translate).toBe('')
    })

    it('takes no drag at all while closing is disabled', async () => {
      render(<Harness initialOpen closeDisabled onCloseSpy={jest.fn()} />)
      drag(300)
      // A disabled sheet takes no drag at all.
      expect(screen.getByTestId('the-sheet').style.translate).toBe('')
    })

    it('springs back when a guarded onClose leaves the sheet open', async () => {
      jest.useFakeTimers()
      const guarded = jest.fn()
      render(
        <PixelSheet open onClose={guarded} title="Guarded" testId="g">
          <p>x</p>
        </PixelSheet>,
      )
      drag(300)
      expect(guarded).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('g').style.translate).toBe('0 300px')
      act(() => {
        jest.advanceTimersByTime(100)
      })
      expect(screen.getByTestId('g').style.translate).toBe('')
      jest.useRealTimers()
    })
  })

  describe('motion', () => {
    it('springs up from below by default', () => {
      render(<Harness initialOpen />)
      expect(JSON.parse(screen.getByTestId('the-sheet').dataset.initial as string)).toEqual({
        y: '100%',
      })
    })

    it('is a fade, not a slide, with reduced motion', () => {
      mockReduced = true
      render(<Harness initialOpen />)
      const initial = JSON.parse(screen.getByTestId('the-sheet').dataset.initial as string)
      expect(initial).toEqual({ opacity: 0 })
      expect(initial).not.toHaveProperty('y')
    })
  })

  it('keeps the page locked until the last of two stacked sheets has closed', async () => {
    function Stack() {
      const [a, setA] = useState(true)
      const [b, setB] = useState(true)
      return (
        <>
          <PixelSheet open={a} onClose={() => setA(false)} title="A">
            <p>a</p>
          </PixelSheet>
          <PixelSheet open={b} onClose={() => setB(false)} title="B">
            <p>b</p>
          </PixelSheet>
        </>
      )
    }
    render(<Stack />)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByText('a')).not.toBeInTheDocument())
    expect(document.body.style.overflow).toBe('hidden')
  })
})
