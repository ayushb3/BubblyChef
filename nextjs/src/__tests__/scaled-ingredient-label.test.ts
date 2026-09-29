/**
 * Issue #650 — `scaledIngredientLabel`, the pure function the meal page uses
 * to scale each dish's displayed ingredient quantities by
 * `meal.servings / recipe.servings`.
 */
import { scaledIngredientLabel } from '@/lib/recipe-helpers'

describe('scaledIngredientLabel', () => {
  it('scales the object shape\'s numeric quantity', () => {
    expect(scaledIngredientLabel({ name: 'chicken thighs', quantity: 2, unit: 'lb' }, 2)).toBe(
      '4 lb chicken thighs',
    )
  })

  it('rounds to 2 decimals and trims trailing zeros', () => {
    expect(scaledIngredientLabel({ name: 'butter', quantity: 1, unit: 'tbsp' }, 1.5)).toBe(
      '1.5 tbsp butter',
    )
    // 1/3 of 1 = 0.333... -> rounds to 0.33
    expect(scaledIngredientLabel({ name: 'flour', quantity: 1, unit: 'cup' }, 1 / 3)).toBe(
      '0.33 cup flour',
    )
  })

  it('a scale of 1 (equal servings) renders unchanged', () => {
    expect(scaledIngredientLabel({ name: 'salt', quantity: 1, unit: 'tsp' }, 1)).toBe('1 tsp salt')
  })

  it('a non-finite or non-positive scale degrades to unscaled, never a negative quantity', () => {
    expect(scaledIngredientLabel({ name: 'salt', quantity: 1, unit: 'tsp' }, 0)).toBe('1 tsp salt')
    expect(scaledIngredientLabel({ name: 'salt', quantity: 1, unit: 'tsp' }, -1)).toBe('1 tsp salt')
    expect(scaledIngredientLabel({ name: 'salt', quantity: 1, unit: 'tsp' }, NaN)).toBe('1 tsp salt')
  })

  it('an object with no quantity renders unchanged regardless of scale', () => {
    expect(scaledIngredientLabel({ name: 'salt to taste' }, 3)).toBe('salt to taste')
  })

  it('the string shape has no numeric field to scale — renders unchanged', () => {
    expect(scaledIngredientLabel('2 cups flour', 2)).toBe('2 cups flour')
  })

  it('handles null/undefined the same as ingredientLabel', () => {
    expect(scaledIngredientLabel(null, 2)).toBe('')
    expect(scaledIngredientLabel(undefined, 2)).toBe('')
  })
})
