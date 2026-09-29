import {
  mergeTags,
  ingredientLabel,
  ingredientParts,
  instructionsChanged,
  sanitizeSteps,
} from '@/lib/recipe-helpers'

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

describe('instructionsChanged (#648 — clears structured steps on a real instruction edit)', () => {
  it('is false for byte-identical arrays', () => {
    expect(instructionsChanged(['Boil water.', 'Add pasta.'], ['Boil water.', 'Add pasta.'])).toBe(false)
  })

  it('is true when any step text differs', () => {
    expect(instructionsChanged(['Boil water.'], ['Boil salted water.'])).toBe(true)
  })

  it('is true when steps are reordered, even with the same content', () => {
    expect(instructionsChanged(['A', 'B'], ['B', 'A'])).toBe(true)
  })

  it('is true when a step is added or removed', () => {
    expect(instructionsChanged(['A'], ['A', 'B'])).toBe(true)
    expect(instructionsChanged(['A', 'B'], ['A'])).toBe(true)
  })

  it('treats null/undefined current instructions as comparable, not a crash', () => {
    expect(instructionsChanged(null, ['A'])).toBe(true)
    expect(instructionsChanged(undefined, null)).toBe(false)
  })
})

describe('sanitizeSteps (#648 — never store client-supplied steps unvalidated)', () => {
  const good = {
    text: 'Boil the pasta',
    label: 'Boil pasta',
    ongoing_label: 'the pasta boils',
    duration_minutes: 10,
    duration_estimated: false,
    hands_on: false,
    depends_on: [],
    exclusive: [],
  }

  it('passes a valid step list through unchanged', () => {
    expect(sanitizeSteps([good], ['Boil the pasta'])).toEqual([good])
  })

  it('returns null for anything that is not an array', () => {
    expect(sanitizeSteps(undefined)).toBeNull()
    expect(sanitizeSteps(null)).toBeNull()
    expect(sanitizeSteps({ steps: [good] })).toBeNull()
  })

  it('returns null when the count does not match the instructions', () => {
    expect(sanitizeSteps([good], ['Boil the pasta', 'Drain it'])).toBeNull()
  })

  it('returns null for a step missing its text, label or a numeric duration', () => {
    expect(sanitizeSteps([{ ...good, label: undefined }])).toBeNull()
    expect(sanitizeSteps([{ ...good, text: 3 }])).toBeNull()
    expect(sanitizeSteps([{ ...good, duration_minutes: 'ten' }])).toBeNull()
    expect(sanitizeSteps([{ ...good, duration_minutes: Number.NaN }])).toBeNull()
  })

  it('clamps an out-of-range duration and flags it estimated', () => {
    const [step] = sanitizeSteps([{ ...good, duration_minutes: 480 }]) ?? []
    expect(step.duration_minutes).toBe(240)
    expect(step.duration_estimated).toBe(true)
  })

  it('keeps only strictly-earlier depends_on indices and defaults missing fields', () => {
    const steps = sanitizeSteps([
      good,
      { text: 'Drain', label: 'Drain', duration_minutes: 1, depends_on: [0, 1, 5] },
      { text: 'Toss', label: 'Toss', duration_minutes: 1 },
    ])
    expect(steps?.[1].depends_on).toEqual([0])
    expect(steps?.[1].hands_on).toBe(true)
    expect(steps?.[1].ongoing_label).toBeNull()
    expect(steps?.[2].depends_on).toEqual([1])
    expect(steps?.[2].exclusive).toEqual([])
  })
})
