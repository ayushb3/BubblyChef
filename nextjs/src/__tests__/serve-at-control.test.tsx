/**
 * Issue #652 — component tests for `ServeAtControl`: the start-now/serve-at
 * toggle, the time input, the too-late message, and "Use <earliest>" calling
 * back with an "HH:MM" time.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ServeAtControl from '@/components/meal/ServeAtControl'
import type { MealAnchorResult } from '@/lib/meal-anchor'

const RELATIVE: MealAnchorResult = { status: 'relative' }

describe('ServeAtControl', () => {
  it('toggles between start-now and serve-at, calling onModeChange', () => {
    const onModeChange = jest.fn()
    render(
      <ServeAtControl
        mode="start-now"
        serveAt="18:00"
        anchor={RELATIVE}
        onModeChange={onModeChange}
        onServeAtChange={jest.fn()}
      />,
    )
    const startNow = screen.getByRole('radio', { name: 'Start now' })
    const serveAt = screen.getByRole('radio', { name: 'Serve at' })
    expect(startNow).toHaveAttribute('aria-checked', 'true')
    expect(serveAt).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(serveAt)
    expect(onModeChange).toHaveBeenCalledWith('serve-at')
  })

  it('hides the time input in start-now mode and shows it in serve-at mode', () => {
    const { rerender } = render(
      <ServeAtControl
        mode="start-now"
        serveAt="18:00"
        anchor={RELATIVE}
        onModeChange={jest.fn()}
        onServeAtChange={jest.fn()}
      />,
    )
    expect(screen.queryByLabelText('Serve at time')).not.toBeInTheDocument()

    rerender(
      <ServeAtControl
        mode="serve-at"
        serveAt="18:00"
        anchor={RELATIVE}
        onModeChange={jest.fn()}
        onServeAtChange={jest.fn()}
      />,
    )
    expect(screen.getByLabelText('Serve at time')).toHaveValue('18:00')
  })

  it('calls onServeAtChange when the time input changes', () => {
    const onServeAtChange = jest.fn()
    render(
      <ServeAtControl
        mode="serve-at"
        serveAt="18:00"
        anchor={RELATIVE}
        onModeChange={jest.fn()}
        onServeAtChange={onServeAtChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Serve at time'), { target: { value: '19:30' } })
    expect(onServeAtChange).toHaveBeenCalledWith('19:30')
  })

  it('shows no too-late message for a relative or clock anchor', () => {
    render(
      <ServeAtControl
        mode="start-now"
        serveAt="18:00"
        anchor={RELATIVE}
        onModeChange={jest.fn()}
        onServeAtChange={jest.fn()}
      />,
    )
    expect(screen.queryByTestId('serve-at-too-late')).not.toBeInTheDocument()
  })

  it('shows the too-late copy (no duration) and a "Use <earliest>" button that reports HH:MM back, when totalMinutes is absent', () => {
    const onServeAtChange = jest.fn()
    const earliest = new Date('2026-09-29T01:03:00')
    render(
      <ServeAtControl
        mode="serve-at"
        serveAt="00:15"
        anchor={{ status: 'too_late', earliest_ready_at: earliest }}
        onModeChange={jest.fn()}
        onServeAtChange={onServeAtChange}
      />,
    )
    const banner = screen.getByTestId('serve-at-too-late')
    expect(banner).toHaveTextContent(/too soon/i)
    expect(banner).toHaveTextContent('1:03 AM')
    expect(banner).not.toHaveTextContent(/needs/i)

    fireEvent.click(screen.getByRole('button', { name: /Use 1:03 AM/ }))
    expect(onServeAtChange).toHaveBeenCalledWith('01:03')
  })

  it('matches the #649 wording exactly ("this meal needs {N} minutes") when totalMinutes is given', () => {
    const earliest = new Date('2026-09-29T01:03:00')
    render(
      <ServeAtControl
        mode="serve-at"
        serveAt="00:15"
        anchor={{ status: 'too_late', earliest_ready_at: earliest }}
        onModeChange={jest.fn()}
        onServeAtChange={jest.fn()}
        totalMinutes={20}
      />,
    )
    expect(screen.getByTestId('serve-at-too-late')).toHaveTextContent(
      "That's too soon — this meal needs 20 minutes. The earliest it could be ready is 1:03 AM.",
    )
  })
})
