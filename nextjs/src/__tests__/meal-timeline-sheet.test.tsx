/**
 * Issue #653 — component tests for `MealTimelineSheet`: it renders its
 * children only while open, closes on Escape and on backdrop click, and
 * traps focus inside the panel (via the shared `useModalFocusTrap` hook —
 * same mechanism as `PantryAddSheet`).
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import MealTimelineSheet from '@/components/meal/MealTimelineSheet'

describe('MealTimelineSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MealTimelineSheet open={false} onClose={jest.fn()}>
        <p>timeline content</p>
      </MealTimelineSheet>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders its children when open, as a labelled dialog', () => {
    render(
      <MealTimelineSheet open onClose={jest.fn()}>
        <p>timeline content</p>
      </MealTimelineSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Timeline' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('timeline content')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = jest.fn()
    render(
      <MealTimelineSheet open onClose={onClose}>
        <p>timeline content</p>
      </MealTimelineSheet>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on backdrop click', () => {
    const onClose = jest.fn()
    render(
      <MealTimelineSheet open onClose={onClose}>
        <p>timeline content</p>
      </MealTimelineSheet>,
    )
    fireEvent.click(screen.getByTestId('meal-timeline-sheet-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes via the header close button', () => {
    const onClose = jest.fn()
    render(
      <MealTimelineSheet open onClose={onClose}>
        <p>timeline content</p>
      </MealTimelineSheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close timeline' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps focus inside the panel — Tab from the last focusable wraps to the first', () => {
    render(
      <MealTimelineSheet open onClose={jest.fn()}>
        <button type="button">inside action</button>
      </MealTimelineSheet>,
    )
    const closeButton = screen.getByRole('button', { name: 'Close timeline' })
    const insideAction = screen.getByRole('button', { name: 'inside action' })

    insideAction.focus()
    expect(document.activeElement).toBe(insideAction)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)
  })
})
