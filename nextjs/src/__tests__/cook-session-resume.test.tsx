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
 *
 * PR #475 code review (Bug 2): only `startGuidedCookSession` — called from
 * `RecipeBook.handleOpenGuidedCook`, the actual entry point to the guided
 * flow — arms the resumable step record. `startCookSession` (the chat cook
 * path) deliberately does not, so a cook started from chat can never cause
 * `/recipes` to auto-open the guided flow it was never asked to enter.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  startCookSession,
  startGuidedCookSession,
  endCookSession,
  isCookSessionEnded,
  saveCookProgress,
  getActiveCookSession,
  clearActiveCookSession,
  saveAmendedIngredients,
  getAmendedIngredients,
  clearAmendedIngredients,
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

  it('starting a guided session arms a resumable record at the prep screen', () => {
    startGuidedCookSession('r1')
    expect(getActiveCookSession()).toEqual({ recipeId: 'r1', step: -1 })
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: -1 })
  })

  it('saveCookProgress updates the persisted step for a rehydrate', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 0)
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 0 })
    saveCookProgress('r1', 1)
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
  })

  it('a persisted session rehydrates at the right step and recipe', () => {
    startGuidedCookSession('recipe-42')
    saveCookProgress('recipe-42', 2)

    // Simulate a fresh module read the way a full page reload would —
    // getActiveCookSession reads straight from localStorage every call.
    const resumed = getActiveCookSession()
    expect(resumed).toEqual({ recipeId: 'recipe-42', step: 2 })
  })

  it('getActiveCookSession(id) returns null for a session belonging to a different recipe', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)
    expect(getActiveCookSession('r2')).toBeNull()
  })

  it('an ended (confirmed) session does NOT rehydrate, even with a fresh step on record', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 2)
    endCookSession('r1')

    expect(getActiveCookSession()).toBeNull()
    expect(getActiveCookSession('r1')).toBeNull()
  })

  it('saveCookProgress on an already-ended session is a no-op — it cannot resurrect it', () => {
    startGuidedCookSession('r1')
    endCookSession('r1')

    saveCookProgress('r1', 2)

    expect(getActiveCookSession('r1')).toBeNull()
    expect(isCookSessionEnded('r1')).toBe(true)
  })

  it('ending a session clears its resumable record so a stale step cannot leak into a later fresh start', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 2)
    endCookSession('r1')
    startGuidedCookSession('r1')

    // Fresh start after an ended session begins back at prep, not step 2.
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: -1 })
  })

  it('ending one recipe does not clear a different, still-active recipe session', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)
    endCookSession('r2')
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
  })

  it('clearActiveCookSession removes the resumable record without marking the session ended', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)
    clearActiveCookSession('r1')

    expect(getActiveCookSession('r1')).toBeNull()
    // Not ended — a later re-open of guided cook for this recipe still works.
    startGuidedCookSession('r1')
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: -1 })
  })

  it('clearActiveCookSession is a no-op for a recipe that is not the active session', () => {
    startGuidedCookSession('r1')
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
      expect(() => startGuidedCookSession('r1')).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })

  it('a corrupt persisted record is treated as no session rather than crashing', () => {
    window.localStorage.setItem('bubblychef:cook:activeSession', 'not json')
    expect(() => getActiveCookSession()).not.toThrow()
    expect(getActiveCookSession()).toBeNull()
  })

  // ─── PR #475 code review — Bug 2: chat-started cook must not auto-resume ──

  it('startCookSession (chat cook path) does NOT arm a resumable record', () => {
    startCookSession('r1')
    expect(getActiveCookSession()).toBeNull()
    expect(getActiveCookSession('r1')).toBeNull()
  })

  it('a chat-started cook does not leak into an unrelated guided-flow resumable record', () => {
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)
    // A second, unrelated recipe is started from the chat cook path.
    startCookSession('r2')
    // r1's genuinely-guided session is still resumable and untouched.
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
    expect(getActiveCookSession('r2')).toBeNull()
  })
})

// ─── Amended ingredients survive a reload (#490) ──────────────────────────────

describe('cook-session amended ingredients (#490)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  const AMENDED = [{ name: 'oat milk', quantity: 1, unit: 'cup' }]

  it('has no amendment on record before one is saved', () => {
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('round-trips an amended ingredient list for the recipe it was saved against', () => {
    saveAmendedIngredients('r1', AMENDED)
    expect(getAmendedIngredients('r1')).toEqual(AMENDED)
  })

  it('a fresh read — the way a full page reload would see it — still finds the amendment', () => {
    saveAmendedIngredients('recipe-42', AMENDED)
    // getAmendedIngredients reads straight from localStorage every call, so
    // there is nothing to "simulate" beyond calling it again.
    expect(getAmendedIngredients('recipe-42')).toEqual(AMENDED)
  })

  it('does not leak an amendment saved for one recipe into a lookup for another', () => {
    saveAmendedIngredients('r1', AMENDED)
    expect(getAmendedIngredients('r2')).toBeNull()
  })

  it('saving a new amendment for a different recipe replaces the single-slot record', () => {
    saveAmendedIngredients('r1', AMENDED)
    const other = [{ name: 'soy milk', quantity: 2, unit: 'cup' }]
    saveAmendedIngredients('r2', other)
    expect(getAmendedIngredients('r1')).toBeNull()
    expect(getAmendedIngredients('r2')).toEqual(other)
  })

  it('clearAmendedIngredients removes the record for that recipe', () => {
    saveAmendedIngredients('r1', AMENDED)
    clearAmendedIngredients('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('clearAmendedIngredients is a no-op for a recipe that is not the one on record', () => {
    saveAmendedIngredients('r1', AMENDED)
    clearAmendedIngredients('r2')
    expect(getAmendedIngredients('r1')).toEqual(AMENDED)
  })

  it('endCookSession clears the amendment so a later cook of the same recipe starts fresh', () => {
    saveAmendedIngredients('r1', AMENDED)
    endCookSession('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('endCookSession for a different recipe does not clear this one\'s amendment', () => {
    saveAmendedIngredients('r1', AMENDED)
    endCookSession('r2')
    expect(getAmendedIngredients('r1')).toEqual(AMENDED)
  })

  it('clearActiveCookSession also clears the amendment for that recipe', () => {
    startGuidedCookSession('r1')
    saveAmendedIngredients('r1', AMENDED)
    clearActiveCookSession('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('a corrupt persisted amendment record is treated as none rather than crashing', () => {
    window.localStorage.setItem('bubblychef:cook:amendedIngredients', 'not json')
    expect(() => getAmendedIngredients('r1')).not.toThrow()
    expect(getAmendedIngredients('r1')).toBeNull()

    window.localStorage.setItem('bubblychef:cook:amendedIngredients', '{"unexpected":"shape"}')
    expect(() => getAmendedIngredients('r1')).not.toThrow()
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('storage being unavailable does not crash the amendment path', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      expect(() => saveAmendedIngredients('r1', AMENDED)).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })

  // Mirrors RecipeBook's `recipesWithOverrides` merge — the guided-flow half
  // of #490's acceptance criteria (chat's half is covered in
  // cook-session-teardown.test.tsx). A reload that resumes the guided flow
  // reads the recipe through this same merge, so it must show the amended
  // list too, not just the chat banner.
  it('mirrors RecipeBook.recipesWithOverrides: merges the amendment into the recipe used to resume the guided flow', () => {
    const original = { id: 'r1', ingredients: [{ name: 'milk', quantity: 1, unit: 'cup' }] }
    const mergeAmendment = (recipe: typeof original) => {
      const amended = getAmendedIngredients(recipe.id)
      return amended ? { ...recipe, ingredients: amended } : recipe
    }

    expect(mergeAmendment(original)).toBe(original)

    saveAmendedIngredients('r1', AMENDED)
    expect(mergeAmendment(original)).toEqual({ id: 'r1', ingredients: AMENDED })
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
    startGuidedCookSession('r1')
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} />)

    fireEvent.click(screen.getByTestId('guided-cook-next')) // prep -> step 1
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 0 })

    fireEvent.click(screen.getByTestId('guided-cook-next')) // step 1 -> step 2
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 1 })
  })

  it('going back a step persists the earlier position', () => {
    startGuidedCookSession('r1')
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} initialStep={1} />)

    fireEvent.click(screen.getByTestId('guided-cook-back'))
    expect(getActiveCookSession('r1')).toEqual({ recipeId: 'r1', step: 0 })
  })

  it('does not resurrect an ended session — progress stops persisting once confirmed', () => {
    startGuidedCookSession('r1')
    endCookSession('r1')
    render(<GuidedCookFlow recipe={RECIPE} onExit={jest.fn()} />)

    fireEvent.click(screen.getByTestId('guided-cook-next'))
    expect(getActiveCookSession('r1')).toBeNull()
  })
})

// ─── RecipeBook — Bug 2: only a guided-flow-started cook auto-resumes ───────

describe('RecipeBook resume gating (#441 / PR #475 Bug 2)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('a chat-started cook session is not visible to the no-argument resume lookup RecipeBook uses on mount', () => {
    // Mirrors app/chat/page.tsx's onStartCooking handler, which only calls
    // startCookSession — never startGuidedCookSession.
    startCookSession('r1')
    expect(getActiveCookSession()).toBeNull()
  })

  it('a guided-flow-started cook session IS visible to the no-argument resume lookup RecipeBook uses on mount', () => {
    // Mirrors RecipeBook.handleOpenGuidedCook, the guided flow's real entry point.
    startGuidedCookSession('r1')
    saveCookProgress('r1', 1)
    expect(getActiveCookSession()).toEqual({ recipeId: 'r1', step: 1 })
  })
})
