/**
 * Integration tests for GuidedCookFlow — issue #263
 *
 * Covers:
 *  - Prep screen shown first (idx = PREP = -1)
 *  - Skip prep button moves to step 1
 *  - Back button disabled on prep screen
 *  - Next step navigation advances through all steps
 *  - Progress dots advance with step idx
 *  - Final "Finish cooking" lands on done-state
 *  - Done-state "Back to recipe" fires onExit
 *  - "Ask Bubbles" button opens the overlay (dialog rendered)
 *  - Overlay close button dismisses and returns to same step
 *  - Empty instructions shows done-state immediately
 *  - Structured steps (issue #648): structured chips, hands-on duration
 *    text, the regex fallback while ensure is pending/failed, and ensure
 *    being called exactly once
 */

import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ─── Mock heavy deps ──────────────────────────────────────────────────────────

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
    button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...rest}>{children}</button>,
    span: ({ children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) => <span {...rest}>{children}</span>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

jest.mock('@/lib/motion', () => ({
  useMotionConfig: () => ({
    reduced: false,
    springs: {
      soft: {},
      snappy: {},
      pop: {},
      page: {},
    },
  }),
  springs: {
    soft: {},
    snappy: {},
    pop: {},
    page: {},
  },
  heartPopVariants: {},
}))

// streamChatMessage is stubbed — overlay tests don't need a real stream.
jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: jest.fn(),
}))

// ensureSteps is stubbed per-test (issue #648) — defaults to a promise that
// never resolves within a test's synchronous assertions, which is the same
// as "pending", so pre-existing tests that don't care about structured
// steps keep exercising the regex-fallback path exactly as before.
jest.mock('@/lib/api/recipes', () => ({
  ensureSteps: jest.fn(() => new Promise(() => {})),
}))

import GuidedCookFlow from '@/components/recipes/GuidedCookFlow'
import type { Recipe } from '@/components/recipes/RecipePage'
import { ensureSteps } from '@/lib/api/recipes'
import type { Step } from '@/types/recipes'
import { CookingTimersProvider, useCookingTimers } from '@/lib/useCookingTimers'

const ensureStepsMock = ensureSteps as jest.Mock

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RECIPE: Recipe = {
  id: 'r1',
  user_id: 'u1',
  title: 'Creamy Tomato Pasta',
  description: 'Quick weeknight pasta',
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'canned tomatoes', quantity: 400, unit: 'g' },
    { name: 'cream', quantity: 100, unit: 'ml' },
  ],
  instructions: [
    'Boil salted water and cook pasta until al dente.',
    'Fry garlic in olive oil until fragrant.',
    'Add canned tomatoes and simmer for 8 minutes.',
    'Stir through cream and season, then toss with pasta.',
    'Plate up and serve.',
  ],
  servings: 2,
}

const EMPTY_RECIPE: Recipe = {
  ...RECIPE,
  id: 'r-empty',
  title: 'No Steps Recipe',
  instructions: [],
}

function structuredStep(overrides: Partial<Step> = {}): Step {
  return {
    text: 'Boil salted water and cook pasta until al dente.',
    label: 'Boil the pasta',
    ongoing_label: 'the pasta boils',
    duration_minutes: 10,
    duration_estimated: false,
    hands_on: false,
    depends_on: [],
    exclusive: [],
    ...overrides,
  }
}

const STRUCTURED_STEPS: Step[] = RECIPE.instructions.map((text, i) =>
  structuredStep({
    text: text as string,
    label: `Step label ${i + 1}`,
    duration_minutes: 5 + i,
    hands_on: i % 2 === 1, // steps 2 and 4 (1-indexed) are hands-on
  }),
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Every render needs its own QueryClient so `ensure-recipe-steps` cache hits never leak between tests. */
function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function renderFlow(overrides: Partial<Recipe> = {}) {
  const onExit = jest.fn()
  const recipe = { ...RECIPE, ...overrides }
  const utils = renderWithQuery(<GuidedCookFlow recipe={recipe} onExit={onExit} />)
  return { ...utils, onExit }
}

beforeEach(() => {
  ensureStepsMock.mockReset()
  ensureStepsMock.mockImplementation(() => new Promise(() => {}))
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GuidedCookFlow — prep screen', () => {
  it('shows the prep screen first', () => {
    renderFlow()
    expect(screen.getByTestId('guided-cook-prep')).toBeInTheDocument()
    expect(screen.queryByTestId('guided-cook-step-1')).not.toBeInTheDocument()
  })

  it('lists ingredients on the prep screen', () => {
    renderFlow()
    expect(screen.getByText(/200.*g.*pasta/i)).toBeInTheDocument()
  })

  it('"Back" is disabled on the prep screen', () => {
    renderFlow()
    expect(screen.getByTestId('guided-cook-back')).toBeDisabled()
  })

  it('"Skip prep" primary button is present', () => {
    renderFlow()
    expect(screen.getByTestId('guided-cook-next')).toHaveTextContent(/skip prep/i)
  })

  it('clicking skip prep shows step 1', () => {
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    expect(screen.getByTestId('guided-cook-step-1')).toBeInTheDocument()
    expect(screen.queryByTestId('guided-cook-prep')).not.toBeInTheDocument()
  })
})

describe('GuidedCookFlow — step navigation', () => {
  it('advances step-by-step through all steps', () => {
    renderFlow()
    // skip prep
    fireEvent.click(screen.getByTestId('guided-cook-next'))

    // Click through every step; clicking "next" on the last step lands on done.
    for (let i = 1; i <= RECIPE.instructions.length; i++) {
      expect(screen.getByTestId(`guided-cook-step-${i}`)).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }

    // last step clicked — should show done
    expect(screen.getByTestId('guided-cook-done')).toBeInTheDocument()
  })

  it('"Back" button goes back one step', () => {
    renderFlow()
    // go to step 1
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    expect(screen.getByTestId('guided-cook-step-1')).toBeInTheDocument()

    // go to step 2
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    expect(screen.getByTestId('guided-cook-step-2')).toBeInTheDocument()

    // go back to step 1
    fireEvent.click(screen.getByTestId('guided-cook-back'))
    expect(screen.getByTestId('guided-cook-step-1')).toBeInTheDocument()
  })

  it('"Next" label says "Finish cooking" on the last step', () => {
    renderFlow()
    // skip prep, then advance to the last step (idx = length - 1)
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    for (let i = 1; i < RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.getByTestId('guided-cook-next')).toHaveTextContent(/finish cooking/i)
  })

  it('step text is rendered in the card', () => {
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 1
    expect(screen.getByTestId('guided-cook-step-text')).toHaveTextContent(/boil salted water/i)
  })
})

describe('GuidedCookFlow — progress dots', () => {
  it('renders a dot for each step', () => {
    renderFlow()
    const progressbar = screen.getByRole('progressbar')
    // One dot span per step
    const dots = progressbar.querySelectorAll('span')
    expect(dots).toHaveLength(RECIPE.instructions.length)
  })
})

describe('GuidedCookFlow — done state', () => {
  it('shows done state after finishing all steps', () => {
    renderFlow()
    // skip prep + advance through all steps
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.getByTestId('guided-cook-done')).toBeInTheDocument()
    // The done copy embeds the title in a sentence ("You cooked <title>."),
    // so match on a substring rather than an exact-text node.
    expect(screen.getByTestId('guided-cook-done')).toHaveTextContent(RECIPE.title)
  })

  it('"Back to recipe" calls onExit from done state', () => {
    const { onExit } = renderFlow()
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    fireEvent.click(screen.getByTestId('guided-cook-exit'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('exit button in the header calls onExit', () => {
    const { onExit } = renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-exit-header'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('shows done state immediately for a recipe with no instructions', () => {
    renderWithQuery(<GuidedCookFlow recipe={EMPTY_RECIPE} onExit={jest.fn()} />)
    expect(screen.getByTestId('guided-cook-done')).toBeInTheDocument()
  })
})

describe('GuidedCookFlow — Ask Bubbles overlay', () => {
  it('"Ask Bubbles" button is present on a step card', () => {
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 1
    expect(screen.getByTestId('guided-cook-ask-bubbles')).toBeInTheDocument()
  })

  it('clicking "Ask Bubbles" opens the overlay dialog', () => {
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    fireEvent.click(screen.getByTestId('guided-cook-ask-bubbles'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', expect.stringMatching(/step 1/i))
  })

  it('overlay "Back to step" button closes the overlay', () => {
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    fireEvent.click(screen.getByTestId('guided-cook-ask-bubbles'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to step 1/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('step card is still visible after closing the overlay', () => {
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    fireEvent.click(screen.getByTestId('guided-cook-ask-bubbles'))
    fireEvent.click(screen.getByRole('button', { name: /back to step 1/i }))
    // Same step is still active
    expect(screen.getByTestId('guided-cook-step-1')).toBeInTheDocument()
  })

  it('"Ask Bubbles" button is not present on prep screen', () => {
    renderFlow()
    // still on prep
    expect(screen.queryByTestId('guided-cook-ask-bubbles')).not.toBeInTheDocument()
  })

  it('"Ask Bubbles" button is not present on done state', () => {
    renderFlow()
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.queryByTestId('guided-cook-ask-bubbles')).not.toBeInTheDocument()
  })
})

describe('GuidedCookFlow — Ask Bubbles sends a valid ChatRequest', () => {
  // Regression for the #263 bug: the overlay used to send `mode: 'cooking_help'`,
  // which is not in the ChatRequest mode Literal (chat|recipe|learn|text|voice),
  // so the backend 422'd and the stream never started. The tests here mock
  // streamChatMessage, so the 422 was invisible — assert the payload directly.
  const chatApi = jest.requireMock('@/lib/api/chat') as {
    streamChatMessage: jest.Mock
  }

  beforeEach(() => {
    chatApi.streamChatMessage.mockReset()
  })

  function openOverlayAndSend(question: string) {
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 1
    fireEvent.click(screen.getByTestId('guided-cook-ask-bubbles'))
    const input = screen.getByPlaceholderText(/ask about this step/i)
    fireEvent.change(input, { target: { value: question } })
    fireEvent.click(screen.getByRole('button', { name: /send question/i }))
  }

  const VALID_MODES = ['chat', 'recipe', 'learn', 'text', 'voice']

  it('sends no invalid mode (omitted, or one of the valid Literals)', () => {
    openOverlayAndSend('why al dente?')
    expect(chatApi.streamChatMessage).toHaveBeenCalledTimes(1)
    const request = chatApi.streamChatMessage.mock.calls[0][0]
    // The fix omits `mode` entirely; assert it is either absent or a valid
    // Literal — this also catches a regression that sets a *different*
    // invalid string (e.g. 'cooking_question'), which `!== 'cooking_help'`
    // would have let through.
    if (request.mode !== undefined) {
      expect(VALID_MODES).toContain(request.mode)
    }
  })

  it('folds the step context into the message body', () => {
    openOverlayAndSend('why al dente?')
    const request = chatApi.streamChatMessage.mock.calls[0][0]
    // Step number, step text, recipe title, and the raw question all present.
    expect(request.message).toMatch(/step 1/i)
    expect(request.message).toMatch(/boil salted water/i)
    expect(request.message).toMatch(/creamy tomato pasta/i)
    expect(request.message).toMatch(/why al dente\?/i)
  })

  it('sends a null conversation_id (no pinned session yet)', () => {
    openOverlayAndSend('why al dente?')
    const request = chatApi.streamChatMessage.mock.calls[0][0]
    expect(request.conversation_id).toBeNull()
  })

  it('opts out of follow-up chips, which the overlay never renders (#498)', () => {
    openOverlayAndSend('why al dente?')
    const request = chatApi.streamChatMessage.mock.calls[0][0]
    expect(request.follow_up_chips).toBe(false)
  })
})

describe('GuidedCookFlow — done-state deduction handoff (#263)', () => {
  function renderWithFinish() {
    const onExit = jest.fn()
    const onFinish = jest.fn()
    renderWithQuery(<GuidedCookFlow recipe={RECIPE} onExit={onExit} onFinish={onFinish} />)
    return { onExit, onFinish }
  }

  it('shows the "Update my pantry" button when onFinish is wired', () => {
    renderWithFinish()
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.getByTestId('guided-cook-deduct')).toBeInTheDocument()
  })

  it('"Update my pantry" fires onFinish, not onExit', () => {
    const { onExit, onFinish } = renderWithFinish()
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    fireEvent.click(screen.getByTestId('guided-cook-deduct'))
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('"Skip for now" still fires onExit', () => {
    const { onExit, onFinish } = renderWithFinish()
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    fireEvent.click(screen.getByTestId('guided-cook-exit'))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onFinish).not.toHaveBeenCalled()
  })

  // Issue #812 — the done state wears the same keycap buttons as the meal cook's finish.
  it('draws the done state as a pixel panel with keycap actions', () => {
    renderWithFinish()
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.getByTestId('guided-cook-done')).toHaveAttribute('data-pixel-panel')
    expect(screen.getByTestId('guided-cook-deduct')).toHaveAttribute('data-keycap', 'primary')
    expect(screen.getByTestId('guided-cook-exit')).toHaveAttribute('data-keycap', 'secondary')
  })

  it('makes Back to recipe the primary keycap when there is no deduction handoff', () => {
    renderFlow()
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.getByTestId('guided-cook-exit')).toHaveAttribute('data-keycap', 'primary')
  })

  it('hides the deduct button when onFinish is not wired', () => {
    renderFlow() // no onFinish
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.queryByTestId('guided-cook-deduct')).not.toBeInTheDocument()
  })
})

// ─── Structured steps (issue #648) ─────────────────────────────────────────────

describe('GuidedCookFlow — structured steps already on the recipe', () => {
  it('shows a structured timer chip, not the regex chip, for a hands-off step', () => {
    renderFlow({ steps: STRUCTURED_STEPS })
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 1 (hands-off)

    expect(screen.getByTestId('structured-step-timer-chip')).toHaveTextContent('Step label 1')
    expect(screen.getByTestId('structured-step-timer-chip')).toHaveTextContent('5 min')
    expect(screen.queryByTestId('step-timer-chip')).not.toBeInTheDocument()

    // The recipe already had steps, so ensureSteps must never be called.
    expect(ensureStepsMock).not.toHaveBeenCalled()
  })

  it('shows duration as plain text, with no chip, for a hands-on step', () => {
    renderFlow({ steps: STRUCTURED_STEPS })
    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 1
    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 2 (hands-on, per fixture)

    expect(screen.getByTestId('step-duration-text')).toHaveTextContent('6 min')
    expect(screen.queryByTestId('structured-step-timer-chip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('step-timer-chip')).not.toBeInTheDocument()
  })

  it('tapping a structured chip starts a dock timer named after the step label', () => {
    function TimerList() {
      const { timers } = useCookingTimers()
      return (
        <ul>
          {timers.map((t) => (
            <li key={t.id}>{t.label}</li>
          ))}
        </ul>
      )
    }

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <CookingTimersProvider>
          <GuidedCookFlow recipe={{ ...RECIPE, steps: STRUCTURED_STEPS }} onExit={jest.fn()} />
          <TimerList />
        </CookingTimersProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 1
    fireEvent.click(screen.getByTestId('structured-step-timer-chip'))

    // The chip button itself also matches "Step label 1" — assert on the
    // dock's own list item specifically, not just any match in the DOM.
    expect(screen.getByRole('listitem')).toHaveTextContent('Step label 1')
  })
})

describe('GuidedCookFlow — regex fallback while structured steps are missing (issue #648)', () => {
  it('calls ensureSteps exactly once when the recipe has no steps yet', () => {
    renderFlow() // RECIPE has no `steps` field
    expect(ensureStepsMock).toHaveBeenCalledTimes(1)
    expect(ensureStepsMock).toHaveBeenCalledWith('r1')
  })

  it('uses the regex chip while the ensure call is still pending', () => {
    renderFlow() // default mock never resolves — permanently "pending" for this test
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 3 has "8 minutes"
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    fireEvent.click(screen.getByTestId('guided-cook-next'))

    expect(screen.getByTestId('step-timer-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('structured-step-timer-chip')).not.toBeInTheDocument()
  })

  it('keeps using the regex chip after the ensure call fails', async () => {
    ensureStepsMock.mockRejectedValue(new Error('model unavailable'))
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 1
    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 2
    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 3 — has "8 minutes"

    await waitFor(() => expect(ensureStepsMock).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('step-timer-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('structured-step-timer-chip')).not.toBeInTheDocument()
  })

  it('switches to structured chips once the ensure call resolves', async () => {
    ensureStepsMock.mockResolvedValue({ recipe_id: 'r1', steps: STRUCTURED_STEPS, derived: true })
    renderFlow()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep → step 1 (hands-off)

    await waitFor(() =>
      expect(screen.getByTestId('structured-step-timer-chip')).toHaveTextContent('Step label 1'),
    )
    expect(screen.queryByTestId('step-timer-chip')).not.toBeInTheDocument()
  })

  it('reports the resolved steps to the caller via onStepsResolved, exactly once', async () => {
    ensureStepsMock.mockResolvedValue({ recipe_id: 'r1', steps: STRUCTURED_STEPS, derived: true })
    const onStepsResolved = jest.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} onStepsResolved={onStepsResolved} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(onStepsResolved).toHaveBeenCalledTimes(1))
    expect(onStepsResolved).toHaveBeenCalledWith(STRUCTURED_STEPS)
  })
})

// ─── Finished timer chips (issue #757) ────────────────────────────────────────

describe('GuidedCookFlow — finished timer chips leave the dock (issue #757)', () => {
  function TimerStatuses() {
    const { timers } = useCookingTimers()
    return (
      <ul data-testid="dock-timers">
        {timers.map((t) => (
          <li key={t.id}>{`${t.label}:${t.status}`}</li>
        ))}
      </ul>
    )
  }

  function renderWithDock() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <CookingTimersProvider>
          <GuidedCookFlow recipe={{ ...RECIPE, steps: STRUCTURED_STEPS }} onExit={jest.fn()} />
          <TimerStatuses />
        </CookingTimersProvider>
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    window.localStorage.clear()
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  function startStepOneTimerAndLetItFinish() {
    fireEvent.click(screen.getByTestId('guided-cook-next')) // skip prep -> step 1 (5 min, hands-off)
    fireEvent.click(screen.getByTestId('structured-step-timer-chip'))
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000 + 2000)
    })
    expect(screen.getByTestId('dock-timers')).toHaveTextContent('Step label 1 · 5 min:completed')
  }

  it('keeps a finished chip while the cook is still on the step that owns it', () => {
    renderWithDock()
    startStepOneTimerAndLetItFinish()
    expect(screen.getByTestId('dock-timers')).toHaveTextContent('completed')
  })

  it('clears the finished chip when the cook moves to the next step', () => {
    renderWithDock()
    startStepOneTimerAndLetItFinish()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 2
    expect(screen.getByTestId('dock-timers')).toBeEmptyDOMElement()
  })

  it('leaves a running timer alone when the cook moves on', () => {
    renderWithDock()
    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 1
    fireEvent.click(screen.getByTestId('structured-step-timer-chip'))
    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 2
    expect(screen.getByTestId('dock-timers')).toHaveTextContent('Step label 1 · 5 min:running')
  })

  it('going Back does not clear a finished chip', () => {
    renderWithDock()
    startStepOneTimerAndLetItFinish()
    fireEvent.click(screen.getByTestId('guided-cook-back'))
    expect(screen.getByTestId('dock-timers')).toHaveTextContent('completed')
  })
})
