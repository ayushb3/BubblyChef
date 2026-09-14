/**
 * Unit tests for the onboarding tour mechanics (issue #390).
 *
 *  1. Step definitions — structural checks on TOUR_STEPS.
 *  2. Auto-skip — TourOverlay advances when a step's target is missing from DOM.
 *  3. Pathname guard — TourProvider only auto-opens when pathname is '/'.
 *
 * Mocks are declared at top level so jest hoists them above the imports; the
 * components are imported statically so the test and the components share one
 * React instance (a jest.resetModules()/dynamic-import split loads React twice
 * and crashes with "Cannot read properties of null (reading 'useState')").
 * usePathname is controlled per-test via a mutable module-level variable.
 */

import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { TOUR_STEPS } from '@/components/onboarding/steps'
import { TourProvider, useTour } from '@/components/onboarding/TourProvider'
import { TourOverlay } from '@/components/onboarding/TourOverlay'

// --- Controllable pathname for the next/navigation mock ---
let mockPathname = '/'
const pushSpy = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: pushSpy }),
}))

// --- Supabase client mock; getUser resolution is set per-test ---
const getUserMock = jest.fn()
const updateUserMock = jest.fn().mockResolvedValue({})
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      updateUser: updateUserMock,
    },
  }),
}))

// jsdom has no matchMedia; TourOverlay's useReducedMotion needs it.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  })
  // jsdom does not implement scrollIntoView; measureTarget calls it on
  // non-fixed targets (e.g. the quick-actions step).
  Element.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  mockPathname = '/'
  pushSpy.mockClear()
  getUserMock.mockReset()
  updateUserMock.mockClear()
})

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
// We render TourProvider + TourOverlay and openTour() manually on step 0.
// Step 0's selector ([data-tour="hero"]) resolves to nothing in jsdom because
// HeroHome is not rendered. The overlay must auto-advance rather than freeze.
// getUser resolves with the flag already set so the provider does NOT also
// auto-open — the test drives openTour() itself.
// ---------------------------------------------------------------------------
describe('TourOverlay: auto-skip missing target', () => {
  it('advances from step 0 to step 1 when the step-0 target is absent', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { user_metadata: { onboarding_completed: true } } },
    })

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

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    await waitFor(() => {
      expect(Number(screen.getByTestId('step-index').textContent)).toBeGreaterThan(0)
    })
  })

  it('does NOT advance past step 1 on a missing step-0 target (re-entrancy guard)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { user_metadata: { onboarding_completed: true } } },
    })

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
// ---------------------------------------------------------------------------
describe('TourProvider: pathname guard', () => {
  it('does NOT call getUser when pathname is not "/"', async () => {
    mockPathname = '/recipes'
    getUserMock.mockResolvedValue({
      data: { user: { user_metadata: {} } },
    })

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

    expect(getUserMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('open-state').textContent).toBe('false')
  })

  it('calls getUser on "/" but keeps tour closed when flag is set', async () => {
    mockPathname = '/'
    getUserMock.mockResolvedValue({
      data: { user: { user_metadata: { onboarding_completed: true } } },
    })

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
      expect(getUserMock).toHaveBeenCalled()
    })

    expect(screen.getByTestId('open-state').textContent).toBe('false')
  })
})
