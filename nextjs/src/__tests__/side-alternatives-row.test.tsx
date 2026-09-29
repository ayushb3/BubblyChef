/**
 * Issue #652 — component tests for `SideAlternativesRow`: the
 * loading/error/ready states, `onPick(index)`, pending disabling the other
 * cards, retry, and cancel.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import SideAlternativesRow, { type SideAlternative } from '@/components/meal/SideAlternativesRow'

const ALTERNATIVES: SideAlternative[] = [
  { name: 'Charred broccolini', blurb: 'Smoky, 10 minutes, uses the lemon.', key_ingredients: ['broccolini'], est_total_minutes: 12, est_hands_on_minutes: 6 },
  { name: 'Garlic green beans', blurb: 'Fast and crisp.', key_ingredients: ['green beans'], est_total_minutes: 8, est_hands_on_minutes: 8 },
  { name: 'Roasted carrots', blurb: '', key_ingredients: ['carrots'], est_total_minutes: null, est_hands_on_minutes: null },
]

describe('SideAlternativesRow', () => {
  it('shows 3 skeleton cards while loading', () => {
    render(
      <SideAlternativesRow
        state="loading"
        alternatives={[]}
        onPick={jest.fn()}
        onRetry={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    expect(screen.getAllByTestId('side-alternative-skeleton')).toHaveLength(3)
  })

  it('shows the error message and a Retry button', () => {
    const onRetry = jest.fn()
    render(
      <SideAlternativesRow
        state="error"
        alternatives={[]}
        errorMessage="Couldn't reach the kitchen."
        onPick={jest.fn()}
        onRetry={onRetry}
        onCancel={jest.fn()}
      />,
    )
    expect(screen.getByText("Couldn't reach the kitchen.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('falls back to a generic error message when none is given', () => {
    render(
      <SideAlternativesRow state="error" alternatives={[]} onPick={jest.fn()} onRetry={jest.fn()} onCancel={jest.fn()} />,
    )
    expect(screen.getByText(/couldn't load alternatives/i)).toBeInTheDocument()
  })

  it('renders each ready alternative with name, blurb, and est. time, hiding the time when null', () => {
    render(
      <SideAlternativesRow
        state="ready"
        alternatives={ALTERNATIVES}
        onPick={jest.fn()}
        onRetry={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    expect(screen.getByText('Charred broccolini')).toBeInTheDocument()
    expect(screen.getByText('Smoky, 10 minutes, uses the lemon.')).toBeInTheDocument()
    expect(screen.getByText('⏱ 12 min')).toBeInTheDocument()
    expect(screen.getByText('⏱ 8 min')).toBeInTheDocument()
    // The third alternative has no estimate — no "null min" anywhere.
    expect(screen.queryByText(/null/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('calls onPick with the tapped card index', () => {
    const onPick = jest.fn()
    render(
      <SideAlternativesRow
        state="ready"
        alternatives={ALTERNATIVES}
        onPick={onPick}
        onRetry={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('listitem', { name: 'Pick Garlic green beans' }))
    expect(onPick).toHaveBeenCalledWith(1)
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('shows the pending card as busy and disables the others', () => {
    const onPick = jest.fn()
    render(
      <SideAlternativesRow
        state="ready"
        alternatives={ALTERNATIVES}
        pendingIndex={0}
        onPick={onPick}
        onRetry={jest.fn()}
        onCancel={jest.fn()}
      />,
    )
    const pending = screen.getByRole('listitem', { name: /Building Charred broccolini/ })
    expect(pending).toBeDisabled()
    expect(pending).toHaveAttribute('aria-busy', 'true')

    const other = screen.getByRole('listitem', { name: 'Pick Garlic green beans' })
    expect(other).toBeDisabled()
    fireEvent.click(other)
    expect(onPick).not.toHaveBeenCalled()

    expect(screen.getByRole('status')).toHaveTextContent('Building Charred broccolini…')
    // An in-flight expand can't be aborted, so Cancel is disabled until it settles.
    expect(screen.getByRole('button', { name: 'Cancel choosing an alternative' })).toBeDisabled()
  })

  it('calls onCancel from the Cancel control', () => {
    const onCancel = jest.fn()
    render(
      <SideAlternativesRow
        state="ready"
        alternatives={ALTERNATIVES}
        onPick={jest.fn()}
        onRetry={jest.fn()}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
