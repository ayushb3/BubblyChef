/**
 * Render tests for UnlockOffer (issue #522).
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import UnlockOffer from '@/components/kitchen/UnlockOffer'
import { useKitchenOffer, claimUnlock } from '@/lib/api/kitchen'

jest.mock('@/lib/api/kitchen', () => ({
  useKitchenOffer: jest.fn(),
  claimUnlock: jest.fn(),
}))

const mockUseKitchenOffer = useKitchenOffer as jest.Mock
const mockClaimUnlock = claimUnlock as jest.Mock

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

  it('shows the next pending milestone offer after claiming one', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const offerM25 = {
      milestone_key: 'm25',
      threshold: 25,
      options: [
        { id: 'a1', name: 'A One', slot: 'wall_shelf', emoji: '☕' },
        { id: 'a2', name: 'A Two', slot: 'window_sill', emoji: '🪴' },
        { id: 'a3', name: 'A Three', slot: 'rug', emoji: '🟪' },
      ],
    }
    const offerM60 = {
      milestone_key: 'm60',
      threshold: 60,
      options: [
        { id: 'b1', name: 'B One', slot: 'wall_shelf', emoji: '🖼️' },
        { id: 'b2', name: 'B Two', slot: 'window_sill', emoji: '🌵' },
        { id: 'b3', name: 'B Three', slot: 'rug', emoji: '🟩' },
      ],
    }

    mockUseKitchenOffer.mockReturnValue({ data: offerM25, isLoading: false })
    mockClaimUnlock.mockResolvedValue({ id: 'a1', name: 'A One' })

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <UnlockOffer />
      </QueryClientProvider>,
    )

    expect(screen.getByText(/You reached 🫧 25!/)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('A One'))
    })

    await waitFor(() => expect(mockClaimUnlock).toHaveBeenCalledWith('m25', 'a1'))

    // Simulate the invalidated `['kitchen-offer']` query refetching and
    // returning the next pending milestone.
    mockUseKitchenOffer.mockReturnValue({ data: offerM60, isLoading: false })
    await act(async () => {
      rerender(
        <QueryClientProvider client={client}>
          <UnlockOffer />
        </QueryClientProvider>,
      )
    })

    await waitFor(() => expect(screen.getByText(/You reached 🫧 60!/)).toBeInTheDocument())
    expect(screen.getByText('B One')).toBeInTheDocument()
  })
})
