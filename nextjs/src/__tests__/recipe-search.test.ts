/**
 * Issue #855: the library's search is token-wise over title, ingredients and
 * tags (every token must match somewhere), ignores filler words like "dinner" and
 * "recipe", and the card says how often a recipe was cooked.
 */
import { cookedLabel, searchRecipes, searchTokens } from '@/lib/recipe-search'
import type { Recipe } from '@/components/recipes/RecipePage'

function recipe(over: Partial<Recipe> & { id: string; title: string }): Recipe {
  return { user_id: 'u1', ingredients: [], instructions: [], ...over } as Recipe
}

const CURRY = recipe({
  id: 'curry',
  title: 'Weeknight Curry',
  ingredients: [{ name: 'Chickpeas', quantity: 1, unit: 'can' }, 'coconut milk', 'rice'],
  tags: ['vegan'],
  meal_type: 'dinner',
})
const PASTA = recipe({
  id: 'pasta',
  title: 'Creamy Tomato Pasta',
  ingredients: ['pasta', 'tomato', 'cream'],
  cuisine: 'Italian',
  meal_type: 'dinner',
})
const SALAD = recipe({
  id: 'salad',
  title: 'Chickpea Salad',
  ingredients: ['chickpeas', 'cucumber'],
  tags: ['quick'],
  meal_type: 'lunch',
})
const ALL = [CURRY, PASTA, SALAD]
const ids = (rs: Recipe[]) => rs.map((r) => r.id)

describe('searchTokens', () => {
  it('lowercases, splits on whitespace and punctuation, and drops stop-words', () => {
    expect(searchTokens('  Chickpea  DINNER, recipe ')).toEqual(['chickpea'])
  })

  it('keeps stop-words when the query is nothing else, so "dinner" still finds dinners', () => {
    expect(searchTokens('dinner')).toEqual(['dinner'])
    expect(searchTokens('dinner recipes')).toEqual(['dinner', 'recipes'])
  })

  it('is empty for a blank query', () => {
    expect(searchTokens('   ')).toEqual([])
  })
})

describe('searchRecipes', () => {
  it('returns the list untouched for a blank query', () => {
    expect(searchRecipes(ALL, '  ')).toEqual(ALL)
  })

  it('finds a recipe by an ingredient that is not in its title ("chickpea dinner")', () => {
    expect(ids(searchRecipes(ALL, 'chickpea dinner'))).toEqual(['salad', 'curry'])
  })

  it('matches the object-shape ingredient name, not its quantity text', () => {
    expect(ids(searchRecipes(ALL, 'chickpeas'))).toContain('curry')
    expect(ids(searchRecipes(ALL, 'can'))).not.toContain('curry')
  })

  it('matches tags and the string-shape ingredient', () => {
    expect(ids(searchRecipes(ALL, 'vegan'))).toEqual(['curry'])
    expect(ids(searchRecipes(ALL, 'coconut'))).toEqual(['curry'])
  })

  it('needs every token to match somewhere, in any field', () => {
    expect(ids(searchRecipes(ALL, 'tomato cream'))).toEqual(['pasta'])
    // No single recipe has both "curry" and "pasta".
    expect(searchRecipes(ALL, 'curry pasta')).toEqual([])
    // One token in the title, one in the ingredients.
    expect(ids(searchRecipes(ALL, 'curry coconut'))).toEqual(['curry'])
  })

  it('does not let a stop-word veto a match', () => {
    expect(ids(searchRecipes(ALL, 'tomato recipe'))).toEqual(['pasta'])
  })

  it('treats a query of only filler as a real search on those words', () => {
    expect(ids(searchRecipes(ALL, 'dinner')).sort()).toEqual(['curry', 'pasta'])
  })

  it('ranks a title hit above an ingredient-only hit', () => {
    expect(ids(searchRecipes(ALL, 'chickpea'))).toEqual(['salad', 'curry'])
  })

  it('is case-insensitive', () => {
    expect(ids(searchRecipes(ALL, 'CHICKPEAS')).sort()).toEqual(['curry', 'salad'])
  })

  it('still finds by cuisine and description as before', () => {
    expect(ids(searchRecipes(ALL, 'italian'))).toEqual(['pasta'])
    const withDesc = recipe({ id: 'p', title: 'Pancakes', description: 'Fluffy breakfast stack' })
    expect(ids(searchRecipes([withDesc], 'fluffy'))).toEqual(['p'])
  })

  it('survives a malformed ingredient element', () => {
    const odd = recipe({ id: 'odd', title: 'Odd', ingredients: [null as never, { name: '' } as never] })
    expect(searchRecipes([odd], 'odd')).toEqual([odd])
  })
})

describe('cookedLabel', () => {
  const NOW = new Date(2026, 9, 1, 15, 0, 0) // 1 Oct 2026, local
  const daysAgo = (n: number) => new Date(2026, 9, 1 - n, 9, 30, 0).toISOString()

  it('is null when it was never cooked, whatever the timestamp says', () => {
    expect(cookedLabel(0, null, NOW)).toBeNull()
    expect(cookedLabel(0, daysAgo(2), NOW)).toBeNull()
    expect(cookedLabel(undefined, undefined, NOW)).toBeNull()
    expect(cookedLabel(null, daysAgo(2), NOW)).toBeNull()
  })

  it('says "today" and "yesterday" by calendar day, not by 24 hour blocks', () => {
    expect(cookedLabel(1, daysAgo(0), NOW)).toBe('Cooked 1x, last today')
    expect(cookedLabel(2, daysAgo(1), NOW)).toBe('Cooked 2x, last yesterday')
  })

  it('counts days under a week, then weeks', () => {
    expect(cookedLabel(3, daysAgo(2), NOW)).toBe('Cooked 3x, last 2 days ago')
    expect(cookedLabel(3, daysAgo(6), NOW)).toBe('Cooked 3x, last 6 days ago')
    expect(cookedLabel(3, daysAgo(7), NOW)).toBe('Cooked 3x, last 1 week ago')
    expect(cookedLabel(3, daysAgo(15), NOW)).toBe('Cooked 3x, last 2 weeks ago')
  })

  it('falls back to a calendar date for anything older than a month', () => {
    expect(cookedLabel(5, new Date(2026, 5, 4, 12).toISOString(), NOW)).toBe('Cooked 5x, last Jun 4')
    expect(cookedLabel(5, new Date(2025, 11, 25, 12).toISOString(), NOW)).toBe(
      'Cooked 5x, last Dec 25, 2025',
    )
  })

  it('shows just the count when the timestamp is missing or unreadable', () => {
    expect(cookedLabel(4, null, NOW)).toBe('Cooked 4x')
    expect(cookedLabel(4, 'not a date', NOW)).toBe('Cooked 4x')
  })

  it('does not call a future timestamp (clock skew) "ago"', () => {
    expect(cookedLabel(1, new Date(2026, 9, 2, 9).toISOString(), NOW)).toBe('Cooked 1x, last today')
  })
})
