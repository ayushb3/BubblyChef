/**
 * Render tests for UnlockOffer (issue #522).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UnlockOffer from '@/components/kitchen/UnlockOffer'
import { useKitchenOffer } from '@/lib/api/kitchen'

jest.mock('@/lib/api/kitchen', () => ({
  useKitchenOffer: jest.fn(),
  claimUnlock: jest.fn(),
}))

const mockUseKitchenOffer = useKitchenOffer as jest.Mock

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('UnlockOffer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing while loading', () => {
    mockUseKitchenOffer.mockReturnValue({ data: undefined, isLoading: true })
    const { container } = renderWithQuery(<UnlockOffer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is no offer', () => {
    mockUseKitchenOffer.mockReturnValue({ data: null, isLoading: false })
    const { container } = renderWithQuery(<UnlockOffer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the milestone prompt and three options', () => {
    mockUseKitchenOffer.mockReturnValue({
      data: {
        milestone_key: 'm25',
        threshold: 25,
        options: [
          { id: 'a1', name: 'A One', slot: 'wall_shelf', emoji: '☕' },
          { id: 'a2', name: 'A Two', slot: 'window_sill', emoji: '🪴' },
          { id: 'a3', name: 'A Three', slot: 'rug', emoji: '🟪' },
        ],
      },
      isLoading: false,
    })

    renderWithQuery(<UnlockOffer />)

    expect(screen.getByText(/You reached 🫧 25!/)).toBeInTheDocument()
    expect(screen.getByText('A One')).toBeInTheDocument()
    expect(screen.getByText('A Two')).toBeInTheDocument()
    expect(screen.getByText('A Three')).toBeInTheDocument()
  })
})
