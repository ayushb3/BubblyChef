/**
 * Issue #135 — dead-air after sign-in.
 *
 * Covers the two halves of the fix:
 *  1. `app/loading.tsx` renders a theme-safe skeleton (no hardcoded palette hexes).
 *  2. `HeroHome` paints the greeting / mascot / tip immediately instead of
 *     blocking the whole hero behind one all-or-nothing `loading` flag.
 */
import { render, screen, waitFor } from '@testing-library/react'
import Loading from '@/app/loading'
import ProfileLoading from '@/app/profile/loading'
import HeroHome from '@/components/dashboard/HeroHome'

// Any 6- or 3-digit hex colour literal. The 5-theme system means the skeleton
// must resolve every colour through a CSS custom property.
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

describe('app/loading.tsx', () => {
  it('renders a labelled loading state', () => {
    render(<Loading />)
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
  })

  it('uses pulse skeletons', () => {
    const { container } = render(<Loading />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('opts skeletons out of animation under reduced motion', () => {
    const { container } = render(<Loading />)
    const pulses = Array.from(container.querySelectorAll('.animate-pulse'))
    expect(pulses.every((el) => el.classList.contains('motion-reduce:animate-none'))).toBe(true)
  })

  it('contains no hardcoded palette colours (works across all 5 themes)', () => {
    const { container } = render(<Loading />)
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      const inline = el.getAttribute('style') ?? ''
      const classes = el.getAttribute('class') ?? ''
      expect(inline).not.toMatch(HEX_COLOR)
      expect(classes).not.toMatch(HEX_COLOR)
    }
  })
})

describe('app/profile/loading.tsx', () => {
  it('renders a labelled loading state', () => {
    render(<ProfileLoading />)
    expect(screen.getByRole('status', { name: /loading profile/i })).toBeInTheDocument()
  })

  it('opts skeletons out of animation under reduced motion', () => {
    const { container } = render(<ProfileLoading />)
    const pulses = Array.from(container.querySelectorAll('.animate-pulse'))
    expect(pulses.length).toBeGreaterThan(0)
    expect(pulses.every((el) => el.classList.contains('motion-reduce:animate-none'))).toBe(true)
  })

  it('contains no hardcoded palette colours (works across all 5 themes)', () => {
    const { container } = render(<ProfileLoading />)
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      expect(el.getAttribute('style') ?? '').not.toMatch(HEX_COLOR)
      expect(el.getAttribute('class') ?? '').not.toMatch(HEX_COLOR)
    }
  })

  it('is profile-shaped, not dashboard-shaped', () => {
    const { container } = render(<ProfileLoading />)
    // The profile page opens with the chowder header strip + overlapping avatar.
    expect(container.querySelector('.chowder-panel')).not.toBeNull()
    // The dashboard fallback's three-up action card row must NOT appear here.
    expect(container.querySelector('.grid-cols-3')).toBeNull()
  })
})

describe('HeroHome progressive paint', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('paints the greeting, mascot and tip while the data fetches are still pending', () => {
    // Never-resolving fetches: this is the "still loading" frame.
    global.fetch = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch

    render(<HeroHome displayName="ayush" />)

    // Greeting + name are known server-side, so they must be on screen already.
    expect(screen.getByText('ayush')).toBeInTheDocument()
    expect(screen.getByAltText(/^Bubbles /)).toBeInTheDocument()
    expect(screen.getByText(/Tip:/)).toBeInTheDocument()

    // ...while the data-dependent hero message is still a skeleton.
    expect(screen.queryByText(/How about|expires|pantry is empty|looking great/)).toBeNull()
  })

  it('fills in the data-dependent hero message once the fetches resolve', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) return jsonResponse({ items: [], count: 0 })
      if (url.includes('/api/pantry')) return jsonResponse({ items: [], total_count: 0 })
      return jsonResponse({ recipes: [], total_count: 0 })
    }) as unknown as typeof fetch

    render(<HeroHome displayName="ayush" />)

    await waitFor(() =>
      expect(screen.getByText(/Your pantry is empty/)).toBeInTheDocument()
    )
    // Greeting never disappeared during the transition.
    expect(screen.getByText('ayush')).toBeInTheDocument()
  })
})
