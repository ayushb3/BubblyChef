import {
  mergeTags,
  pickRandomRecipe,
  ingredientLabel,
  ingredientParts,
} from '@/lib/recipe-helpers'

describe('pickRandomRecipe (#306)', () => {
  it('returns null for an empty array', () => {
    expect(pickRandomRecipe([])).toBeNull()
  })

  it('returns the only element when the array has one entry', () => {
    const recipe = { id: 'r1', title: 'Pasta' }
    expect(pickRandomRecipe([recipe])).toBe(recipe)
  })

  it('returns an element that is a member of the input array', () => {
    const recipes = [
      { id: 'r1', title: 'Pasta' },
      { id: 'r2', title: 'Soup' },
      { id: 'r3', title: 'Salad' },
    ]
    const result = pickRandomRecipe(recipes)
    expect(recipes).toContain(result)
  })

  it('preserves the type of the element returned', () => {
    const recipes = [{ id: 'r1', title: 'Pasta', total_time_minutes: 30 }]
    const result = pickRandomRecipe(recipes)
    // TypeScript narrows to T | null; at runtime we just check the shape.
    expect(result).not.toBeNull()
    expect(result?.id).toBe('r1')
  })
})

describe('mergeTags', () => {
  it('returns an empty array when both inputs are absent', () => {
    expect(mergeTags(undefined, undefined)).toEqual([])
  })

  it('returns tags when only tags are provided', () => {
    expect(mergeTags(['vegan', 'gluten-free'], undefined)).toEqual(['vegan', 'gluten-free'])
  })

  it('returns dietary_tags when only dietary_tags are provided', () => {
    expect(mergeTags(undefined, ['vegetarian', 'dairy-free'])).toEqual(['vegetarian', 'dairy-free'])
  })

  it('merges both arrays with tags first', () => {
    expect(mergeTags(['vegan'], ['gluten-free'])).toEqual(['vegan', 'gluten-free'])
  })

  it('deduplicates exact duplicates across both arrays', () => {
    expect(mergeTags(['vegan', 'gluten-free'], ['gluten-free', 'dairy-free'])).toEqual([
      'vegan',
      'gluten-free',
      'dairy-free',
    ])
  })

  it('deduplicates case-insensitively, keeping first occurrence', () => {
    // "Vegan" in dietary_tags should not appear if "vegan" is already in tags
    expect(mergeTags(['vegan'], ['Vegan', 'Gluten-Free'])).toEqual(['vegan', 'Gluten-Free'])
  })

  it('handles null values the same as undefined', () => {
    expect(mergeTags(null, null)).toEqual([])
    expect(mergeTags(['vegan'], null)).toEqual(['vegan'])
    expect(mergeTags(null, ['dairy-free'])).toEqual(['dairy-free'])
  })

  it('preserves order of unique tags from both arrays', () => {
    const result = mergeTags(['a', 'b'], ['c', 'a', 'd'])
    expect(result).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('ingredientLabel (#315)', () => {
  it('returns string ingredients trimmed, as-is', () => {
    expect(ingredientLabel('2 large eggs')).toBe('2 large eggs')
    expect(ingredientLabel('  a pinch of salt  ')).toBe('a pinch of salt')
  })

  it('renders quantity + unit + name for a full object', () => {
    expect(ingredientLabel({ name: 'flour', quantity: 2, unit: 'cups' })).toBe('2 cups flour')
  })

  it('omits a missing unit', () => {
    expect(ingredientLabel({ name: 'egg', quantity: 1, unit: null })).toBe('1 egg')
  })

  it('omits a missing quantity', () => {
    expect(ingredientLabel({ name: 'salt', quantity: null, unit: null })).toBe('salt')
  })

  it('treats a quantity of 0 as present, not missing', () => {
    expect(ingredientLabel({ name: 'sugar', quantity: 0, unit: 'tsp' })).toBe('0 tsp sugar')
  })

  it('tolerates a non-numeric quantity at runtime even though the type is narrowed to number|null', () => {
    // @ts-expect-error — RecipeIngredient.quantity is `number | null`; this
    // exercises the runtime guard's tolerance of malformed data, not the type.
    expect(ingredientLabel({ name: 'water', quantity: '1/2', unit: 'cup' })).toBe('1/2 cup water')
  })

  it('returns empty string for null/undefined elements without throwing', () => {
    expect(ingredientLabel(null)).toBe('')
    expect(ingredientLabel(undefined)).toBe('')
  })

  it('returns empty string for a malformed object with no usable name', () => {
    // @ts-expect-error — deliberately malformed input, exercising the runtime guard
    expect(ingredientLabel({ quantity: 1, unit: 'cup' })).toBe('')
    // @ts-expect-error — name is not a string
    expect(ingredientLabel({ name: 42 })).toBe('')
    expect(ingredientLabel({ name: '   ' })).toBe('')
  })
})

describe('ingredientParts (#315 / repeated-typeof cleanup)', () => {
  it('breaks a string element into name/label with empty quantityText, null preparation, false optional', () => {
    expect(ingredientParts('2 large eggs')).toEqual({
      name: '2 large eggs',
      quantityText: '',
      label: '2 large eggs',
      preparation: null,
      optional: false,
    })
  })

  it('trims a string element', () => {
    expect(ingredientParts('  a pinch of salt  ')).toEqual({
      name: 'a pinch of salt',
      quantityText: '',
      label: 'a pinch of salt',
      preparation: null,
      optional: false,
    })
  })

  it('breaks a full object element into all parts', () => {
    expect(
      ingredientParts({ name: 'flour', quantity: 2, unit: 'cups', preparation: 'sifted', optional: true }),
    ).toEqual({
      name: 'flour',
      quantityText: '2 cups',
      label: '2 cups flour',
      preparation: 'sifted',
      optional: true,
    })
  })

  it('defaults preparation to null and optional to false when absent', () => {
    expect(ingredientParts({ name: 'egg', quantity: 1, unit: null })).toEqual({
      name: 'egg',
      quantityText: '1',
      label: '1 egg',
      preparation: null,
      optional: false,
    })
  })

  it('treats a quantity of 0 as present in quantityText and label', () => {
    expect(ingredientParts({ name: 'sugar', quantity: 0, unit: 'tsp' })).toEqual({
      name: 'sugar',
      quantityText: '0 tsp',
      label: '0 tsp sugar',
      preparation: null,
      optional: false,
    })
  })

  it('returns all-empty defaults for null/undefined without throwing', () => {
    const empty = { name: '', quantityText: '', label: '', preparation: null, optional: false }
    expect(ingredientParts(null)).toEqual(empty)
    expect(ingredientParts(undefined)).toEqual(empty)
  })

  it('returns all-empty defaults for a malformed object with no usable name', () => {
    const empty = { name: '', quantityText: '', label: '', preparation: null, optional: false }
    // @ts-expect-error — deliberately malformed input, exercising the runtime guard
    expect(ingredientParts({ quantity: 1, unit: 'cup' })).toEqual(empty)
    // @ts-expect-error — name is not a string
    expect(ingredientParts({ name: 42 })).toEqual(empty)
    expect(ingredientParts({ name: '   ' })).toEqual(empty)
  })

  it('keeps ingredientLabel behaviour identical to ingredientParts().label', () => {
    const cases: Array<string | Parameters<typeof ingredientParts>[0]> = [
      '2 large eggs',
      { name: 'flour', quantity: 2, unit: 'cups' },
      { name: 'salt', quantity: null, unit: null },
      { name: 'sugar', quantity: 0, unit: 'tsp' },
    ]
    for (const ing of cases) {
      expect(ingredientLabel(ing)).toBe(ingredientParts(ing).label)
    }
  })
})
