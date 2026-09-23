/**
 * Issue #439 — the inactive tab panel in `PantryAddSheet` was hidden with
 * opacity/pointer-events only, so its controls stayed in the tab order and
 * the accessibility tree: a keyboard user could Tab from the Type tab
 * straight into the invisible Scan panel's file input. Reproduced in a
 * running build by Tab-ing through the sheet with Type active and landing
 * on a control that wasn't visible on screen.
 *
 * Fix: the inactive wrapper now carries the `inert` attribute, which pulls
 * it (and everything inside it) out of both the tab order and the
 * accessibility tree in one go.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PantryAddSheet from '@/components/pantry/PantryAddSheet'

jest.mock('@/lib/api/scan')
jest.mock('@/lib/api/pantry')
jest.mock('@/lib/api/foods')

function renderSheet(props: React.ComponentProps<typeof PantryAddSheet>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PantryAddSheet {...props} />
    </QueryClientProvider>,
  )
}

it('the inactive Scan panel is inert while the Type tab is active', () => {
  renderSheet({ isOpen: true, onClose: jest.fn(), initialTab: 'type', onItemsAdded: jest.fn() })

  // The Scan tab's file input stays mounted (issue #402 — both tabs persist
  // state) but must be unreachable by keyboard while Type is active.
  const fileInput = document.querySelector('input[type="file"]') as HTMLElement
  expect(fileInput).toBeInTheDocument()

  const inertWrapper = fileInput.closest('[inert]')
  expect(inertWrapper).not.toBeNull()

  // The active Type panel's own input must NOT be inert.
  const nameInput = screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)')
  expect(nameInput.closest('[inert]')).toBeNull()
})

it('the inactive Type panel is inert while the Scan tab is active', () => {
  renderSheet({ isOpen: true, onClose: jest.fn(), initialTab: 'scan', onItemsAdded: jest.fn() })

  const nameInput = screen.getByPlaceholderText('Item name (e.g. Milk, Eggs...)')
  expect(nameInput.closest('[inert]')).not.toBeNull()

  const fileInput = document.querySelector('input[type="file"]') as HTMLElement
  expect(fileInput.closest('[inert]')).toBeNull()
})
