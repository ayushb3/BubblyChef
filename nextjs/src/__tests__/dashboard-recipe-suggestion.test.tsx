/**
 * Regression tests for HeroHome's tip + suggestion, covering #225 (tip was a
 * hardcoded weekday array, identical for every user) and #168 (suggestion was
 * uniform-random, not time- or pantry-aware) — both now sourced from
 * `GET /v1/dashboard/daily` via `lib/api/dashboard.ts`.
 *
 * #306's deep-link fix (the "Open recipe" action linking to the specific
 * recipe, not the bare `/recipes` list) must not regress now that the
 * suggestion's source changed from a client-side `pickRandomRecipe` over
 * `/api/recipes` to the AI service's ranked pick.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import HeroHome from '@/components/dashboard/HeroHome'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

const nonEmptyPantry = () => jsonResponse({ items: [{ id: 'p1', name: 'eggs' }], total_count: 1 })
const noExpiring = () => jsonResponse({ items: [], count: 0 })

describe('HeroHome suggestion href (#168, #306 no-regression)', () => {
  // Deliberately does NOT already state the time figure, so this fixture
  // exercises the "Only N min!" append path distinctly from the
  // no-duplication fixture below.
  const suggestion = {
    recipe_id: 'recipe-abc-123',
    title: 'Lemon Garlic Pasta',
    total_time_minutes: 25,
    copy: 'Your lemon is about to turn — this pasta uses it up fast.',
    reason: 'expiring' as const,
  }

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) return noExpiring()
      if (url.includes('/api/pantry')) return nonEmptyPantry()
      if (url.includes('/api/ai/dashboard/daily')) {
        return jsonResponse({
          tip: { text: 'Zest citrus before juicing it.', category: 'technique' },
          suggestion,
          generated_at: '2026-09-05T08:00:00Z',
          source: 'ai',
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch
  })

  it('links the hero action to the specific recipe, not the bare list', async () => {
    render(<HeroHome displayName="ayush" />)

    const link = await screen.findByRole('link', { name: /open recipe/i })
    expect(link.getAttribute('href')).toBe(`/recipes/${suggestion.recipe_id}`)
    expect(link.getAttribute('href')).not.toBe('/recipes')
  })

  it('renders the suggestion copy from the endpoint in the hero message', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() =>
      expect(screen.getByText(/uses it up fast/i)).toBeInTheDocument()
    )
  })

  it('appends "Only N min!" once when the copy does not already state the time', async () => {
    render(<HeroHome displayName="ayush" />)

    const message = await screen.findByText(/uses it up fast/i)
    expect(message.textContent).toBe(
      'Your lemon is about to turn — this pasta uses it up fast. Only 25 min!'
    )
  })
})

describe('HeroHome suggestion copy that already states the time (#225 spec-review finding 2)', () => {
  // The backend's own templated fallback copy ends with "... ready in {N} min.",
  // so an unconditional append duplicates the figure:
  // "Lemon Garlic Pasta — ready in 25 min. Only 25 min!" This fixture pins that
  // the frontend does not append a second, redundant mention of the same number.
  const suggestion = {
    recipe_id: 'recipe-abc-123',
    title: 'Lemon Garlic Pasta',
    total_time_minutes: 25,
    copy: 'Lemon Garlic Pasta — ready in 25 min.',
    reason: 'fallback' as const,
  }

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) return noExpiring()
      if (url.includes('/api/pantry')) return nonEmptyPantry()
      if (url.includes('/api/ai/dashboard/daily')) {
        return jsonResponse({
          tip: { text: 'Zest citrus before juicing it.', category: 'technique' },
          suggestion,
          generated_at: '2026-09-05T08:00:00Z',
          source: 'fallback',
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch
  })

  it('does not duplicate the minute figure when the copy already states it', async () => {
    render(<HeroHome displayName="ayush" />)

    const message = await screen.findByText(/ready in 25 min/i)
    // The number "25" must appear exactly once in the rendered message.
    expect(message.textContent?.match(/25/g)?.length).toBe(1)
    expect(message.textContent).toBe('Lemon Garlic Pasta — ready in 25 min.')
    expect(message.textContent).not.toMatch(/Only 25 min!/)
  })
})

describe('HeroHome suggestion: null (#168)', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) return noExpiring()
      if (url.includes('/api/pantry')) return nonEmptyPantry()
      if (url.includes('/api/ai/dashboard/daily')) {
        return jsonResponse({
          tip: { text: 'Taste as you cook.', category: 'technique' },
          suggestion: null,
          generated_at: '2026-09-05T08:00:00Z',
          source: 'ai',
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch
  })

  it('does not render an "Open recipe" link when suggestion is null', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /open recipe/i })).toBeNull()
  })

  it('renders without throwing when suggestion is null', async () => {
    expect(() => render(<HeroHome displayName="ayush" />)).not.toThrow()
  })
})

describe('HeroHome tip sourced from the endpoint, not the static array (#225)', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) return noExpiring()
      if (url.includes('/api/pantry')) return nonEmptyPantry()
      if (url.includes('/api/ai/dashboard/daily')) {
        return jsonResponse({
          tip: { text: 'This tip only exists on the server, never in the static list.', category: 'pantry' },
          suggestion: null,
          generated_at: '2026-09-05T08:00:00Z',
          source: 'ai',
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch
  })

  it('renders the endpoint tip text, which is not a member of the static fallback list', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() =>
      expect(
        screen.getByText(/this tip only exists on the server/i)
      ).toBeInTheDocument()
    )
  })
})

describe('HeroHome tip fallback when the dashboard request fails (#225)', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring')) return noExpiring()
      if (url.includes('/api/pantry')) return nonEmptyPantry()
      if (url.includes('/api/ai/dashboard/daily')) {
        return jsonResponse({ error: 'AI service unreachable' }, false)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch
  })

  it('still renders a tip from the static fallback list, with no error surfaced', async () => {
    render(<HeroHome displayName="ayush" />)

    // One of the static FALLBACK_TIPS strings should be on screen.
    await waitFor(() =>
      expect(
        screen.getByText(/season your pan|let meat rest|freeze herbs|toast spices|pasta water|green onions|taste as you cook/i)
      ).toBeInTheDocument()
    )
    // No error text, no thrown render.
    expect(screen.queryByText(/error/i)).toBeNull()
  })

  it('does not render an "Open recipe" link (no suggestion to fall back to)', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /open recipe/i })).toBeNull()
  })
})

describe('HeroHome hero priority — suggestion beats urgent expiry (#347)', () => {
  const suggestion = {
    recipe_id: 'recipe-xyz-999',
    title: 'Spinach Frittata',
    total_time_minutes: 20,
    copy: 'A quick frittata for your spinach.',
    reason: 'expiring' as const,
  }
  const urgentExpiringItem = {
    id: 'item-1',
    name: 'spinach',
    days_until_expiry: 0,
    is_expiring_soon: true,
    expiry_date: new Date().toISOString().slice(0, 10),
  }

  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pantry/expiring'))
        return jsonResponse({ items: [urgentExpiringItem], count: 1 })
      if (url.includes('/api/pantry'))
        return jsonResponse({ items: [urgentExpiringItem], total_count: 1 })
      if (url.includes('/api/ai/dashboard/daily'))
        return jsonResponse({ tip: { text: 'Great tip!' }, suggestion })
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch
  })

  it('shows suggestion copy, not the expiry headline, when both exist', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() => screen.getByText('A quick frittata for your spinach. Only 20 min!'))
    // Urgent-expiry headline must be suppressed
    expect(screen.queryByText(/expires today/i)).toBeNull()
    expect(screen.queryByText(/expires tomorrow/i)).toBeNull()
  })

  it('links to the recipe, not the cook-this-now deep-link, when suggestion exists', async () => {
    render(<HeroHome displayName="ayush" />)

    await waitFor(() => screen.getByRole('link', { name: /open recipe/i }))
    const link = screen.getByRole('link', { name: /open recipe/i }) as HTMLAnchorElement
    expect(link.href).toContain('/recipes/recipe-xyz-999')
  })
})
