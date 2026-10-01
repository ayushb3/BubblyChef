/**
 * The typed-add list parser (issue #851): "eggs, milk, 2 lb chicken" is three
 * items, not one item with that whole name. Deterministic, no model.
 */
import { parsePantryEntry, parsePantryList, splitPantryList } from '@/lib/pantry-quick-add'

describe('splitPantryList', () => {
  it('splits on commas, semicolons and newlines, dropping blanks', () => {
    expect(splitPantryList('eggs, milk; 2 lb chicken\nrice\n\n , ')).toEqual([
      'eggs',
      'milk',
      '2 lb chicken',
      'rice',
    ])
  })

  it('handles Windows line endings and stray whitespace', () => {
    expect(splitPantryList('  eggs \r\n milk  ')).toEqual(['eggs', 'milk'])
  })

  it('does not split a thousands separator or a decimal comma inside a number', () => {
    expect(splitPantryList('1,000 g flour, 2,5 kg rice')).toEqual(['1,000 g flour', '2,5 kg rice'])
  })

  it('returns nothing for empty input', () => {
    expect(splitPantryList('')).toEqual([])
    expect(splitPantryList(' , ; \n')).toEqual([])
  })
})

describe('parsePantryEntry', () => {
  const cases: Array<[string, { name: string; quantity: number; unit: string }]> = [
    // no quantity
    ['eggs', { name: 'eggs', quantity: 1, unit: 'item' }],
    ['olive oil', { name: 'olive oil', quantity: 1, unit: 'item' }],
    // leading quantity + unit
    ['2 lb chicken', { name: 'chicken', quantity: 2, unit: 'lb' }],
    ['2 lbs chicken thighs', { name: 'chicken thighs', quantity: 2, unit: 'lb' }],
    ['500 g flour', { name: 'flour', quantity: 500, unit: 'g' }],
    ['500g flour', { name: 'flour', quantity: 500, unit: 'g' }],
    ['2L milk', { name: 'milk', quantity: 2, unit: 'L' }],
    ['1 liter orange juice', { name: 'orange juice', quantity: 1, unit: 'L' }],
    ['2 cans of tomatoes', { name: 'tomatoes', quantity: 2, unit: 'can' }],
    ['3 bunches cilantro', { name: 'cilantro', quantity: 3, unit: 'bunch' }],
    ['2 pkg tofu', { name: 'tofu', quantity: 2, unit: 'package' }],
    // quantity only (a count of the thing)
    ['12 eggs', { name: 'eggs', quantity: 12, unit: 'item' }],
    ['3 large eggs', { name: 'large eggs', quantity: 3, unit: 'item' }],
    // "x" multiplier
    ['3 x tomatoes', { name: 'tomatoes', quantity: 3, unit: 'item' }],
    ['3x tomatoes', { name: 'tomatoes', quantity: 3, unit: 'item' }],
    // fractions, decimals, mixed numbers, unicode fractions
    ['1/2 lb butter', { name: 'butter', quantity: 0.5, unit: 'lb' }],
    ['1 1/2 cups flour', { name: 'flour', quantity: 1.5, unit: 'cup' }],
    ['0.5 kg rice', { name: 'rice', quantity: 0.5, unit: 'kg' }],
    ['2.5 lb apples', { name: 'apples', quantity: 2.5, unit: 'lb' }],
    ['½ cup sugar', { name: 'sugar', quantity: 0.5, unit: 'cup' }],
    ['1½ lb beef', { name: 'beef', quantity: 1.5, unit: 'lb' }],
    // words
    ['a dozen eggs', { name: 'eggs', quantity: 1, unit: 'dozen' }],
    ['dozen eggs', { name: 'eggs', quantity: 1, unit: 'dozen' }],
    ['2 dozen eggs', { name: 'eggs', quantity: 2, unit: 'dozen' }],
    ['half a dozen eggs', { name: 'eggs', quantity: 0.5, unit: 'dozen' }],
    ['a can of beans', { name: 'beans', quantity: 1, unit: 'can' }],
    ['an onion', { name: 'onion', quantity: 1, unit: 'item' }],
    ['three apples', { name: 'apples', quantity: 3, unit: 'item' }],
    ['one loaf of bread', { name: 'bread', quantity: 1, unit: 'loaf' }],
    // trailing quantity / unit
    ['milk 2L', { name: 'milk', quantity: 2, unit: 'L' }],
    ['chicken 2 lb', { name: 'chicken', quantity: 2, unit: 'lb' }],
    ['rice 500g', { name: 'rice', quantity: 500, unit: 'g' }],
    ['eggs x12', { name: 'eggs', quantity: 12, unit: 'item' }],
    ['tomatoes x 3', { name: 'tomatoes', quantity: 3, unit: 'item' }],
    ['eggs 12', { name: 'eggs', quantity: 12, unit: 'item' }],
    // a unit word is not a unit when nothing follows it
    ['2 lb', { name: '2 lb', quantity: 1, unit: 'item' }],
    // a digit glued to a non-unit word is part of the name
    ['7up', { name: '7up', quantity: 1, unit: 'item' }],
    ['half and half', { name: 'half and half', quantity: 1, unit: 'item' }],
    // junk spacing and casing
    ['  2  LB   Chicken  ', { name: 'Chicken', quantity: 2, unit: 'lb' }],
  ]

  it.each(cases)('%j', (input, expected) => {
    expect(parsePantryEntry(input)).toEqual(expected)
  })

  it('never produces a zero or negative quantity', () => {
    expect(parsePantryEntry('0 eggs').quantity).toBeGreaterThan(0)
  })
})

describe('parsePantryList', () => {
  it('turns the issue example into three items', () => {
    expect(parsePantryList('eggs, milk, 2 lb chicken')).toEqual([
      { name: 'eggs', quantity: 1, unit: 'item' },
      { name: 'milk', quantity: 1, unit: 'item' },
      { name: 'chicken', quantity: 2, unit: 'lb' },
    ])
  })

  it('reads one entry per line', () => {
    expect(parsePantryList('a dozen eggs\n2L milk; 3 x tomatoes')).toEqual([
      { name: 'eggs', quantity: 1, unit: 'dozen' },
      { name: 'milk', quantity: 2, unit: 'L' },
      { name: 'tomatoes', quantity: 3, unit: 'item' },
    ])
  })
})
