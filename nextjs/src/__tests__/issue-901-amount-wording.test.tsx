/**
 * Issue #901 -- ingredient amounts read like a recipe, not like a database row.
 *
 *   "1 count Eggs"            -> "1 egg"
 *   "3 tablespoon Sugar"      -> "3 tbsp Sugar"
 *   "3.5 teaspoon Baking Powder" -> "3½ tsp Baking Powder"
 *   "1.25 cups Milk"          -> "1¼ cups Milk"
 *
 * One formatter (`lib/ingredient-amount.ts`) is read by every ingredient display
 * path: chat recipe card, recipe page, meal view, cook chips, cook amendment and
 * the cook review's "from" note. Grocery and pantry quantities are NOT recipe
 * lines and stay as they are ("Milk (2 items)").
 */

import React from 'react'
import { render, screen, within } from '@testing-library/react'
import RecipeCard from '@/components/recipes/RecipeCard'
import CookingAmendmentCard from '@/components/chat/CookingAmendmentCard'
import { cookIngredientsFor } from '@/lib/cook-step-ingredients'
import { formatGroceryLine } from '@/lib/grocery'
import { formatAmount } from '@/lib/format'
import {
  formatIngredientAmount,
  formatIngredientText,
  formatQuantity,
  formatUnit,
} from '@/lib/ingredient-amount'
import { ingredientLabel, ingredientParts, scaledIngredientLabel } from '@/lib/recipe-helpers'
import type { ChatRecipeData } from '@/types/chat'
import type { RecipeAmendmentProposal } from '@/types/chat'

jest.mock('framer-motion', () => {
  function passthrough(Tag: string) {
    function MotionStub({ children, ...rest }: React.HTMLAttributes<HTMLElement>) {
      const { initial: _i, animate: _a, transition: _t, exit: _e, ...safe } = rest as Record<string, unknown>
      return React.createElement(Tag, safe, children)
    }
    MotionStub.displayName = `motion.${Tag}`
    return MotionStub
  }
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) })
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  }
})

// The pancake recipe from the dogfood screenshot, as the model stored it.
const PANCAKES = [
  { name: 'flour', quantity: 1.5, unit: 'cups' },
  { name: 'sugar', quantity: 3, unit: 'tablespoon' },
  { name: 'baking powder', quantity: 3.5, unit: 'teaspoon' },
  { name: 'salt', quantity: 1, unit: 'teaspoon' },
  { name: 'milk', quantity: 1.25, unit: 'cups' },
  { name: 'eggs', quantity: 1, unit: 'count' },
  { name: 'butter', quantity: 3, unit: 'tablespoon' },
  { name: 'chocolate chips', quantity: 0.75, unit: 'cups' },
]

describe('formatQuantity: fraction glyphs', () => {
  it.each([
    [0.25, '¼'],
    [1 / 3, '⅓'],
    [0.5, '½'],
    [2 / 3, '⅔'],
    [0.75, '¾'],
    [1.5, '1½'],
    [1.25, '1¼'],
    [3.5, '3½'],
    [2.75, '2¾'],
    [1.33, '1⅓'],
    [0.67, '⅔'],
    [3, '3'],
    [200, '200'],
  ])('%p reads %p', (n, text) => {
    expect(formatQuantity(n)).toBe(text)
  })

  it('leaves an amount that is not a common fraction as a short decimal', () => {
    expect(formatQuantity(0.2)).toBe('0.2')
    expect(formatQuantity(1.2000000001)).toBe('1.2')
    expect(formatQuantity(2.4)).toBe('2.4')
  })

  it('does not turn 0.999 into "0¾"-style noise', () => {
    expect(formatQuantity(0.999)).toBe('1')
    expect(formatQuantity(2.999)).toBe('3')
  })
})

describe('formatUnit: plural by amount, house abbreviations', () => {
  it('uses the abbreviations the pantry vocabulary already uses', () => {
    expect(formatUnit('tablespoon', 3)).toBe('tbsp')
    expect(formatUnit('tablespoons', 1)).toBe('tbsp')
    expect(formatUnit('teaspoon', 3.5)).toBe('tsp')
    expect(formatUnit('ounces', 8)).toBe('oz')
    expect(formatUnit('pounds', 2)).toBe('lb')
    expect(formatUnit('grams', 200)).toBe('g')
    expect(formatUnit('tbsp', 2)).toBe('tbsp')
  })

  it('pluralises a countable unit above 1 and keeps it singular at 1 or less', () => {
    expect(formatUnit('cup', 1)).toBe('cup')
    expect(formatUnit('cups', 1)).toBe('cup')
    expect(formatUnit('cup', 1.5)).toBe('cups')
    expect(formatUnit('cup', 2)).toBe('cups')
    expect(formatUnit('cups', 0.5)).toBe('cup')
    expect(formatUnit('clove', 3)).toBe('cloves')
    expect(formatUnit('cloves', 1)).toBe('clove')
    expect(formatUnit('can', 2)).toBe('cans')
    expect(formatUnit('pinch', 2)).toBe('pinches')
    expect(formatUnit('slice', 4)).toBe('slices')
  })

  it('never prints count', () => {
    expect(formatUnit('count', 2)).toBe('')
    expect(formatUnit('counts', 2)).toBe('')
    expect(formatUnit('ct', 2)).toBe('')
  })

  it('leaves a unit it does not know exactly as written', () => {
    expect(formatUnit('block', 2)).toBe('block')
    expect(formatUnit('items', 2)).toBe('items')
  })
})

describe('formatIngredientAmount (object lines)', () => {
  const read = (name: string, quantity: number | string | null, unit: string | null) => {
    const a = formatIngredientAmount(name, quantity, unit)
    return [a.quantityText, a.name].filter(Boolean).join(' ')
  }

  it('drops count and sets the food by the amount', () => {
    expect(read('eggs', 1, 'count')).toBe('1 egg')
    expect(read('Eggs', 1, 'count')).toBe('1 Egg')
    expect(read('egg', 2, 'count')).toBe('2 eggs')
    expect(read('eggs', 2, 'count')).toBe('2 eggs')
    expect(read('Eggs', 12, 'counts')).toBe('12 Eggs')
    expect(read('carrots', 6, 'count')).toBe('6 carrots')
    expect(read('onion', 0.5, 'count')).toBe('½ onion')
    expect(read('onions', 1.5, 'count')).toBe('1½ onions')
    expect(read('tomatoes', 1, 'count')).toBe('1 tomato')
    expect(read('tomato', 3, 'count')).toBe('3 tomatoes')
    expect(read('strawberries', 1, 'count')).toBe('1 strawberry')
    expect(read('cookie', 4, 'count')).toBe('4 cookies')
    expect(read('chocolate chips', 1, 'count')).toBe('1 chocolate chip')
  })

  it('inflects the food, not what follows a comma or a bracket', () => {
    expect(read('eggs, beaten', 1, 'count')).toBe('1 egg, beaten')
    expect(read('egg (large)', 2, 'count')).toBe('2 eggs (large)')
  })

  it('keeps a food whose name ends in s but is not a plural', () => {
    expect(read('asparagus', 2, 'count')).toBe('2 asparagus')
    expect(read('brussels sprouts', 1, 'count')).toBe('1 brussels sprout')
    expect(read('swiss chard', 2, 'count')).toBe('2 swiss chards')
    // Uncountable, so a count of it is "to taste" (#892), not "1 molasse".
    expect(read('molasses', 1, 'count')).toBe('to taste molasses')
  })

  it('does not inflect the food when the unit is a real unit', () => {
    expect(read('eggs', 1, 'cup')).toBe('1 cup eggs')
    expect(read('sugar', 3, 'tablespoon')).toBe('3 tbsp sugar')
  })

  it('still reads an uncountable count as "to taste" (#892)', () => {
    expect(formatIngredientAmount('Cinnamon', 0.25, 'count')).toEqual({
      quantityText: 'to taste',
      name: 'Cinnamon',
      toTaste: true,
    })
  })

  it('reads a string quantity ("1/2") and keeps one it cannot read', () => {
    expect(read('water', '1/2', 'cup')).toBe('½ cup water')
    expect(read('water', 'a splash', null)).toBe('a splash water')
  })

  it('keeps 0, and no amount at all', () => {
    expect(read('sugar', 0, 'tsp')).toBe('0 tsp sugar')
    expect(read('salt', null, null)).toBe('salt')
  })

  it('leaves "items" (the pantry package unit) alone', () => {
    expect(read('Milk', 2, 'items')).toBe('2 items Milk')
  })
})

describe('formatIngredientText (flattened recipe lines)', () => {
  it.each([
    ['1 count eggs', '1 egg'],
    ['2 count eggs', '2 eggs'],
    ['3 tablespoon sugar', '3 tbsp sugar'],
    ['3.5 teaspoon baking powder', '3½ tsp baking powder'],
    ['1.25 cups milk', '1¼ cups milk'],
    ['1 cup flour', '1 cup flour'],
    ['2 cup flour', '2 cups flour'],
    ['1/2 cup sugar', '½ cup sugar'],
    ['1 1/2 cups flour', '1½ cups flour'],
    ['1½ cups flour', '1½ cups flour'],
    ['0.25 count Cinnamon', 'Cinnamon, to taste'],
  ])('%p reads %p', (text, out) => {
    expect(formatIngredientText(text)).toBe(out)
  })

  it('leaves a line with no recognised amount untouched', () => {
    expect(formatIngredientText('2 large eggs')).toBe('2 large eggs')
    expect(formatIngredientText('salt to taste')).toBe('salt to taste')
    expect(formatIngredientText('a pinch of salt')).toBe('a pinch of salt')
    expect(formatIngredientText('2-3 cloves garlic')).toBe('2-3 cloves garlic')
    expect(formatIngredientText('2 to 3 tbsp butter')).toBe('2 to 3 tbsp butter')
  })
})

describe('recipe page and edit-modal label', () => {
  it('reads the pancake list the way the issue asks', () => {
    expect(PANCAKES.map((i) => ingredientLabel(i))).toEqual([
      '1½ cups flour',
      '3 tbsp sugar',
      '3½ tsp baking powder',
      '1 tsp salt',
      '1¼ cups milk',
      '1 egg',
      '3 tbsp butter',
      '¾ cup chocolate chips',
    ])
  })

  it('a flattened string row reads the same way', () => {
    expect(ingredientLabel('1 count eggs')).toBe('1 egg')
    expect(ingredientLabel('3 tablespoon sugar')).toBe('3 tbsp sugar')
  })

  it('exposes the food as displayed, while name stays the matching key', () => {
    const parts = ingredientParts({ name: 'eggs', quantity: 1, unit: 'count' })
    expect(parts).toMatchObject({ name: 'eggs', displayName: 'egg', quantityText: '1', label: '1 egg' })
    const flour = ingredientParts({ name: 'flour', quantity: 1.5, unit: 'cups' })
    expect(flour).toMatchObject({ name: 'flour', displayName: 'flour', quantityText: '1½ cups' })
  })

  it('the meal page, scaled, reads the same way', () => {
    expect(scaledIngredientLabel({ name: 'eggs', quantity: 1, unit: 'count' }, 2)).toBe('2 eggs')
    expect(scaledIngredientLabel({ name: 'flour', quantity: 1, unit: 'cup' }, 1.5)).toBe('1½ cups flour')
    expect(scaledIngredientLabel({ name: 'flour', quantity: 1, unit: 'cup' }, 1 / 3)).toBe('⅓ cup flour')
  })
})

describe('cook chips', () => {
  it('object and string lines both read the new way', () => {
    const list = cookIngredientsFor(
      [
        { name: 'eggs', quantity: 2, unit: 'count' } as never,
        { name: 'sugar', quantity: 3, unit: 'tablespoon' } as never,
        '1 count eggs',
        '3.5 teaspoon baking powder',
      ],
      1,
    )
    expect(list.map((i) => i.label)).toEqual(['2 eggs', '3 tbsp sugar', '1 egg', '3½ tsp baking powder'])
    // The matcher still keys on the bare name.
    expect(list[0].name).toBe('eggs')
  })

  it('a scaled string line reads the new way', () => {
    const list = cookIngredientsFor(['1 count eggs', '1 tablespoon butter'], 2)
    expect(list.map((i) => i.label)).toEqual(['2 eggs', '2 tbsp butter'])
  })
})

describe('chat recipe card', () => {
  const recipe = {
    title: 'Chocolate Chip Pancakes',
    description: 'Fluffy.',
    prep_time_minutes: 10,
    cook_time_minutes: 15,
    servings: 4,
    ingredients: PANCAKES,
    instructions: ['Mix.', 'Cook.'],
  } as unknown as ChatRecipeData

  it('shows each ingredient as a readable amount and food', () => {
    render(<RecipeCard variant="chat" recipe={recipe} />)
    const rows = screen.getAllByRole('listitem').filter((li) => li.textContent?.match(/[\d¼⅓½⅔¾]|to taste/i))
    const text = rows.map((r) => r.textContent ?? '').join(' | ')
    expect(text).toContain('1½ cups')
    expect(text).toContain('3 tbsp')
    expect(text).toContain('3½ tsp')
    expect(text).toContain('1¼ cups')
    expect(text).toContain('¾ cup')
    expect(text).not.toMatch(/count/i)
    expect(text).not.toMatch(/tablespoon|teaspoon/i)
    const egg = rows.find((r) => /egg/i.test(r.textContent ?? ''))!
    expect(within(egg).getByText('Egg')).toBeInTheDocument()
    expect(egg).toHaveTextContent('1')
  })
})

describe('meal view dish card', () => {
  it('reads a dish ingredient the same way', () => {
    render(
      <RecipeCard
        variant="dish"
        role="main"
        title="Pancakes"
        ingredients={[
          { name: 'eggs', quantity: 2, unit: 'count' },
          { name: 'sugar', quantity: 3, unit: 'tablespoon' },
        ]}
        instructions={['Mix.']}
        defaultExpanded
      />,
    )
    const rows = screen.getAllByRole('listitem')
    const text = rows.map((r) => r.textContent ?? '').join(' | ')
    expect(text).toContain('2')
    expect(text).toContain('eggs')
    expect(text).toContain('3 tbsp')
    expect(text).not.toMatch(/count|tablespoon/i)
  })
})

describe('cook amendment card', () => {
  it('reads amended amounts the same way', () => {
    const proposal: RecipeAmendmentProposal = {
      proposal_type: 'recipe_amendment',
      is_amendment: true,
      amended_ingredients: [
        { name: 'eggs', quantity: 1, unit: 'count', optional: false, notes: null },
        { name: 'sugar', quantity: 3.5, unit: 'tablespoon', optional: false, notes: null },
      ],
      change_summary: 'Fewer eggs.',
      recipe_id: 'r1',
      recipe_title: 'Pancakes',
    }
    render(
      <CookingAmendmentCard proposal={proposal} state="pending" actionable onApply={jest.fn()} onDismiss={jest.fn()} />,
    )
    expect(screen.getByText('Egg')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3½ tbsp')).toBeInTheDocument()
  })
})

describe('grocery and pantry quantities are not recipe lines', () => {
  it('keeps "Milk (2 items)" and the pantry amount format', () => {
    expect(formatGroceryLine({ name: 'milk', quantity: 2, unit: 'items' })).toBe('- Milk (2 items)')
    expect(formatGroceryLine({ name: 'eggs', quantity: 1, unit: 'count' })).toBe('- Eggs (1 count)')
    expect(formatAmount(1.5, 'cup')).toBe('1.5 cup')
  })
})
