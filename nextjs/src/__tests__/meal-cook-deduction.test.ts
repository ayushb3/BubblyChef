/**
 * Issue #654 §3 — `lib/meal-cook-deduction.ts`: the pure helpers that turn a
 * meal cook-along session into the request `POST /api/ai/meals/cook` (and
 * its confirm) send. Pure unit tests, no I/O, following the style of
 * `meal-cook-stream.test.ts`.
 */

import {
  recipeServingsFor,
  cookedDishIds,
  cookedIngredientsForDish,
  buildMealCookRequest,
} from '@/lib/meal-cook-deduction'
import type { SchedulerDish } from '@/lib/meal-scheduler'
import type { MealCookSession } from '@/lib/meal-cook-session'
import type { Meal, MealDishFull } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Step } from '@/types/recipes'

function step(overrides: Partial<Step> & { text: string; label: string; duration_minutes: number; hands_on: boolean }): Step {
  return { ongoing_label: null, duration_estimated: false, depends_on: [], exclusive: [], ...overrides }
}

function recipe(overrides: Partial<Recipe> & { id: string; title: string }): Recipe {
  return {
    user_id: 'user-1',
    ingredients: [],
    instructions: [],
    ...overrides,
  }
}

function dish(overrides: Partial<MealDishFull> & { recipe: Recipe }): MealDishFull {
  return { role: 'main', position: 0, ...overrides }
}

function session(overrides: Partial<MealCookSession> = {}): MealCookSession {
  return {
    meal_id: 'meal-1',
    started_at_ms: 0,
    dish_ids: ['main'],
    dish_step_signatures: ['1:x'],
    steps: {},
    ingredient_amendments: {},
    ...overrides,
  }
}

function meal(overrides: Partial<Meal> & { dishes: MealDishFull[] }): Meal {
  return {
    id: 'meal-1',
    user_id: 'user-1',
    title: 'Dinner',
    description: null,
    servings: 4,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
    is_draft: false,
    source_type: 'chat',
    last_cooked_at: null,
    times_cooked: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('recipeServingsFor', () => {
  it("uses the recipe's own servings when positive", () => {
    const d = dish({ recipe: recipe({ id: 'r1', title: 'Pasta', servings: 2 }) })
    expect(recipeServingsFor(d, 4)).toBe(2)
  })

  it('borrows the meal servings when the recipe has none (or zero)', () => {
    const d = dish({ recipe: recipe({ id: 'r1', title: 'Pasta', servings: 0 }) })
    expect(recipeServingsFor(d, 4)).toBe(4)
    const d2 = dish({ recipe: recipe({ id: 'r1', title: 'Pasta' }) })
    expect(recipeServingsFor(d2, 4)).toBe(4)
  })
})

describe('cookedDishIds (S9)', () => {
  it('excludes a dish whose every step was skipped', () => {
    const main: SchedulerDish = { dish_id: 'main', column: 'main', title: 'Main', steps: [step({ text: 'a', label: 'a', duration_minutes: 1, hands_on: true })] }
    const side: SchedulerDish = { dish_id: 'side', column: 'side_1', title: 'Side', steps: [step({ text: 'b', label: 'b', duration_minutes: 1, hands_on: true })] }
    const s = session({
      dish_ids: ['main', 'side'],
      steps: { 'side:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 } },
    })

    expect(cookedDishIds([main, side], s)).toEqual(['main'])
  })

  it('a zero-step dish counts as cooked', () => {
    const empty: SchedulerDish = { dish_id: 'main', column: 'main', title: 'Main', steps: [] }
    expect(cookedDishIds([empty], session())).toEqual(['main'])
  })

  it('a partial skip (one skipped, one not) still counts the dish as cooked', () => {
    const main: SchedulerDish = {
      dish_id: 'main',
      column: 'main',
      title: 'Main',
      steps: [
        step({ text: 'a', label: 'a', duration_minutes: 1, hands_on: true }),
        step({ text: 'b', label: 'b', duration_minutes: 1, hands_on: true }),
      ],
    }
    const s = session({
      steps: { 'main:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 } },
    })
    expect(cookedDishIds([main], s)).toEqual(['main'])
  })
})

describe('cookedIngredientsForDish', () => {
  it('scales an object ingredient by the meal-screen factor, and leaves a string unscaled with the right string_scale', () => {
    const r = recipe({
      id: 'r1',
      title: 'Pasta',
      servings: 2,
      ingredients: [{ name: 'Garlic', quantity: 1, unit: 'clove' }, '2 cups flour'],
    })
    const d = dish({ recipe: r })

    const { ingredients, string_scale } = cookedIngredientsForDish(d, 4, session())

    expect(string_scale).toBe(2) // meal servings 4 / recipe servings 2
    expect(ingredients).toEqual([{ name: 'Garlic', quantity: 2, unit: 'clove' }, '2 cups flour'])
  })

  it('drops preparation from an object ingredient', () => {
    const r = recipe({
      id: 'r1',
      title: 'Pasta',
      servings: 4,
      ingredients: [{ name: 'Onion', quantity: 1, unit: 'whole', preparation: 'diced' }],
    })
    const d = dish({ recipe: r })
    const { ingredients } = cookedIngredientsForDish(d, 4, session())
    expect(ingredients).toEqual([{ name: 'Onion', quantity: 1, unit: 'whole' }])
  })

  it('uses a valid amendment instead of the recipe row, rescaled for a different servings count', () => {
    const r = recipe({ id: 'r1', title: 'Pasta', servings: 2, ingredients: [{ name: 'Old', quantity: 1, unit: 'g' }] })
    const d = dish({ recipe: r })
    const s = session({
      ingredient_amendments: {
        r1: {
          ingredients: [{ name: 'New', quantity: 2, unit: 'g' }],
          servings: 2,
          change_summary: 'Swapped in New',
          applied_at_ms: 1,
        },
      },
    })

    const { ingredients } = cookedIngredientsForDish(d, 4, s)
    // mealServings 4 / amendment.servings 2 = factor 2
    expect(ingredients).toEqual([{ name: 'New', quantity: 4, unit: 'g' }])
  })

  it('an unamended dish with a matching amendment servings applies no rescale', () => {
    const r = recipe({ id: 'r1', title: 'Pasta', servings: 4, ingredients: [] })
    const d = dish({ recipe: r })
    const s = session({
      ingredient_amendments: {
        r1: { ingredients: [{ name: 'Basil', quantity: 3, unit: 'leaves' }], servings: 4, change_summary: null, applied_at_ms: 1 },
      },
    })
    const { ingredients } = cookedIngredientsForDish(d, 4, s)
    expect(ingredients).toEqual([{ name: 'Basil', quantity: 3, unit: 'leaves' }])
  })

  it('sanitizes a nameless object and a NaN quantity, and caps at 100 elements (S5)', () => {
    const longList = Array.from({ length: 120 }, (_, i) => `ingredient ${i}`)
    const r = recipe({
      id: 'r1',
      title: 'Pasta',
      servings: 4,
      ingredients: [
        { name: '', quantity: 1, unit: 'g' } as never,
        { name: 'Salt', quantity: Number.NaN, unit: 'g' },
        ...longList,
      ],
    })
    const d = dish({ recipe: r })
    const { ingredients } = cookedIngredientsForDish(d, 4, session())

    expect(ingredients).toHaveLength(100)
    expect(ingredients[0]).toEqual({ name: 'Salt', quantity: null, unit: 'g' })
  })
})

describe('buildMealCookRequest', () => {
  it('sends every cooked dish with its ingredients and string_scale', () => {
    const rMain = recipe({ id: 'main', title: 'Main dish', servings: 4, ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup' }] })
    const rSide = recipe({ id: 'side', title: 'Side dish', servings: 4, ingredients: [{ name: 'Peas', quantity: 1, unit: 'cup' }] })
    const m = meal({
      servings: 4,
      dishes: [dish({ role: 'main', position: 0, recipe: rMain }), dish({ role: 'side', position: 1, recipe: rSide })],
    })
    const mainDish: SchedulerDish = { dish_id: 'main', column: 'main', title: 'Main', steps: [step({ text: 'a', label: 'a', duration_minutes: 1, hands_on: true })] }
    const sideDish: SchedulerDish = { dish_id: 'side', column: 'side_1', title: 'Side', steps: [step({ text: 'b', label: 'b', duration_minutes: 1, hands_on: true })] }
    const s = session({ dish_ids: ['main', 'side'] })

    const req = buildMealCookRequest(m, s, [mainDish, sideDish])

    expect(req).toEqual({
      meal_id: 'meal-1',
      servings: 4,
      dishes: [
        { recipe_id: 'main', ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup' }], string_scale: 1 },
        { recipe_id: 'side', ingredients: [{ name: 'Peas', quantity: 1, unit: 'cup' }], string_scale: 1 },
      ],
    })
  })

  it('excludes an all-skipped dish', () => {
    const rMain = recipe({ id: 'main', title: 'Main dish', servings: 4, ingredients: [] })
    const rSide = recipe({ id: 'side', title: 'Side dish', servings: 4, ingredients: [] })
    const m = meal({
      servings: 4,
      dishes: [dish({ role: 'main', position: 0, recipe: rMain }), dish({ role: 'side', position: 1, recipe: rSide })],
    })
    const mainDish: SchedulerDish = { dish_id: 'main', column: 'main', title: 'Main', steps: [step({ text: 'a', label: 'a', duration_minutes: 1, hands_on: true })] }
    const sideDish: SchedulerDish = { dish_id: 'side', column: 'side_1', title: 'Side', steps: [step({ text: 'b', label: 'b', duration_minutes: 1, hands_on: true })] }
    const s = session({
      dish_ids: ['main', 'side'],
      steps: { 'side:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 } },
    })

    const req = buildMealCookRequest(m, s, [mainDish, sideDish])
    expect(req?.dishes.map((d) => d.recipe_id)).toEqual(['main'])
  })

  it('gives null when no dish was cooked', () => {
    const rMain = recipe({ id: 'main', title: 'Main dish', servings: 4, ingredients: [] })
    const m = meal({ servings: 4, dishes: [dish({ role: 'main', position: 0, recipe: rMain })] })
    const mainDish: SchedulerDish = { dish_id: 'main', column: 'main', title: 'Main', steps: [step({ text: 'a', label: 'a', duration_minutes: 1, hands_on: true })] }
    const s = session({
      dish_ids: ['main'],
      steps: { 'main:0': { status: 'skipped', started_at_minutes: 0, extra_minutes: 0 } },
    })

    expect(buildMealCookRequest(m, s, [mainDish])).toBeNull()
  })
})
