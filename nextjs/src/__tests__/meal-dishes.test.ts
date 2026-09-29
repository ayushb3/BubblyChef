/**
 * Issue #653 — `lib/meal-dishes.ts`, pulled out of `app/meals/[id]/page.tsx`
 * (issue #652) so the meal screen and the cook-along route build the
 * identical `SchedulerDish[]` from the same `Meal`. Pure refactor: these
 * tests pin the exact behaviour that moved, so a regression here would catch
 * either page silently drifting from the other.
 */

import { columnFor, fallbackSteps, schedulerDishesForMeal } from '@/lib/meal-dishes'
import type { Meal } from '@/types/meals'
import type { Recipe } from '@/components/recipes/RecipePage'

describe('columnFor', () => {
  it('maps position 0 to main, 1 to side_1, 2 to side_2', () => {
    expect(columnFor(0)).toBe('main')
    expect(columnFor(1)).toBe('side_1')
    expect(columnFor(2)).toBe('side_2')
  })
})

describe('fallbackSteps', () => {
  it('builds one estimated 3-min step per instruction, each depending on the one before it', () => {
    const steps = fallbackSteps(['Boil the pasta', 'Drain it'])
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({
      text: 'Boil the pasta',
      label: 'Boil the pasta',
      duration_minutes: 3,
      duration_estimated: true,
      hands_on: true,
      depends_on: [],
    })
    expect(steps[1].depends_on).toEqual([0])
  })

  it('truncates a long instruction to a 40-char label with an ellipsis', () => {
    const long = 'Simmer the sauce until it thickens and coats the back of a spoon'
    const [step] = fallbackSteps([long])
    expect(step.text).toBe(long)
    expect(step.label).toBe(`${long.slice(0, 40)}…`)
  })
})

describe('schedulerDishesForMeal', () => {
  function recipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
      id: 'r1',
      user_id: 'u1',
      title: 'Dish',
      ingredients: [],
      instructions: ['Do the thing'],
      servings: 2,
      ...overrides,
    }
  }

  function meal(overrides: Partial<Meal> = {}): Meal {
    return {
      id: 'meal-1',
      user_id: 'u1',
      title: 'Dinner',
      description: null,
      servings: 2,
      constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
      is_draft: false,
      source_type: 'chat',
      last_cooked_at: null,
      times_cooked: 0,
      created_at: 't',
      updated_at: 't',
      dishes: [],
      ...overrides,
    }
  }

  it('sorts by position and maps each dish to a SchedulerDish', () => {
    const m = meal({
      dishes: [
        { role: 'side', position: 2, recipe: recipe({ id: 'r-side2', title: 'Salad' }) },
        { role: 'main', position: 0, recipe: recipe({ id: 'r-main', title: 'Chicken' }) },
        { role: 'side', position: 1, recipe: recipe({ id: 'r-side1', title: 'Rice' }) },
      ],
    })

    const dishes = schedulerDishesForMeal(m)
    expect(dishes.map((d) => d.dish_id)).toEqual(['r-main', 'r-side1', 'r-side2'])
    expect(dishes.map((d) => d.column)).toEqual(['main', 'side_1', 'side_2'])
    expect(dishes.map((d) => d.title)).toEqual(['Chicken', 'Rice', 'Salad'])
  })

  it('uses a dish recipe\'s own structured steps when it has them', () => {
    const structuredStep = {
      text: 'Sear it',
      label: 'Sear it',
      ongoing_label: null,
      duration_minutes: 5,
      duration_estimated: false,
      hands_on: true,
      depends_on: [],
      exclusive: [],
    }
    const m = meal({
      dishes: [{ role: 'main', position: 0, recipe: recipe({ steps: [structuredStep] }) }],
    })

    expect(schedulerDishesForMeal(m)[0].steps).toEqual([structuredStep])
  })

  it('falls back to sequential estimated steps when a dish has none', () => {
    const m = meal({
      dishes: [
        {
          role: 'main',
          position: 0,
          recipe: recipe({ steps: null, instructions: ['Chop', 'Cook'] }),
        },
      ],
    })

    const steps = schedulerDishesForMeal(m)[0].steps
    expect(steps).toHaveLength(2)
    expect(steps.every((s) => s.duration_estimated)).toBe(true)
  })

  it('also falls back when steps is an empty array', () => {
    const m = meal({
      dishes: [{ role: 'main', position: 0, recipe: recipe({ steps: [], instructions: ['Chop'] }) }],
    })
    expect(schedulerDishesForMeal(m)[0].steps).toHaveLength(1)
  })
})
