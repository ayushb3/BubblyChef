/**
 * Issues #489 + #490 — a confirmed mid-cook amendment has a persisted home
 * next to the rest of the single-recipe cook session (`lib/cook-session.ts`),
 * so the deduction and a full page reload both see it.
 *
 * Shape and validation are the meal cook-along's (#654): the same
 * `MealCookIngredient` list, checked by the same `isMealCookIngredient` and
 * cleaned by the same `sanitizeMealCookIngredients`.
 */
import {
  startCookSession,
  startGuidedCookSession,
  endCookSession,
  clearActiveCookSession,
  saveAmendedCook,
  getAmendedCook,
  getAmendedIngredients,
  clearAmendedCook,
} from '@/lib/cook-session'
import {
  amendedLinesFromProposal,
  toRecipeIngredients,
} from '@/lib/cook-amendment'
import { cookingPinContext } from '@/lib/chat-seed'
import type { RecipeAmendmentProposal } from '@/types/chat'

const ROUX = [
  { name: 'pasta', quantity: 200, unit: 'g' },
  { name: 'butter', quantity: 30, unit: 'g' },
  { name: 'flour', quantity: 30, unit: 'g' },
]
const KEY = 'bubblychef:cook:amendedCook'

beforeEach(() => {
  window.localStorage.clear()
  jest.restoreAllMocks()
})

describe('saveAmendedCook / getAmendedCook', () => {
  it('has nothing on record before an amendment is applied', () => {
    expect(getAmendedCook('r1')).toBeNull()
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('round-trips the list, the title and the change summary', () => {
    saveAmendedCook('r1', { title: 'Creamy pasta', ingredients: ROUX, changeSummary: 'Roux.' })
    const got = getAmendedCook('r1')
    expect(got?.ingredients).toEqual(ROUX)
    expect(got?.recipeTitle).toBe('Creamy pasta')
    expect(got?.changeSummary).toBe('Roux.')
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
  })

  it('survives a reload: a fresh read of storage still finds it (#490)', () => {
    saveAmendedCook('r1', { title: 'Creamy pasta', ingredients: ROUX })
    const raw = window.localStorage.getItem(KEY)
    window.localStorage.clear()
    window.localStorage.setItem(KEY, raw as string)
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
  })

  it("never leaks one recipe's amendment into another recipe's lookup", () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    expect(getAmendedIngredients('r2')).toBeNull()
  })

  it('a later amendment replaces the list (the model returns the FULL list, so it stacks)', () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    const stacked = [...ROUX, { name: 'basil', quantity: 5, unit: 'g' }]
    saveAmendedCook('r1', { ingredients: stacked })
    expect(getAmendedIngredients('r1')).toEqual(stacked)
  })

  it('refuses to save for a recipe whose cook already ended', () => {
    endCookSession('r1')
    saveAmendedCook('r1', { ingredients: ROUX })
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('drops blank-named lines and saves nothing when none are usable', () => {
    saveAmendedCook('r1', { ingredients: [{ name: '  ', quantity: 1, unit: 'g' }, ...ROUX] })
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
    window.localStorage.clear()
    saveAmendedCook('r1', { ingredients: [{ name: '', quantity: 1, unit: 'g' }] })
    expect(getAmendedCook('r1')).toBeNull()
  })

  it('an amendment left by an abandoned cook expires rather than deducting days later', () => {
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now)
    saveAmendedCook('r1', { ingredients: ROUX })
    spy.mockReturnValue(now + 13 * 60 * 60 * 1000)
    expect(getAmendedIngredients('r1')).toBeNull()
    spy.mockReturnValue(now + 60 * 60 * 1000)
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
  })

  it.each([
    ['not json', 'not json'],
    ['a shape it does not know', '{"unexpected":"shape"}'],
    ['a list with a nameless line', JSON.stringify({ recipeId: 'r1', recipeTitle: '', ingredients: [{ name: '' }], changeSummary: null, savedAtMs: Date.now() })],
    ['an empty list', JSON.stringify({ recipeId: 'r1', recipeTitle: '', ingredients: [], changeSummary: null, savedAtMs: Date.now() })],
  ])('a corrupt record (%s) reads as none rather than crashing', (_label, raw) => {
    window.localStorage.setItem(KEY, raw)
    expect(() => getAmendedCook('r1')).not.toThrow()
    expect(getAmendedCook('r1')).toBeNull()
  })

  it('storage being unavailable does not crash saving or reading', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    expect(() => saveAmendedCook('r1', { ingredients: ROUX })).not.toThrow()
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    expect(getAmendedIngredients('r1')).toBeNull()
  })
})

describe('when the amendment is cleared', () => {
  it('endCookSession (a confirmed deduction) clears it, so a later cook starts from the original', () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    endCookSession('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it("endCookSession for another recipe leaves this recipe's amendment alone", () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    endCookSession('r2')
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
  })

  it('starting a fresh cook of the same recipe clears a stale amendment (chat path)', () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    startCookSession('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('starting a fresh guided cook clears it too (library path)', () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    startGuidedCookSession('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })

  it('starting a cook of a different recipe keeps the one still being cooked', () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    startCookSession('r2')
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
  })

  it('leaving the guided flow to finish does NOT clear it: the deduction sheet still needs it', () => {
    startGuidedCookSession('r1')
    saveAmendedCook('r1', { ingredients: ROUX })
    clearActiveCookSession('r1')
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
  })

  it('clearAmendedCook removes only the named recipe', () => {
    saveAmendedCook('r1', { ingredients: ROUX })
    clearAmendedCook('r2')
    expect(getAmendedIngredients('r1')).toEqual(ROUX)
    clearAmendedCook('r1')
    expect(getAmendedIngredients('r1')).toBeNull()
  })
})

describe('lib/cook-amendment helpers', () => {
  const proposal: RecipeAmendmentProposal = {
    proposal_type: 'recipe_amendment',
    is_amendment: true,
    amended_ingredients: [
      { name: 'butter', quantity: 30, unit: 'g', optional: false, notes: null },
      { name: '   ', quantity: 1, unit: 'g', optional: false, notes: null },
      { name: 'flour', quantity: 30, unit: 'g', optional: true, notes: 'sifted' },
    ],
    change_summary: 'Roux.',
    recipe_id: 'r1',
    recipe_title: 'Creamy pasta',
  }

  it('maps a proposal to the cook list, dropping nameless lines', () => {
    expect(amendedLinesFromProposal(proposal)).toEqual([
      { name: 'butter', quantity: 30, unit: 'g', optional: false },
      { name: 'flour', quantity: 30, unit: 'g', optional: true, notes: 'sifted' },
    ])
  })

  it('shows an amended list as recipe ingredients (name, quantity, unit, optional)', () => {
    expect(toRecipeIngredients(amendedLinesFromProposal(proposal))).toEqual([
      { name: 'butter', quantity: 30, unit: 'g', optional: false },
      { name: 'flour', quantity: 30, unit: 'g', optional: true },
    ])
  })

  it('builds the full cook pin the chat sends so the amended list is what the model sees', () => {
    expect(cookingPinContext('r1', 'Creamy pasta', ROUX)).toEqual({
      cooking_recipe: { id: 'r1', title: 'Creamy pasta', ingredients: ROUX },
    })
  })
})
