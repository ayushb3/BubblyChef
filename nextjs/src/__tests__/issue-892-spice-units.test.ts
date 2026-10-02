/**
 * Issue #892 -- a spice is never shown as "0.25 count Cinnamon".
 *
 * Recipes the model already wrote carry `unit: "count"` on spices, powders and
 * liquids (the amount is stored, and "flattened" recipes keep it as text). Every
 * display of a recipe line has to read such a line as "to taste" instead of a
 * fractional count, while a recipe's own unit ("tsp", "pinch") and a real count
 * ("6 carrots", half an onion) are left alone.
 */

import { cookIngredientsFor, ingredientsForStep } from '@/lib/cook-step-ingredients'
import { cookedIngredientsForDish } from '@/lib/meal-cook-deduction'
import { formatGroceryLine } from '@/lib/grocery'
import {
  cleanIngredientAmount,
  cleanIngredientString,
  isUncountableFood,
} from '@/lib/ingredient-amount'
import { formatQty } from '@/components/recipes/CookReviewBody'
import { ingredientLabel, ingredientParts, scaledIngredientLabel } from '@/lib/recipe-helpers'
import type { MealCookSession } from '@/lib/meal-cook-session'
import type { MealDishFull } from '@/types/meals'

// Roasted Honey Glazed Carrots, as the dish expansion stored it before the fix.
const STORED_INGREDIENTS = [
  { name: 'Carrots', quantity: 6, unit: 'count' },
  { name: 'Honey', quantity: 2, unit: 'tablespoon' },
  { name: 'Cinnamon', quantity: 0.25, unit: 'count' },
  { name: 'Cumin', quantity: 0.25, unit: 'count' },
  { name: 'Black pepper', quantity: 0.1, unit: 'count' },
  { name: 'Paprika', quantity: 0.25, unit: 'teaspoon' },
  { name: 'Salt', quantity: 1, unit: 'pinch' },
  { name: 'Onion', quantity: 0.5, unit: 'count' },
]

const STEP_TEXT =
  'Toss the carrots with the honey, cinnamon, cumin, black pepper, paprika, salt and onion, then roast.'

function chipLabels(servings: number, mealServings: number): string[] {
  const dish = {
    role: 'main',
    position: 0,
    recipe: { id: 'r1', servings, ingredients: STORED_INGREDIENTS },
  } as unknown as MealDishFull
  const session = { ingredient_amendments: {} } as unknown as MealCookSession
  const { ingredients, string_scale } = cookedIngredientsForDish(dish, mealServings, session)
  const list = cookIngredientsFor(ingredients, string_scale)
  return ingredientsForStep('Roast', STEP_TEXT, list).map((i) => i.label)
}

describe('cook step chips (issue #892)', () => {
  it('no spice chip reads as a count', () => {
    const labels = chipLabels(2, 2)
    expect(labels.join(' | ')).not.toMatch(/count (cinnamon|cumin|black pepper)/i)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Cinnamon, to taste',
        'Cumin, to taste',
        'Black pepper, to taste',
      ]),
    )
  })

  it("keeps the recipe's own unit", () => {
    const labels = chipLabels(2, 2)
    expect(labels).toEqual(
      expect.arrayContaining(['0.25 teaspoon Paprika', '1 pinch Salt', '2 tablespoon Honey']),
    )
  })

  it('a real count survives, including half an onion', () => {
    const labels = chipLabels(2, 2)
    expect(labels).toContain('0.5 count Onion')
    expect(labels).toContain('6 count Carrots')
  })

  it('scaling up a to-taste spice does not turn it back into a count', () => {
    const labels = chipLabels(2, 4)
    expect(labels.join(' | ')).not.toMatch(/\d+(\.\d+)? count (Cinnamon|Cumin|Black pepper)/)
    expect(labels).toContain('Cinnamon, to taste')
  })

  it('a flattened text line is read the same way', () => {
    const list = cookIngredientsFor(['0.25 count Cinnamon', '2 tbsp butter'], 1)
    expect(list.map((i) => i.label)).toEqual(['Cinnamon, to taste', '2 tbsp butter'])
    // The matcher still finds it by name.
    expect(ingredientsForStep('Season', 'Add the cinnamon.', list).map((i) => i.label)).toEqual([
      'Cinnamon, to taste',
    ])
  })
})

describe('other display paths (issue #892 sweep)', () => {
  it('the recipe page ingredient row', () => {
    const cinnamon = { name: 'Cinnamon', quantity: 0.25, unit: 'count' }
    expect(ingredientLabel(cinnamon)).toBe('Cinnamon, to taste')
    expect(ingredientParts(cinnamon)).toMatchObject({ name: 'Cinnamon', quantityText: 'to taste' })
    expect(ingredientLabel({ name: 'Cinnamon', quantity: 0.25, unit: 'tsp' })).toBe('0.25 tsp Cinnamon')
    expect(ingredientLabel({ name: 'Onion', quantity: 0.5, unit: 'count' })).toBe('0.5 count Onion')
  })

  it('a flattened recipe text row', () => {
    expect(ingredientLabel('0.25 count Cinnamon')).toBe('Cinnamon, to taste')
    expect(ingredientLabel('0.5 count onion')).toBe('0.5 count onion')
    expect(ingredientLabel('2 tbsp butter')).toBe('2 tbsp butter')
  })

  it('the meal page, scaled for the meal servings', () => {
    expect(scaledIngredientLabel({ name: 'Cumin', quantity: 0.25, unit: 'count' }, 2)).toBe('Cumin, to taste')
    expect(scaledIngredientLabel({ name: 'Cumin', quantity: 0.25, unit: 'tsp' }, 2)).toBe('0.5 tsp Cumin')
  })

  it('a grocery line (shared text)', () => {
    expect(formatGroceryLine({ name: 'cinnamon', quantity: 0.25, unit: 'count' })).toBe('- Cinnamon')
    expect(formatGroceryLine({ name: 'cinnamon', quantity: 0.25, unit: 'tsp' })).toBe('- Cinnamon (0.25 tsp)')
    expect(formatGroceryLine({ name: 'eggs', quantity: 12, unit: 'item' })).toBe('- Eggs (12 items)')
  })

})

describe('cook review deduction column (issue #892)', () => {
  it('drops the count word from a spice or liquid, keeps it elsewhere', () => {
    expect(formatQty(0.25, 'count', false, 'Cinnamon')).toBe('0.25')
    expect(formatQty(0.25, 'count', true, 'olive oil')).toBe('≈ 0.25')
    expect(formatQty(2, 'count', false, 'eggs')).toBe('2 count')
    expect(formatQty(5, 'g', false, 'Cinnamon')).toBe('5 g')
    expect(formatQty(null, 'count', false, 'Cinnamon')).toBe('—')
  })
})

describe('cleanIngredientAmount / cleanIngredientString', () => {
  it.each([
    ['Cinnamon', 0.25, 'count'],
    ['ground cumin', 0.25, 'item'],
    ['Black pepper', 0.1, 'count'],
    ['garlic powder', 0.5, 'items'],
    ['red pepper flakes', 0.25, null],
    ['olive oil', 0.5, 'count'],
    ['soy sauce', 0.25, 'count'],
    ['cinnamon', 1, 'count'],
  ])('%s %s %s is to taste', (name, quantity, unit) => {
    expect(cleanIngredientAmount(name, quantity, unit)).toEqual({
      quantity: null,
      unit: null,
      toTaste: true,
    })
  })

  it.each([
    ['cinnamon', 0.25, 'tsp'],
    ['black pepper', 1, 'pinch'],
    ['olive oil', 2, 'tbsp'],
    ['cinnamon sticks', 2, 'count'],
    ['bell pepper', 0.5, 'count'],
    ['red bell pepper', 1, 'count'],
    ['eggs', 2, 'count'],
    ['onion', 0.5, 'count'],
    ['lemon', 0.5, null],
    ['cumin', null, null],
  ])('%s %s %s is untouched', (name, quantity, unit) => {
    expect(cleanIngredientAmount(name, quantity, unit)).toEqual({ quantity, unit, toTaste: false })
  })

  it('reads a text line', () => {
    expect(cleanIngredientString('0.25 count Cinnamon')).toBe('Cinnamon, to taste')
    expect(cleanIngredientString('1/4 count ground cumin')).toBe('ground cumin, to taste')
    expect(cleanIngredientString('1/4 tsp ground cumin')).toBe('1/4 tsp ground cumin')
    expect(cleanIngredientString('6 count carrots')).toBe('6 count carrots')
    expect(cleanIngredientString('salt to taste')).toBe('salt to taste')
  })

  it.each([
    'Cinnamon',
    'ground cumin',
    'Black pepper',
    'salt and pepper',
    'smoked paprika',
    'garlic powder',
    'red pepper flakes',
    'olive oil',
    'apple cider vinegar',
    'soy sauce',
    'chicken broth',
    'vanilla extract',
    'all-purpose flour',
    'honey',
    'water',
    'lemon juice',
    'kosher salt, to taste',
  ])('%s is uncountable', (name) => {
    expect(isUncountableFood(name)).toBe(true)
  })

  it.each([
    'carrots',
    'eggs',
    'onion',
    'bell pepper',
    'red bell pepper',
    'chili pepper',
    'cinnamon stick',
    'cinnamon sticks',
    'bay leaves',
    'chicken breast',
    'lemon',
    'garlic',
    '',
  ])('%s is countable', (name) => {
    expect(isUncountableFood(name)).toBe(false)
  })
})
