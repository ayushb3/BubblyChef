/**
 * Issue #653 — `lib/meal-cook-session.ts`, the meal cook-along's persisted
 * session, mirroring `cook-session-resume.test.tsx` and
 * `cook-session-teardown.test.tsx`'s coverage for the single-recipe module
 * it's a sibling of. The critical invariant carried over from #440/#441: a
 * session recorded as ended must never be resurrected by the resume path —
 * getting that wrong reopens the double-deduction trap #440 fixed, this time
 * for a whole meal.
 */

import {
  startMealCookSession,
  saveMealCookProgress,
  getActiveMealCookSession,
  clearActiveMealCookSession,
  endMealCookSession,
  isMealCookSessionEnded,
  isStaleMealCookSession,
  ensureCookId,
  readDishAmendment,
  type MealCookSession,
} from '@/lib/meal-cook-session'

describe('meal-cook-session — save and restore', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('has no active session before one is started', () => {
    expect(getActiveMealCookSession()).toBeNull()
    expect(getActiveMealCookSession('meal-1')).toBeNull()
  })

  it('starting a session writes an active record with empty steps and amendments, and a UUID cook_id', () => {
    const session = startMealCookSession('meal-1', ['r-main', 'r-side1'], 1000, ['1:boil', '1:chop'])
    expect(session).toEqual({
      meal_id: 'meal-1',
      started_at_ms: 1000,
      dish_ids: ['r-main', 'r-side1'],
      dish_step_signatures: ['1:boil', '1:chop'],
      steps: {},
      cook_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      ingredient_amendments: {},
    })
    expect(getActiveMealCookSession('meal-1')).toEqual(session)
  })

  it('saveMealCookProgress persists step updates for a later resume', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    const updated: MealCookSession = {
      meal_id: 'meal-1',
      started_at_ms: 1000,
      dish_ids: ['r-main'],
      dish_step_signatures: ['1:boil'],
      steps: { 'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      ingredient_amendments: {},
    }
    saveMealCookProgress(updated)
    expect(getActiveMealCookSession('meal-1')).toEqual(updated)
  })

  it('a persisted session rehydrates the way a full page reload would', () => {
    startMealCookSession('meal-1', ['r-main', 'r-side1'], 1000, ['1:boil', '1:chop'])
    saveMealCookProgress({
      meal_id: 'meal-1',
      started_at_ms: 1000,
      dish_ids: ['r-main', 'r-side1'],
      dish_step_signatures: ['1:boil', '1:chop'],
      steps: {
        'r-main:0': { status: 'running', started_at_minutes: 0, extra_minutes: 0, timer_id: 't1' },
      },
      ingredient_amendments: {},
    })

    // getActiveMealCookSession reads straight from localStorage every call —
    // this simulates a fresh module read after a reload.
    const resumed = getActiveMealCookSession()
    expect(resumed?.steps['r-main:0']).toEqual({
      status: 'running',
      started_at_minutes: 0,
      extra_minutes: 0,
      timer_id: 't1',
    })
  })

  it('getActiveMealCookSession(id) returns null for a session belonging to a different meal', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    expect(getActiveMealCookSession('meal-2')).toBeNull()
  })

  it('clearActiveMealCookSession removes the active record without ending it', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    clearActiveMealCookSession('meal-1')

    expect(getActiveMealCookSession('meal-1')).toBeNull()
    expect(isMealCookSessionEnded('meal-1')).toBe(false)
    // A fresh start still works — not blocked by any "ended" leftover.
    startMealCookSession('meal-1', ['r-main'], 2000, ['1:boil'])
    expect(getActiveMealCookSession('meal-1')?.started_at_ms).toBe(2000)
  })

  it('clearActiveMealCookSession is a no-op for a meal that is not the active session', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    clearActiveMealCookSession('meal-2')
    expect(getActiveMealCookSession('meal-1')?.meal_id).toBe('meal-1')
  })
})

describe('meal-cook-session — the ended guard (issue #440 pattern)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('a meal with no recorded session is not considered ended', () => {
    expect(isMealCookSessionEnded('meal-1')).toBe(false)
  })

  it('endMealCookSession marks the meal ended and clears its active record', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    endMealCookSession('meal-1')

    expect(isMealCookSessionEnded('meal-1')).toBe(true)
    expect(getActiveMealCookSession('meal-1')).toBeNull()
    expect(getActiveMealCookSession()).toBeNull()
  })

  it('an ended session does NOT rehydrate even with a fresh step on record', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    saveMealCookProgress({
      meal_id: 'meal-1',
      started_at_ms: 1000,
      dish_ids: ['r-main'],
      dish_step_signatures: ['1:boil'],
      steps: { 'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      ingredient_amendments: {},
    })
    endMealCookSession('meal-1')

    expect(getActiveMealCookSession('meal-1')).toBeNull()
  })

  it('saveMealCookProgress on an already-ended session is a no-op — it cannot resurrect it', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    endMealCookSession('meal-1')

    saveMealCookProgress({
      meal_id: 'meal-1',
      started_at_ms: 1000,
      dish_ids: ['r-main'],
      dish_step_signatures: ['1:boil'],
      steps: { 'r-main:0': { status: 'done', started_at_minutes: 0, extra_minutes: 0 } },
      ingredient_amendments: {},
    })

    expect(getActiveMealCookSession('meal-1')).toBeNull()
    expect(isMealCookSessionEnded('meal-1')).toBe(true)
  })

  it('ending one meal does not mark a different meal ended', () => {
    endMealCookSession('meal-1')
    expect(isMealCookSessionEnded('meal-2')).toBe(false)
  })

  it('is idempotent — ending an already-ended session is a no-op', () => {
    endMealCookSession('meal-1')
    endMealCookSession('meal-1')
    expect(isMealCookSessionEnded('meal-1')).toBe(true)
  })

  it('ending one meal does not clear a different, still-active meal session', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    endMealCookSession('meal-2')
    expect(getActiveMealCookSession('meal-1')?.meal_id).toBe('meal-1')
  })

  it('caps the ended-meal list at 20, evicting the oldest entry first (mirrors cook-session.ts)', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `meal-${i}`)
    ids.forEach((id) => endMealCookSession(id))

    // The cap is 20 — the oldest 5 (meal-0..meal-4) should have been evicted.
    for (let i = 0; i < 5; i++) {
      expect(isMealCookSessionEnded(`meal-${i}`)).toBe(false)
    }
    // The most recent 20 (meal-5..meal-24) should still be recorded as ended.
    for (let i = 5; i < 25; i++) {
      expect(isMealCookSessionEnded(`meal-${i}`)).toBe(true)
    }
  })
})

describe('meal-cook-session — a start clears a stale ended record (issue #440 pattern)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starting a fresh session for a meal that was previously ended un-ends it', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    endMealCookSession('meal-1')
    expect(isMealCookSessionEnded('meal-1')).toBe(true)

    startMealCookSession('meal-1', ['r-main'], 5000, ['1:boil'])
    expect(isMealCookSessionEnded('meal-1')).toBe(false)
    expect(getActiveMealCookSession('meal-1')?.started_at_ms).toBe(5000)
  })

  it('ending recipe B does NOT un-end recipe A (regression for the reintroduced double-deduction bug)', () => {
    endMealCookSession('meal-1')
    endMealCookSession('meal-2')
    startMealCookSession('meal-2', ['r-main'], 1000, ['1:boil'])
    expect(isMealCookSessionEnded('meal-1')).toBe(true)
    expect(isMealCookSessionEnded('meal-2')).toBe(false)
  })
})

describe('meal-cook-session — one active session at a time', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starting a session for a second meal replaces the first, for any meal id', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    startMealCookSession('meal-2', ['r-other'], 2000, ['1:fry'])

    expect(getActiveMealCookSession('meal-1')).toBeNull()
    expect(getActiveMealCookSession('meal-2')?.meal_id).toBe('meal-2')
    expect(getActiveMealCookSession()?.meal_id).toBe('meal-2')
  })
})

describe('meal-cook-session — corrupt storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('a corrupt persisted active-session record is treated as no session rather than crashing', () => {
    window.localStorage.setItem('bubblychef:mealcook:activeSession', 'not json')
    expect(() => getActiveMealCookSession()).not.toThrow()
    expect(getActiveMealCookSession()).toBeNull()
  })

  it('a recognisable-but-wrong-shape record is treated as no session', () => {
    window.localStorage.setItem('bubblychef:mealcook:activeSession', JSON.stringify({ foo: 'bar' }))
    expect(getActiveMealCookSession()).toBeNull()
  })

  it('a corrupt ended-ids record degrades to "nothing ended" rather than throwing', () => {
    window.localStorage.setItem('bubblychef:mealcook:endedMealIds', 'not json')
    expect(() => isMealCookSessionEnded('meal-1')).not.toThrow()
    expect(isMealCookSessionEnded('meal-1')).toBe(false)
  })

  it('storage being unavailable does not crash any entry point', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      expect(() => getActiveMealCookSession()).not.toThrow()
      expect(getActiveMealCookSession()).toBeNull()
      expect(() => startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])).not.toThrow()
      expect(() =>
        saveMealCookProgress({
          meal_id: 'meal-1',
          started_at_ms: 1000,
          dish_ids: ['r-main'],
          dish_step_signatures: ['1:boil'],
          steps: {},
          ingredient_amendments: {},
        }),
      ).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('meal-cook-session — a stale dish-id mismatch', () => {
  const session: MealCookSession = {
    meal_id: 'meal-1',
    started_at_ms: 1000,
    dish_ids: ['r-main', 'r-side1', 'r-side2'],
    dish_step_signatures: ['1:boil', '1:chop', '1:fry'],
    steps: {},
    ingredient_amendments: {},
  }
  const sigs = session.dish_step_signatures

  it('is not stale when the current dish ids match exactly', () => {
    expect(isStaleMealCookSession(session, ['r-main', 'r-side1', 'r-side2'], sigs)).toBe(false)
  })

  it('is stale when a side was swapped for a different recipe', () => {
    expect(isStaleMealCookSession(session, ['r-main', 'r-side1', 'r-NEW'], sigs)).toBe(true)
  })

  it('is stale when a side was removed (different length)', () => {
    expect(isStaleMealCookSession(session, ['r-main', 'r-side1'], sigs.slice(0, 2))).toBe(true)
  })

  it('is stale when a side was added (different length)', () => {
    expect(
      isStaleMealCookSession(session, ['r-main', 'r-side1', 'r-side2', 'r-side3'], [...sigs, '1:bake']),
    ).toBe(true)
  })

  it('is stale when the same ids land in different positions', () => {
    expect(
      isStaleMealCookSession(session, ['r-main', 'r-side2', 'r-side1'], [sigs[0], sigs[2], sigs[1]]),
    ).toBe(true)
  })
})

describe('meal-cook-session — a stale step-signature mismatch (issue #653 review round 1, S4)', () => {
  const session: MealCookSession = {
    meal_id: 'meal-1',
    started_at_ms: 1000,
    dish_ids: ['r-main', 'r-side1'],
    dish_step_signatures: ['2:boil|drain', '1:chop'],
    steps: {},
    ingredient_amendments: {},
  }

  it('is not stale when both dish ids and step signatures match exactly', () => {
    expect(
      isStaleMealCookSession(session, ['r-main', 'r-side1'], ['2:boil|drain', '1:chop']),
    ).toBe(false)
  })

  it('is stale when a dish id matches but its step signature changed — an ensureSteps upgrade or edited recipe landed mid-cook', () => {
    expect(
      isStaleMealCookSession(session, ['r-main', 'r-side1'], ['3:boil|drain|season', '1:chop']),
    ).toBe(true)
  })

  it('is stale when the signature count differs even if dish ids match', () => {
    expect(isStaleMealCookSession(session, ['r-main', 'r-side1'], ['2:boil|drain'])).toBe(true)
  })
})

describe('meal-cook-session — ensureCookId (issue #654, N5)', () => {
  it('a #653-shaped session with no cook_id gets a deterministic legacy id', () => {
    const legacySession: MealCookSession = {
      meal_id: 'meal-1',
      started_at_ms: 12345,
      dish_ids: ['r-main'],
      dish_step_signatures: ['1:boil'],
      steps: {},
      ingredient_amendments: {},
    }
    const first = ensureCookId(legacySession)
    const second = ensureCookId(legacySession)
    expect(first.cook_id).toBe('legacy-12345')
    // Two tabs restoring the same pre-#654 session must derive the same ref
    // so the server's claim still dedupes them.
    expect(second.cook_id).toBe(first.cook_id)
  })

  it('leaves a well-formed cook_id untouched', () => {
    const session: MealCookSession = {
      meal_id: 'meal-1',
      started_at_ms: 1000,
      dish_ids: ['r-main'],
      dish_step_signatures: ['1:boil'],
      steps: {},
      cook_id: 'a1b2c3',
      ingredient_amendments: {},
    }
    expect(ensureCookId(session)).toBe(session)
  })

  it('replaces a cook_id outside the safe charset', () => {
    const session: MealCookSession = {
      meal_id: 'meal-1',
      started_at_ms: 42,
      dish_ids: ['r-main'],
      dish_step_signatures: ['1:boil'],
      steps: {},
      cook_id: 'not a valid ref!',
      ingredient_amendments: {},
    }
    expect(ensureCookId(session).cook_id).toBe('legacy-42')
  })
})

describe('meal-cook-session — readDishAmendment (issue #654 §3)', () => {
  const baseSession: MealCookSession = {
    meal_id: 'meal-1',
    started_at_ms: 1000,
    dish_ids: ['r-main'],
    dish_step_signatures: ['1:boil'],
    steps: {},
    ingredient_amendments: {},
  }

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('a well-formed amendment seeded into storage is returned after a fresh read', () => {
    startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
    saveMealCookProgress({
      ...baseSession,
      ingredient_amendments: {
        'r-main': {
          ingredients: [{ name: 'Flour', quantity: 2, unit: 'cups' }],
          servings: 4,
          change_summary: 'Doubled the flour',
          applied_at_ms: 5000,
        },
      },
    })

    const resumed = getActiveMealCookSession('meal-1')!
    expect(readDishAmendment(resumed, 'r-main')).toEqual({
      ingredients: [{ name: 'Flour', quantity: 2, unit: 'cups' }],
      servings: 4,
      change_summary: 'Doubled the flour',
      applied_at_ms: 5000,
    })
  })

  it('returns null for a dish with no amendment', () => {
    expect(readDishAmendment(baseSession, 'r-main')).toBeNull()
  })

  const malformedCases: Array<[string, unknown]> = [
    ['a string instead of the amendment object', 'not an object'],
    ['an empty ingredients list', { ingredients: [], servings: 4, change_summary: null, applied_at_ms: 1 }],
    [
      'an ingredient object with no name',
      { ingredients: [{ quantity: 2 }], servings: 4, change_summary: null, applied_at_ms: 1 },
    ],
    [
      'an ingredient object with a blank name',
      { ingredients: [{ name: '  ' }], servings: 4, change_summary: null, applied_at_ms: 1 },
    ],
    [
      'a non-positive servings value',
      { ingredients: [{ name: 'Salt' }], servings: 0, change_summary: null, applied_at_ms: 1 },
    ],
    [
      'a non-string, non-null change_summary',
      { ingredients: [{ name: 'Salt' }], servings: 4, change_summary: 7, applied_at_ms: 1 },
    ],
  ]

  for (const [description, malformed] of malformedCases) {
    it(`gives null for a malformed amendment (${description}), and the session still restores`, () => {
      startMealCookSession('meal-1', ['r-main'], 1000, ['1:boil'])
      saveMealCookProgress({ ...baseSession, ingredient_amendments: { 'r-main': malformed } })

      const resumed = getActiveMealCookSession('meal-1')
      expect(resumed).not.toBeNull()
      expect(readDishAmendment(resumed!, 'r-main')).toBeNull()
    })
  }
})
