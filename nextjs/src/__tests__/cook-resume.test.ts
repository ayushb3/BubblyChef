/**
 * The Bubbles card's "Back to the lemon pasta? You were on step 4 of 7" (issue #755):
 * a cook session on record, plus the recipe or meal it is for, as the card's words.
 */
import { mealCookResume, recipeCookResume } from '@/lib/kitchen/cook-resume'
import type { MealCookSession } from '@/lib/meal-cook-session'
import { dishStepSignaturesForMeal } from '@/lib/meal-dishes'
import type { Meal } from '@/types/meals'

const recipe = (n: number) => ({
  id: 'r-1',
  title: 'Lemon pasta',
  instructions: Array.from({ length: n }, (_, i) => `Do thing ${i + 1}`),
})

describe('recipeCookResume', () => {
  it('counts steps from 1: the guided flow stores a 0-based index', () => {
    expect(recipeCookResume({ recipeId: 'r-1', step: 3 }, recipe(7))).toEqual({
      kind: 'recipe',
      id: 'r-1',
      title: 'Lemon pasta',
      step: 4,
      totalSteps: 7,
    })
  })

  it('the prep screen (-1) is step 1', () => {
    expect(recipeCookResume({ recipeId: 'r-1', step: -1 }, recipe(7))?.step).toBe(1)
  })

  it('never goes past the last step', () => {
    expect(recipeCookResume({ recipeId: 'r-1', step: 12 }, recipe(7))?.step).toBe(7)
  })

  it('a recipe with no steps still gets a card, without a count', () => {
    const r = recipeCookResume({ recipeId: 'r-1', step: 0 }, recipe(0))!
    expect(r.step).toBe(1)
    expect(r.totalSteps).toBe(0)
  })

  it('is not for a different recipe', () => {
    expect(recipeCookResume({ recipeId: 'other', step: 1 }, recipe(7))).toBeNull()
  })
})

function meal(): Meal {
  const dish = (id: string, title: string, position: number, steps: number) => ({
    role: position === 0 ? ('main' as const) : ('side' as const),
    position,
    recipe: {
      id,
      user_id: 'u',
      title,
      ingredients: [],
      instructions: Array.from({ length: steps }, (_, i) => `${title} step ${i + 1}`),
      steps: null,
    },
  })
  return {
    id: 'm-1',
    user_id: 'u',
    title: 'Pasta night',
    description: null,
    servings: 2,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
    is_draft: false,
    source_type: 'chat',
    last_cooked_at: null,
    times_cooked: 0,
    created_at: '2026-09-30T00:00:00Z',
    updated_at: '2026-09-30T00:00:00Z',
    dishes: [dish('d-1', 'Pasta', 0, 5), dish('d-2', 'Rice', 1, 4)],
  } as unknown as Meal
}

function session(over: Partial<MealCookSession> = {}): MealCookSession {
  const m = meal()
  return {
    meal_id: 'm-1',
    started_at_ms: 1,
    dish_ids: ['d-1', 'd-2'],
    dish_step_signatures: dishStepSignaturesForMeal(m),
    steps: {},
    ingredient_amendments: {},
    ...over,
  }
}

const rec = (status: 'done' | 'skipped' | 'running') => ({
  status,
  started_at_minutes: 0,
  extra_minutes: 0,
})

describe('mealCookResume', () => {
  it('a cook just started is on step 1 of every step across the dishes', () => {
    expect(mealCookResume(session(), meal())).toEqual({
      kind: 'meal',
      id: 'm-1',
      title: 'Pasta night',
      step: 1,
      totalSteps: 9,
    })
  })

  it('done and skipped steps are behind you; a running one is where you are', () => {
    const s = session({
      steps: {
        'd-1:0': rec('done'),
        'd-1:1': rec('done'),
        'd-2:0': rec('skipped'),
        'd-1:2': rec('running'),
      },
    })
    expect(mealCookResume(s, meal())?.step).toBe(4)
  })

  it('never goes past the last step', () => {
    const steps: MealCookSession['steps'] = {}
    for (const [id, n] of [['d-1', 5], ['d-2', 4]] as const) {
      for (let i = 0; i < n; i++) steps[`${id}:${i}`] = rec('done')
    }
    expect(mealCookResume(session({ steps }), meal())?.step).toBe(9)
  })

  it('a session for another meal is not this meal', () => {
    expect(mealCookResume(session({ meal_id: 'other' }), meal())).toBeNull()
  })

  it('a stale session (a dish was swapped) is left to the meal screen', () => {
    expect(mealCookResume(session({ dish_ids: ['d-1', 'swapped'] }), meal())).toBeNull()
  })
})
