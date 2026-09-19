/**
 * Issue #441 — a guided cook session must survive a full page reload
 * (refresh, a restored tab, a backgrounded mobile tab getting reclaimed).
 * Before this fix the step position and the COOKING banner were held only
 * in in-memory React state, so any full page load mid-cook silently
 * discarded the session with no way to resume.
 *
 * Extends the same `lib/cook-session.ts` module #440 introduced (rather than
 * a second, competing source of truth) with a persisted { recipeId, step }
 * record. The critical invariant carried over from #440: a session whose
 * deduction was confirmed (`endCookSession`) must never be resurrected by
 * the resume path — getting that wrong reintroduces the double-deduction
 * trap #440 fixed.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  startCookSession,
  endCookSession,
  isCookSessionEnded,
  saveCookProgress,
  getActiveCookSession,
  clearActiveCookSession,
} from '@/lib/cook-session'

// ─── cook-session.ts — the persisted record itself ────────────────────────────

describe('cook-session resume (#441)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('has no resumable session before one is started', () => {
    expect(getActiveCookSession()).toBeNull()
    expect(getActiveCookSession('r1')).toBeNull()
  })

  it('starting a session arms a resumable record at the prep screen', () => {
    startCookSession('r1')
    expect(getActiveCookSession()).toEqual({ recipeId: 'r1', step: -1 })
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: -1 })
  })

  it('saveCookProgress updates the persisted step for a rehydrate', () => {
    startCookSession('r1')
    saveCookProgress('r1', 0)
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 0 })
    saveCookProgress('r1', 1)
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
  })

  it('a persisted session rehydrates at the right step and recipe', () => {
    startCookSession('recipe-42')
    saveCookProgress('recipe-42', 2)

    // Simulate a fresh module read the way a full page reload would —
    // getActiveCookSession reads straight from localStorage every call.
    const resumed = getActiveCookSession()
    expect(resumed).toEqual({ recipeId: 'recipe-42', step: 2 })
  })

  it('getActiveCookSession(id) returns null for a session belonging to a different recipe', () => {
    startCookSession('r1')
    saveCookProgress('r1', 1)
    expect(getActiveCookSession('r2')).toBeNull()
  })

  it('an ended (confirmed) session does NOT rehydrate, even with a fresh step on record', () => {
    startCookSession('r1')
    saveCookProgress('r1', 2)
    endCookSession('r1')

    expect(getActiveCookSession()).toBeNull()
    expect(getActiveCookSession('r1')).toBeNull()
  })

  it('saveCookProgress on an already-ended session is a no-op — it cannot resurrect it', () => {
    startCookSession('r1')
    endCookSession('r1')

    saveCookProgress('r1', 2)

    expect(getActiveCookSession('r1')).toBeNull()
    expect(isCookSessionEnded('r1')).toBe(true)
  })

  it('ending a session clears its resumable record so a stale step cannot leak into a later fresh start', () => {
    startCookSession('r1')
    saveCookProgress('r1', 2)
    endCookSession('r1')
    startCookSession('r1')

    // Fresh start after an ended session begins back at prep, not step 2.
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: -1 })
  })

  it('ending one recipe does not clear a different, still-active recipe session', () => {
    startCookSession('r1')
    saveCookProgress('r1', 1)
    endCookSession('r2')
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
  })

  it('clearActiveCookSession removes the resumable record without marking the session ended', () => {
    startCookSession('r1')
    saveCookProgress('r1', 1)
    clearActiveCookSession('r1')

    expect(getActiveCookSession('r1')).toBeNull()
    // Not ended — a later re-open of guided cook for this recipe still works.
    startCookSession('r1')
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: -1 })
  })

  it('clearActiveCookSession is a no-op for a recipe that is not the active session', () => {
    startCookSession('r1')
    saveCookProgress('r1', 1)
    clearActiveCookSession('r2')
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
  })

  it('storage being unavailable does not crash the resume path', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      expect(() => getActiveCookSession()).not.toThrow()
      expect(getActiveCookSession()).toBeNull()
      expect(() => saveCookProgress('r1', 1)).not.toThrow()
      expect(() => startCookSession('r1')).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })

  it('a corrupt persisted record is treated as no session rather than crashing', () => {
    window.localStorage.setItem('bubblychef:cook:activeSession', 'not json')
    expect(() => getActiveCookSession()).not.toThrow()
    expect(getActiveCookSession()).toBeNull()
  })
})

// ─── GuidedCookFlow — resumes at the persisted step, persists on change ──────

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
    springs: { soft: {}, snappy: {}, pop: {}, page: {} },
  }),
  springs: { soft: {}, snappy: {}, pop: {}, page: {} },
  heartPopVariants: {},
}))

jest.mock('@/lib/api/chat', () => ({
  streamChatMessage: jest.fn(),
}))

import GuidedCookFlow from '@/components/recipes/GuidedCookFlow'
import type { Recipe } from '@/components/recipes/RecipePage'

const RECIPE: Recipe = {
  id: 'r1',
  user_id: 'u1',
  title: 'Creamy Tomato Pasta',
  description: 'Quick weeknight pasta',
  ingredients: [
    { name: 'pasta', quantity: 200, unit: 'g' },
    { name: 'canned tomatoes', quantity: 400, unit: 'g' },
  ],
  instructions: [
    'Boil salted water and cook pasta until al dente.',
    'Fry garlic in olive oil until fragrant.',
    'Add canned tomatoes and simmer for 8 minutes.',
  ],
  servings: 2,
} as Recipe

describe('GuidedCookFlow resume (#441)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('mounts on the prep screen by default (no initialStep)', () => {
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} />)
    expect(screen.getByTestId('guided-cook-prep')).toBeInTheDocument()
  })

  it('mounts directly on the persisted step when initialStep is provided', () => {
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} initialStep={1} />)
    expect(screen.getByTestId('guided-cook-step-2')).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
  })

  it('advancing a step persists the new position for a later resume', () => {
    startCookSession('r1')
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} />)

    fireEvent.click(screen.getByTestId('guided-cook-next')) // prep -> step 1
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 0 })

    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 1 -> step 2
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
  })

  it('going back a step persists the earlier position', () => {
    startCookSession('r1')
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} initialStep={1} />)

    fireEvent.click(screen.getByTestId('guided-cook-back'))
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 0 })
  })

  it('does not resurrect an ended session — progress stops persisting once confirmed', () => {
    startCookSession('r1')
    endCookSession('r1')
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} />)

    fireEvent.click(screen.getByTestId('guided-cook-next'))
    expect(getActiveCookSession('r1')).toBeNull()
  })
})
