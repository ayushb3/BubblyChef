/**
 * Issue #140 — "Used it up" / "Tossed it" pantry item resolve actions.
 *
 * `ResolveActions` is the shared control used by both the pantry grid
 * (`app/pantry/page.tsx`) and the Use Soon triage view
 * (`app/pantry/use-soon/page.tsx`), so it's covered here in isolation rather
 * than duplicated per call site.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ResolveActions from '@/components/pantry/ResolveActions'
import { resolvePantryItem } from '@/lib/api/pantry'

jest.mock('@/lib/api/pantry', () => ({
  resolvePantryItem: jest.fn(),
}))

const mockResolve = resolvePantryItem as jest.Mock

describe('ResolveActions', () => {
  beforeEach(() => {
    mockResolve.mockReset()
  })

  it('"Used it up" resolves immediately — no confirm step', async () => {
    mockResolve.mockResolvedValue({ resolved: true, id: 'p1', outcome: 'used', event_id: 'e1' })
    const onResolved = jest.fn()

    render(<ResolveActions itemId="p1" itemName="eggs" onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: /mark eggs used up/i }))

    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('p1', 'used'))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('"Tossed it" requires a second, explicit tap before resolving', async () => {
    mockResolve.mockResolvedValue({ resolved: true, id: 'p1', outcome: 'tossed', event_id: 'e2' })
    const onResolved = jest.fn()

    render(<ResolveActions itemId="p1" itemName="milk" onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: /toss milk/i }))
    // First tap only opens the inline confirm — nothing resolved yet.
    expect(mockResolve).not.toHaveBeenCalled()
    expect(screen.getByText(/toss milk\?/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /yes, toss it/i }))

    await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('p1', 'tossed'))
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('"Cancel" backs out of the toss confirm without resolving', async () => {
    render(<ResolveActions itemId="p1" itemName="milk" onResolved={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /toss milk/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.getByRole('button', { name: /mark milk used up/i })).toBeInTheDocument()
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('disables both actions while a resolve is in flight (no double-tap)', async () => {
    let resolveRequest!: (value: unknown) => void
    mockResolve.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))

    render(<ResolveActions itemId="p1" itemName="eggs" onResolved={jest.fn()} />)

    const usedButton = screen.getByRole('button', { name: /mark eggs used up/i })
    fireEvent.click(usedButton)
    fireEvent.click(usedButton)

    expect(mockResolve).toHaveBeenCalledTimes(1)

    resolveRequest({ resolved: true, id: 'p1', outcome: 'used', event_id: 'e1' })
    await waitFor(() => {})
  })

  it('surfaces a failed resolve instead of swallowing it', async () => {
    mockResolve.mockRejectedValue(
      new Error('Recorded the event but failed to remove the item from the pantry'),
    )
    const onResolved = jest.fn()

    render(<ResolveActions itemId="p1" itemName="bread" onResolved={onResolved} />)

    fireEvent.click(screen.getByRole('button', { name: /mark bread used up/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/recorded the event but failed to remove/i)
    // The row must not be treated as cleared — the caller's refetch was never triggered.
    expect(onResolved).not.toHaveBeenCalled()
    // ...and the controls come back so the user can retry.
    expect(screen.getByRole('button', { name: /mark bread used up/i })).not.toBeDisabled()
  })
})
