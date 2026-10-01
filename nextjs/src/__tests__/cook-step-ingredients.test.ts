/**
 * Issue #849 — matching a cook step to the dish ingredients it uses, with the
 * scaled amounts. Deterministic, no AI: a step that names nothing gets nothing.
 */

import {
  cookIngredientsFor,
  ingredientsForStep,
  scaleIngredientString,
} from '@/lib/cook-step-ingredients'
import { cookedIngredientsForDish } from '@/lib/meal-cook-deduction'
import type { MealDishFull } from '@/types/meals'
import type { MealCookSession } from '@/lib/meal-cook-session'

const labels = (r: { label: string }[]) => r.map((x) => x.label)

describe('ingredientsForStep (issue #849)', () => {
  const pasta = cookIngredientsFor(
    [
      { name: 'butter', quantity: 2, unit: 'tbsp' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'spaghetti', quantity: 200, unit: 'g' },
      { name: 'salt', quantity: null, unit: null },
    ],
    1,
  )

  it('shows the amount of an ingredient the step names', () => {
    expect(labels(ingredientsForStep('Melt the butter', 'Melt the butter in a pan.', pasta))).toEqual(['2 tbsp butter'])
  })

  it('lists every ingredient a step names, in the dish list order', () => {
    const r = ingredientsForStep('Saute', 'Cook the garlic in the butter until soft.', pasta)
    expect(labels(r)).toEqual(['2 tbsp butter', '3 clove garlic'])
  })

  it('no match: no chips, never a guess', () => {
    expect(ingredientsForStep('Rest', 'Let everything rest for a few minutes.', pasta)).toEqual([])
    expect(ingredientsForStep('', '', pasta)).toEqual([])
  })

  it('an ingredient with no amount still shows by name', () => {
    expect(labels(ingredientsForStep('Season', 'Season with salt.', pasta))).toEqual(['salt'])
  })

  it('plural in the step matches a singular ingredient and the reverse', () => {
    const eggs = cookIngredientsFor([{ name: 'egg', quantity: 2, unit: null }], 1)
    expect(labels(ingredientsForStep('Crack', 'Crack the eggs into a bowl.', eggs))).toEqual(['2 egg'])
    const tomatoes = cookIngredientsFor([{ name: 'tomatoes', quantity: 4, unit: null }], 1)
    expect(labels(ingredientsForStep('Chop', 'Chop the tomato.', tomatoes))).toEqual(['4 tomatoes'])
  })

  it('matches the head word when it is unique on the list', () => {
    const list = cookIngredientsFor([{ name: 'unsalted butter', quantity: 50, unit: 'g' }], 1)
    expect(labels(ingredientsForStep('Melt', 'Melt the butter.', list))).toEqual(['50 g unsalted butter'])
  })

  it('an ambiguous head word matches neither ingredient', () => {
    const oils = cookIngredientsFor(
      [
        { name: 'olive oil', quantity: 2, unit: 'tbsp' },
        { name: 'sesame oil', quantity: 1, unit: 'tsp' },
      ],
      1,
    )
    expect(ingredientsForStep('Heat', 'Heat the oil in a pan.', oils)).toEqual([])
    expect(labels(ingredientsForStep('Heat', 'Heat the olive oil in a pan.', oils))).toEqual(['2 tbsp olive oil'])
  })

  it('does not match inside another word', () => {
    const list = cookIngredientsFor([{ name: 'salt', quantity: 1, unit: 'tsp' }], 1)
    expect(ingredientsForStep('Cook', 'Cook the salted fish.', list)).toEqual([])
  })

  it('reads a plain-string ingredient by its name, not its amount', () => {
    const list = cookIngredientsFor(['2 cloves garlic, minced', '1 tbsp olive oil'], 1)
    expect(labels(ingredientsForStep('Fry', 'Fry the garlic for a minute.', list))).toEqual(['2 cloves garlic, minced'])
  })
})

describe('scaled amounts (issue #849)', () => {
  it('scales a plain-string ingredient by the meal factor', () => {
    expect(scaleIngredientString('2 tbsp butter', 2)).toBe('4 tbsp butter')
    expect(scaleIngredientString('1/2 cup milk', 3)).toBe('1.5 cup milk')
    expect(scaleIngredientString('1 1/2 cups flour', 2)).toBe('3 cups flour')
    expect(scaleIngredientString('1½ cups flour', 2)).toBe('3 cups flour')
    expect(scaleIngredientString('salt to taste', 2)).toBe('salt to taste')
    expect(scaleIngredientString('2 tbsp butter', 1)).toBe('2 tbsp butter')
  })

  it('a step on a 4-serving meal from a 2-serving recipe shows doubled amounts', () => {
    const dish = {
      role: 'main',
      position: 0,
      recipe: {
        id: 'r1',
        servings: 2,
        ingredients: [{ name: 'butter', quantity: 2, unit: 'tbsp' }, '1 tsp salt'],
      },
    } as unknown as MealDishFull
    const session = { ingredient_amendments: {} } as unknown as MealCookSession
    const { ingredients, string_scale } = cookedIngredientsForDish(dish, 4, session)
    const list = cookIngredientsFor(ingredients, string_scale)
    expect(labels(ingredientsForStep('Melt', 'Melt the butter.', list))).toEqual(['4 tbsp butter'])
    expect(labels(ingredientsForStep('Season', 'Season with the salt.', list))).toEqual(['2 tsp salt'])
  })

  it('a quantity of 1 piece reads without the filler "item" unit', () => {
    const list = cookIngredientsFor([{ name: 'onion', quantity: 1, unit: 'item' }], 1)
    expect(labels(list)).toEqual(['1 onion'])
  })
})
