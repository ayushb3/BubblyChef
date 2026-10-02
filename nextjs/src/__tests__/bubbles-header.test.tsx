/**
 * Issue #894 — one header across Chat, Recipes and Scan. It reads "BubblyChef"
 * beside the cheerful mascot; tapping the mascot plays a short mirror-flip
 * reaction (still under reduced motion); and Scan draws this same header with
 * its own heading in the body.
 *
 * Behaviour, not markup: what is on screen, what a tap does over time, what
 * assistive tech is told.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let mockReduced = false
jest.mock('framer-motion', () => ({
  ...jest.requireActual('framer-motion'),
  useReducedMotion: () => mockReduced,
}))

jest.mock('@/components/layout/NotificationBell', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="Notifications" />,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/api/scan')

import BubblesHeader, { REACTION_MS } from '@/components/layout/BubblesHeader'
import ScanPage from '@/app/scan/page'

const isMirrored = (img: HTMLElement) => img.style.transform.replace(/\s/g, '') === 'scaleX(-1)'
const mascotImg = () => screen.getByRole('button', { name: 'Say hi to Bubbly' }).querySelector('img') as HTMLElement

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  mockReduced = false
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('BubblesHeader (#894)', () => {
  it('is titled BubblyChef, with the page controls beside the bell', () => {
    render(<BubblesHeader rightSlot={<button type="button">Cancel</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'BubblyChef' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('never calls the mascot Bubbles', () => {
    const { container } = render(<BubblesHeader />)
    expect(container.textContent).not.toMatch(/Bubbles/)
    expect(mascotImg().getAttribute('alt')).toBe('Bubbly celebrate')
  })

  it('shows the cheerful pose at rest and the thinking pose while a reply streams', () => {
    const { rerender } = render(<BubblesHeader />)
    expect(mascotImg().getAttribute('src')).toContain('bubbles-celebrate')
    rerender(<BubblesHeader thinking />)
    expect(mascotImg().getAttribute('alt')).toBe('Bubbly thinking')
  })

  it('does not fire the one-shot celebrate burst on mount: a gentle bob only', () => {
    render(<BubblesHeader />)
    expect(screen.queryByTestId('bubbles-sparkle-burst')).toBeNull()
  })

  it('the mascot is a 44 px keyboard-operable button', () => {
    render(<BubblesHeader />)
    const button = screen.getByRole('button', { name: 'Say hi to Bubbly' })
    expect(button.className).toMatch(/\bh-11\b/)
    expect(button.className).toMatch(/\bw-11\b/)
    expect(button).toHaveAttribute('type', 'button')
  })

  it('a tap flips the mascot for about 600 ms, then it is still again', () => {
    render(<BubblesHeader />)
    const img = mascotImg()
    expect(REACTION_MS).toBeGreaterThanOrEqual(500)
    expect(REACTION_MS).toBeLessThanOrEqual(700)

    // Idle: the original frame, however long we wait.
    advance(2000)
    expect(isMirrored(img)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Say hi to Bubbly' }))
    expect(isMirrored(img)).toBe(false)
    advance(160)
    expect(isMirrored(img)).toBe(true)

    // Past the reaction the flip stops and holds the original image.
    advance(REACTION_MS)
    expect(isMirrored(img)).toBe(false)
    advance(1000)
    expect(isMirrored(img)).toBe(false)
  })

  it('under reduced motion a tap changes nothing on screen', () => {
    mockReduced = true
    render(<BubblesHeader />)
    const img = mascotImg()
    fireEvent.click(screen.getByRole('button', { name: 'Say hi to Bubbly' }))
    advance(160)
    expect(isMirrored(img)).toBe(false)
    advance(REACTION_MS)
    expect(isMirrored(img)).toBe(false)
  })
})

describe('/scan draws the same header (#894)', () => {
  it('shows BubblyChef as the h1 and "Scan a receipt" as the page heading in the body', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ScanPage />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'BubblyChef' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Scan a receipt' })).toBeInTheDocument()
    // The right slot is the Recipes tab's profile button; no Cancel (#905).
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Say hi to Bubbly' })).toBeInTheDocument()
  })
})
