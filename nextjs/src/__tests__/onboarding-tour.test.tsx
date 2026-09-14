/**
 * Unit tests for the onboarding tour mechanics (issue #390).
 *
 *  1. Step definitions — structural checks on TOUR_STEPS.
 *  2. Auto-skip — TourOverlay advances when a step's target is missing from DOM.
 *  3. Pathname guard — TourProvider only auto-opens when pathname is '/'.
 */

import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { TOUR_STEPS } from '@/components/onboarding/steps'

// ---------------------------------------------------------------------------
// 1. Step definitions
// ---------------------------------------------------------------------------
describe('TOUR_STEPS definitions', () => {
  it('all selectors match [data-tour="..."] pattern', () => {
    for (const step of TOUR_STEPS) {
      expect(step.selector).toMatch(/^\[data-tour="[^"]+"\]$/)
    }
  })

  it('6 steps defined with correct ids in order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'hero',
      'quick-actions',
      'nav-pantry',
      'nav-recipes',
      'nav-chat',
      'profile',
    ])
  })

  it('placement is above for bottom-nav steps, below for header/hero', () => {
    const above = TOUR_STEPS.filter((s) => s.placement === 'above').map((s) => s.id)
    const below = TOUR_STEPS.filter((s) => s.placement === 'below').map((s) => s.id)
    expect(above).toEqual(['nav-pantry', 'nav-recipes', 'nav-chat'])
    expect(below).toEqual(['hero', 'quick-actions', 'profile'])
  })
})

// ---------------------------------------------------------------------------
// 2. Auto-skip — TourOverlay advances when step target absent from DOM
//
// We render TourProvider + TourOverlay with isOpen=true on step 0.
// Step 0's selector ([data-tour="hero"]) resolves to nothing in jsdom because
// HeroHome is not rendered. The overlay must auto-advance to step 1 rather
// than freezing on an empty tooltip.
// ---------------------------------------------------------------------------
describe('TourOverlay: auto-skip missing target', () => {
  // Mock the supabase client so TourProvider can mount without real network.
  beforeEach(() => {
    jest.mock('@/lib/supabase/client', () => ({
      createClient: () => ({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            // Completed flag = true so provider does NOT auto-open;
            // we will call openTour() manually to control the test.
            data: { user: { user_metadata: { onboarding_completed: true } } },
          }),
          updateUser: jest.fn().mockResolvedValue({}),
        },
      }),
    }))
  })

  afterEach(() => {
    jest.resetModules()
  })

  it('advances from step 0 to step 1 when the step-0 target is absent', async () => {
    // Dynamic import after mock is set.
    const { TourProvider, useTour } = await import('@/components/onboarding/TourProvider')
    const { TourOverlay } = await import('@/components/onboarding/TourOverlay')

    // An inspector that also triggers openTour on mount.
    function Harness() {
      const { stepIndex, openTour, isOpen } = useTour()
      React.useEffect(() => {
        openTour()
      }, [openTour])
      return (
        <div>
          <div data-testid="is-open">{String(isOpen)}</div>
          <div data-testid="step-index">{stepIndex}</div>
          {/* Intentionally NOT rendering any [data-tour="hero"] element */}
        </div>
      )
    }

    await act(async () => {
      render(
        <TourProvider>
          <Harness />
          <TourOverlay />
        </TourProvider>,
      )
    })

    // Give requestAnimationFrame a chance to fire (jsdom uses microtasks).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    // Step 0 target is missing — the overlay should have advanced to step 1.
    await waitFor(() => {
      expect(Number(screen.getByTestId('step-index').textContent)).toBeGreaterThan(0)
    })
  })

  it('does NOT advance past step 1 on a missing step-0 target (re-entrancy guard)', async () => {
    const { TourProvider, useTour } = await import('@/components/onboarding/TourProvider')
    const { TourOverlay } = await import('@/components/onboarding/TourOverlay')

    function Harness() {
      const { stepIndex, openTour, isOpen } = useTour()
      React.useEffect(() => {
        openTour()
      }, [openTour])

      return (
        <div>
          <div data-testid="is-open">{String(isOpen)}</div>
          <div data-testid="step-index">{stepIndex}</div>
          {/* step-1 target present so the auto-skip stops at index 1 */}
          <div data-tour="quick-actions" />
        </div>
      )
    }

    await act(async () => {
      render(
        <TourProvider>
          <Harness />
          <TourOverlay />
        </TourProvider>,
      )
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    // The skippedStepRef guard ensures each stepIndex auto-skips at most once, so
    // a missing step-0 target advances to step 1 and then stops (step-1 target
    // exists) — it must NOT run away toward totalSteps.
    const finalStep = Number(screen.getByTestId('step-index').textContent)
    expect(finalStep).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 3. TourProvider: pathname guard blocks auto-open off '/'
//
// TourProvider reads usePathname() (Next.js hook). In tests usePathname() is
// mocked via jest.mock('next/navigation').
// ---------------------------------------------------------------------------
describe('TourProvider: pathname guard', () => {
  afterEach(() => {
    jest.resetModules()
  })

  it('does NOT call getUser when pathname is not "/"', async () => {
    jest.mock('next/navigation', () => ({
      usePathname: () => '/recipes',
      useRouter: () => ({ push: jest.fn() }),
    }))

    const supabaseMock = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { user_metadata: {} } },
        }),
        updateUser: jest.fn(),
      },
    }
    jest.mock('@/lib/supabase/client', () => ({
      createClient: () => supabaseMock,
    }))

    const { TourProvider, useTour } = await import('@/components/onboarding/TourProvider')

    function Inspector() {
      const { isOpen } = useTour()
      return <div data-testid="open-state">{String(isOpen)}</div>
    }

    await act(async () => {
      render(
        <TourProvider>
          <Inspector />
        </TourProvider>,
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('open-state')).toBeDefined()
    })

    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled()
    expect(screen.getByTestId('open-state').textContent).toBe('false')
  })

  it('calls getUser on "/" but keeps tour closed when flag is set', async () => {
    jest.mock('next/navigation', () => ({
      usePathname: () => '/',
      useRouter: () => ({ push: jest.fn() }),
    }))

    const supabaseMock = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { user_metadata: { onboarding_completed: true } } },
        }),
        updateUser: jest.fn(),
      },
    }
    jest.mock('@/lib/supabase/client', () => ({
      createClient: () => supabaseMock,
    }))

    const { TourProvider, useTour } = await import('@/components/onboarding/TourProvider')

    function Inspector() {
      const { isOpen } = useTour()
      return <div data-testid="open-state">{String(isOpen)}</div>
    }

    await act(async () => {
      render(
        <TourProvider>
          <Inspector />
        </TourProvider>,
      )
    })

    await waitFor(() => {
      expect(supabaseMock.auth.getUser).toHaveBeenCalled()
    })

    expect(screen.getByTestId('open-state').textContent).toBe('false')
  })
})
