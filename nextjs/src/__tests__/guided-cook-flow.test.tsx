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
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

// ─── Mock heavy deps ──────────────────────────────────────────────────────────

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
    button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...rest}>{children}</button>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

import GuidedCookFlow from '@/components/recipes/GuidedCookFlow'
import type { Recipe } from '@/components/recipes/RecipePage'

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderFlow(overrides: Partial<Recipe> = {}) {
  const onExit = jest.fn()
  const recipe = { ...RECIPE, ...overrides }
  const utils = render(<GuidedCookFlow recipe={recipe} onExit={onExit} />)
  return { ...utils, onExit }
}

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

    for (let i = 1; i <= RECIPE.instructions.length - 1; i++) {
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
    // skip to last step
    fireEvent.click(screen.getByTestId('guided-cook-next'))
    for (let i = 1; i < RECIPE.instructions.length - 1; i++) {
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
    expect(screen.getByText(RECIPE.title)).toBeInTheDocument()
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
    render(<GuidedCookFlow recipe={EMPTY_RECIPE} onExit={jest.fn()} />)
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

  it('never sends the invalid "cooking_help" mode', () => {
    openOverlayAndSend('why al dente?')
    expect(chatApi.streamChatMessage).toHaveBeenCalledTimes(1)
    const request = chatApi.streamChatMessage.mock.calls[0][0]
    expect(request.mode).not.toBe('cooking_help')
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
})

describe('GuidedCookFlow — done-state deduction handoff (#263)', () => {
  function renderWithFinish() {
    const onExit = jest.fn()
    const onFinish = jest.fn()
    render(<GuidedCookFlow recipe={RECIPE} onExit={onExit} onFinish={onFinish} />)
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

  it('hides the deduct button when onFinish is not wired', () => {
    renderFlow() // no onFinish
    for (let i = 0; i <= RECIPE.instructions.length; i++) {
      fireEvent.click(screen.getByTestId('guided-cook-next'))
    }
    expect(screen.queryByTestId('guided-cook-deduct')).not.toBeInTheDocument()
  })
})
