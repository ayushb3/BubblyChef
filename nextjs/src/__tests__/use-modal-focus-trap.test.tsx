/**
 * Unit tests for the shared modal focus-trap hook (issue #291).
 *
 * These exercise the hook directly against a minimal harness rather than a
 * real modal component, so the trap/Escape/restore contract is pinned down
 * once, independent of any single caller's markup.
 */

import React, { useRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useModalFocusTrap } from '@/hooks/useModalFocusTrap'

function Harness({
  initialOpen = false,
  onCloseSpy,
}: {
  initialOpen?: boolean
  onCloseSpy?: () => void
}) {
  const [open, setOpen] = useState(initialOpen)
  const panelRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, () => {
    onCloseSpy?.()
    setOpen(false)
  }, panelRef)

  return (
    <div>
      <button onClick={() => setOpen(true)}>Open trigger</button>
      {open && (
        <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}>
          <button>First</button>
          <button>Second</button>
          <button>Last</button>
        </div>
      )}
    </div>
  )
}

describe('useModalFocusTrap', () => {
  it('moves focus into the panel on open, landing on the first focusable element', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Open trigger'))
    expect(screen.getByText('First')).toHaveFocus()
  })

  it('does not steal focus from an element that already has it inside the panel (e.g. autoFocus)', () => {
    function AutoFocusHarness() {
      const [open, setOpen] = useState(false)
      const panelRef = useRef<HTMLDivElement>(null)
      useModalFocusTrap(open, () => setOpen(false), panelRef)
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <div ref={panelRef} role="dialog" tabIndex={-1}>
              <button>First</button>
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input autoFocus placeholder="autofocused field" />
            </div>
          )}
        </div>
      )
    }
    render(<AutoFocusHarness />)
    fireEvent.click(screen.getByText('Open'))
    expect(screen.getByPlaceholderText('autofocused field')).toHaveFocus()
  })

  it('cycles Tab forward from the last focusable element back to the first', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Open trigger'))
    screen.getByText('Last').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('First')).toHaveFocus()
  })

  it('cycles Shift+Tab backward from the first focusable element to the last', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Open trigger'))
    expect(screen.getByText('First')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('Last')).toHaveFocus()
  })

  it('never lets focus land outside the panel while open (trap, not just wraparound)', () => {
    render(
      <div>
        <button>Outside button</button>
        <Harness />
      </div>,
    )
    fireEvent.click(screen.getByText('Open trigger'))
    // Simulate focus escaping to something outside the panel (e.g. a
    // programmatic .focus() call elsewhere), then pressing Tab.
    screen.getByText('Outside button').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('First')).toHaveFocus()
  })

  it('closes on Escape', () => {
    const onCloseSpy = jest.fn()
    render(<Harness onCloseSpy={onCloseSpy} />)
    fireEvent.click(screen.getByText('Open trigger'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCloseSpy).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the trigger element on close', () => {
    render(<Harness />)
    const trigger = screen.getByText('Open trigger')
    // A real click focuses the button first; fireEvent.click alone does not
    // simulate that, so it's done explicitly to model what the hook actually
    // captures as "whatever had focus when the modal opened".
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByText('First')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })

  it('skips a leading CSS display:none focusable element for initial focus placement', () => {
    function HiddenLeadingHarness() {
      const [open, setOpen] = useState(false)
      const panelRef = useRef<HTMLDivElement>(null)
      useModalFocusTrap(open, () => setOpen(false), panelRef)
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <div ref={panelRef} role="dialog" tabIndex={-1}>
              {/* Mounted but CSS-hidden and first in DOM order — e.g. a
                  collapsed accordion section or an advanced-options block
                  that stays mounted rather than being removed via
                  conditional JSX. If `getFocusable` didn't filter by
                  visibility, this would wrongly become `focusables[0]` and
                  initial `.focus()` on it would be a silent no-op. */}
              <button style={{ display: 'none' }}>Hidden leading field</button>
              <button>Visible first</button>
              <button>Visible last</button>
            </div>
          )}
        </div>
      )
    }
    render(<HiddenLeadingHarness />)
    fireEvent.click(screen.getByText('Open'))
    expect(screen.getByText('Visible first')).toHaveFocus()
  })

  it('skips a trailing CSS display:none focusable element when Tab-wrapping to the last element', () => {
    function HiddenTrailingHarness() {
      const [open, setOpen] = useState(false)
      const panelRef = useRef<HTMLDivElement>(null)
      useModalFocusTrap(open, () => setOpen(false), panelRef)
      return (
        <div>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <div ref={panelRef} role="dialog" tabIndex={-1}>
              <button>Visible first</button>
              <button>Visible last</button>
              {/* Mounted but CSS-hidden and last in DOM order. If
                  `getFocusable` didn't filter by visibility, this would
                  wrongly become `focusables[last]`, and Shift+Tab from
                  "Visible first" would wrap to it instead of to the actual
                  last visible element. */}
              <button style={{ display: 'none' }}>Hidden trailing field</button>
            </div>
          )}
        </div>
      )
    }
    render(<HiddenTrailingHarness />)
    fireEvent.click(screen.getByText('Open'))
    expect(screen.getByText('Visible first')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('Visible last')).toHaveFocus()
  })

  it('still includes a normal visible focusable element (no false-positive filtering)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Open trigger'))
    expect(screen.getByText('First')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('Last')).toHaveFocus()
  })

  it('does not throw and does not crash focus restore when the trigger has been unmounted', () => {
    function UnmountingTriggerHarness() {
      const [showTrigger, setShowTrigger] = useState(true)
      const [open, setOpen] = useState(false)
      const panelRef = useRef<HTMLDivElement>(null)
      useModalFocusTrap(open, () => setOpen(false), panelRef)
      return (
        <div>
          {showTrigger && (
            <button
              onClick={() => {
                setOpen(true)
                setShowTrigger(false)
              }}
            >
              Trigger
            </button>
          )}
          {open && (
            <div ref={panelRef} role="dialog" tabIndex={-1}>
              <button>Panel button</button>
            </div>
          )}
        </div>
      )
    }
    render(<UnmountingTriggerHarness />)
    const trigger = screen.getByText('Trigger')
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByText('Panel button')).toHaveFocus()
    // Trigger button is gone from the DOM now — closing must not throw, and
    // must not leave a stale reference wired up.
    expect(() => {
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
      })
    }).not.toThrow()
  })
})
