/**
 * Issue #650 — pure helpers behind the meals CRUD routes.
 */
import { validateMealDishRoles, normalizeConstraints, withMealTitles } from '@/lib/meal-helpers'

describe('validateMealDishRoles (the side-count rule)', () => {
  const main = { role: 'main', position: 0 }

  it('accepts one main + one side', () => {
    expect(validateMealDishRoles([main, { role: 'side', position: 1 }])).toBeNull()
  })

  it('accepts one main + two sides', () => {
    expect(
      validateMealDishRoles([main, { role: 'side', position: 1 }, { role: 'side', position: 2 }]),
    ).toBeNull()
  })

  it('accepts a main with no side (issue #758)', () => {
    expect(validateMealDishRoles([main])).toBeNull()
  })

  it('rejects three sides', () => {
    expect(
      validateMealDishRoles([
        main,
        { role: 'side', position: 1 },
        { role: 'side', position: 2 },
        { role: 'side', position: 3 },
      ]),
    ).toMatch(/at most two sides|position/)
  })

  it('rejects zero mains', () => {
    expect(validateMealDishRoles([{ role: 'side', position: 1 }])).toMatch(/exactly one main/)
  })

  it('rejects two mains', () => {
    expect(
      validateMealDishRoles([main, { role: 'main', position: 1 }, { role: 'side', position: 2 }]),
    ).toMatch(/exactly one main/)
  })

  it('rejects a role that is neither main nor side', () => {
    expect(
      validateMealDishRoles([main, { role: 'dessert', position: 1 }]),
    ).toMatch(/main.*or.*side/)
  })

  it('rejects duplicate positions', () => {
    expect(
      validateMealDishRoles([main, { role: 'side', position: 0 }]),
    ).toMatch(/unique/)
  })
})

describe('normalizeConstraints', () => {
  it('fills in defaults for a missing/malformed payload', () => {
    expect(normalizeConstraints(undefined)).toEqual({
      kitchen_limits: [],
      exclusive_tags: [],
      recipe_constraints: {},
    })
    expect(normalizeConstraints(null)).toEqual({
      kitchen_limits: [],
      exclusive_tags: [],
      recipe_constraints: {},
    })
    expect(normalizeConstraints('not an object')).toEqual({
      kitchen_limits: [],
      exclusive_tags: [],
      recipe_constraints: {},
    })
  })

  it('passes through valid fields and drops non-string entries', () => {
    expect(
      normalizeConstraints({
        kitchen_limits: ['one pan', 42],
        exclusive_tags: ['pan'],
        recipe_constraints: { cuisine: 'italian' },
      }),
    ).toEqual({
      kitchen_limits: ['one pan'],
      exclusive_tags: ['pan'],
      recipe_constraints: { cuisine: 'italian' },
    })
  })
})

describe('withMealTitles', () => {
  it('flattens meal_dishes(meals(title)) into a deduplicated meal_titles array', () => {
    const row = {
      id: 'r1',
      title: 'Lemon chicken',
      meal_dishes: [
        { meals: { title: 'Lemon chicken dinner' } },
        { meals: { title: 'Lemon chicken dinner' } },
        { meals: { title: 'Sunday roast' } },
      ],
    }
    const result = withMealTitles(row)
    expect(result.meal_titles).toEqual(['Lemon chicken dinner', 'Sunday roast'])
    expect(result).not.toHaveProperty('meal_dishes')
  })

  it('returns an empty array, not undefined, for a recipe in no meals', () => {
    const row = { id: 'r1', title: 'Solo recipe', meal_dishes: [] }
    expect(withMealTitles(row).meal_titles).toEqual([])
  })

  it('handles an absent meal_dishes field', () => {
    const row = { id: 'r1', title: 'Solo recipe' }
    expect(withMealTitles(row).meal_titles).toEqual([])
  })
})
