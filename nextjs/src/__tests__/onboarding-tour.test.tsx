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
import { TourOverlay, TARGET_WAIT_MS } from '@/components/onboarding/TourOverlay'

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
      'nav-chat',
      'nav-recipes',
      'profile',
    ])
  })

  it('placement is above for bottom-nav steps, below for header/hero', () => {
    const above = TOUR_STEPS.filter((s) => s.placement === 'above').map((s) => s.id)
    const below = TOUR_STEPS.filter((s) => s.placement === 'below').map((s) => s.id)
    expect(above).toEqual(['nav-pantry', 'nav-chat', 'nav-recipes'])
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
    // Still waiting for the target — it may just not have rendered yet.
    expect(screen.getByTestId('step-index').textContent).toBe('0')

    await waitFor(
      () => {
        expect(Number(screen.getByTestId('step-index').textContent)).toBeGreaterThan(0)
      },
      { timeout: TARGET_WAIT_MS + 1000 },
    )
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
      await new Promise((r) => setTimeout(r, TARGET_WAIT_MS + 500))
    })

    // The skippedStepRef guard ensures each stepIndex auto-skips at most once, so
    // a missing step-0 target advances to step 1 and then stops (step-1 target
    // exists) — it must NOT run away toward totalSteps.
    const finalStep = Number(screen.getByTestId('step-index').textContent)
    expect(finalStep).toBe(1)
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

// ---------------------------------------------------------------------------
// 4. Positioning — both found in a live 375px build (PR #437 verify)
//
//  a. 'above' steps anchor by `bottom`: the tooltip is a framer-motion element
//     animating `y`, which overwrites any `transform` in `style`, so the old
//     translateY(-100%) was dropped and the tooltip fell off-screen below the
//     bottom nav, taking Next/Skip with it.
//  b. The spotlight follows a target that moves after the tour opens (the home
//     hero grows from its loading skeleton once data lands).
// ---------------------------------------------------------------------------
describe('TourOverlay: positioning', () => {
  type Box = { x: number; y: number; width: number; height: number }
  const boxes: Record<string, Box> = {}
  const realRect = Element.prototype.getBoundingClientRect

  beforeEach(() => {
    getUserMock.mockResolvedValue({
      data: { user: { user_metadata: { onboarding_completed: true } } },
    })
    Object.assign(window, { innerWidth: 375, innerHeight: 812 })
    for (const s of TOUR_STEPS) boxes[s.id] = { x: 20, y: 200, width: 100, height: 50 }
    boxes['nav-pantry'] = { x: 94, y: 746, width: 94, height: 66 }
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const id = this.getAttribute('data-tour')
      const b = id ? boxes[id] : undefined
      if (!b) return realRect.call(this)
      return {
        ...b,
        left: b.x,
        top: b.y,
        right: b.x + b.width,
        bottom: b.y + b.height,
        toJSON: () => b,
      } as DOMRect
    }
  })
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect
  })

  function Harness() {
    const { openTour, goNext } = useTour()
    React.useEffect(() => {
      openTour()
    }, [openTour])
    return (
      <div>
        {TOUR_STEPS.map((s) => (
          <div key={s.id} data-tour={s.id} />
        ))}
        <button data-testid="next" onClick={() => void goNext()} />
      </div>
    )
  }

  const settle = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms))
    })

  it("anchors an 'above' tooltip by bottom so it stays on-screen over the bottom nav", async () => {
    await act(async () => {
      render(
        <TourProvider>
          <Harness />
          <TourOverlay />
        </TourProvider>,
      )
    })
    await settle(50)
    const pantryIndex = TOUR_STEPS.findIndex((s) => s.id === 'nav-pantry')
    for (let i = 0; i < pantryIndex; i++) {
      await act(async () => {
        screen.getByTestId('next').click()
      })
      await settle(30)
    }
    const dialog = screen.getByRole('dialog', {
      name: `Onboarding tour step ${pantryIndex + 1} of ${TOUR_STEPS.length}`,
    })
    // Spotlight top = 746 - PAD(8) = 738; the tooltip's bottom edge sits 8px above it.
    expect(dialog.style.bottom).toBe(`${812 - 738 + 8}px`)
    expect(dialog.style.top).toBe('')
  })

  it("flips a 'below' card above its target when it wouldn't fit on a short screen", async () => {
    // ~iPhone SE in Safari: quick-actions near the bottom of a 560px viewport.
    Object.assign(window, { innerHeight: 560 })
    boxes['quick-actions'] = { x: 16, y: 380, width: 343, height: 107 }
    await act(async () => {
      render(
        <TourProvider>
          <Harness />
          <TourOverlay />
        </TourProvider>,
      )
    })
    await settle(50)
    await act(async () => {
      screen.getByTestId('next').click()
    })
    await settle(300)
    const dialog = screen.getByRole('dialog', {
      name: `Onboarding tour step 2 of ${TOUR_STEPS.length}`,
    })
    // Below would start at 380+107+8+8 = 503 and run off a 560px screen.
    expect(dialog.style.top).toBe('')
    expect(dialog.style.bottom).toBe(`${560 - (380 - 8) + 8}px`)
  })

  it('moves the spotlight when the target shifts after the tour opened', async () => {
    await act(async () => {
      render(
        <TourProvider>
          <Harness />
          <TourOverlay />
        </TourProvider>,
      )
    })
    await settle(50)
    boxes['hero'] = { x: 50, y: 257, width: 272, height: 101 }
    await settle(400)
    // The decorative ring is the only rect with a stroke.
    const ring = document.body.querySelector('rect[stroke="white"]')
    expect(ring?.getAttribute('x')).toBe(String(50 - 8))
    expect(ring?.getAttribute('width')).toBe(String(272 + 16))
  })

  // "Take the tour" on /profile opens the tour, then navigates to '/'. The
  // overlay used to run on /profile first, find no home targets, and auto-skip
  // to step 3 before the home screen ever loaded.
  it('a tour opened off "/" waits for home instead of auto-skipping', async () => {
    mockPathname = '/profile'
    function Page() {
      const { stepIndex } = useTour()
      return (
        <div>
          <div data-testid="step-index">{stepIndex}</div>
          {/* /profile has the bottom nav + profile button, but no home targets */}
          {mockPathname === '/' && <div data-tour="hero" />}
          <div data-tour="nav-pantry" />
          <div data-tour="profile" />
        </div>
      )
    }
    function Opener() {
      const { openTour } = useTour()
      React.useEffect(() => {
        openTour()
      }, [openTour])
      return null
    }
    let rerender!: (ui: React.ReactElement) => void
    const tree = () => (
      <TourProvider>
        <Opener />
        <Page />
        <TourOverlay />
      </TourProvider>
    )
    await act(async () => {
      ;({ rerender } = render(tree()))
    })
    await settle(100)
    expect(screen.getByTestId('step-index').textContent).toBe('0')
    expect(screen.queryByRole('dialog')).toBeNull()

    mockPathname = '/'
    await act(async () => {
      rerender(tree())
    })
    await settle(100)
    expect(screen.getByTestId('step-index').textContent).toBe('0')
    expect(
      screen.getByRole('dialog', { name: `Onboarding tour step 1 of ${TOUR_STEPS.length}` }),
    ).toBeTruthy()
  })
})
