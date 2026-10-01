/**
 * Issue #742 — PixelPanel: the stepped frame. jsdom has no layout or paint, so
 * these pin the contract that matters and can be checked: theme variables only
 * (no hex), a stepped clip, the offset shadow in `primary-dark`, children
 * rendered, and the focus ring present only when the whole card is a control.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import PixelPanel from '@/components/ui/PixelPanel'

describe('PixelPanel', () => {
  it('renders its children', () => {
    render(<PixelPanel>Your romaine needs using today.</PixelPanel>)
    expect(screen.getByText('Your romaine needs using today.')).toBeInTheDocument()
  })

  it('draws the frame, surface and offset shadow from theme variables only', () => {
    const { container } = render(<PixelPanel>hi</PixelPanel>)
    const html = container.innerHTML
    expect(html).toContain('drop-shadow(4px 4px 0 var(--color-primary-dark))')
    expect(html).toContain('background: var(--color-text)')
    expect(html).toContain('background: var(--color-surface)')
    expect(html).toMatch(/clip-path: polygon\(/)
    // Switching theme recolours it, so no colour may be hard-coded.
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(html).not.toMatch(/rgb\(|rgba\(/)
  })

  it('has no focus ring when it is not a control', () => {
    const { container } = render(<PixelPanel>hi</PixelPanel>)
    expect(container.querySelector('[data-pixel-panel-ring]')).toBeNull()
  })

  it('becomes the control when the whole card is a link or button, with a ring', () => {
    const onClick = jest.fn()
    const { container } = render(
      <>
        <PixelPanel as="a" href="/meal/1">
          Back to the lemon pasta?
        </PixelPanel>
        <PixelPanel as="button" type="button" onClick={onClick}>
          Plan dinner
        </PixelPanel>
      </>,
    )
    expect(screen.getByRole('link', { name: 'Back to the lemon pasta?' })).toHaveAttribute(
      'href',
      '/meal/1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Plan dinner' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('[data-pixel-panel-ring]')).toHaveLength(2)
  })

  it('passes layout classes to the root and padding overrides to the surface', () => {
    const { container } = render(
      <PixelPanel className="w-full" contentClassName="p-6">
        hi
      </PixelPanel>,
    )
    const root = container.querySelector('[data-pixel-panel]') as HTMLElement
    expect(root).toHaveClass('w-full')
    expect(screen.getByText('hi')).toHaveClass('p-6')
  })
})
