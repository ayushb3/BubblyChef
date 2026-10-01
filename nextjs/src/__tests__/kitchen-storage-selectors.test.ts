/**
 * The storage sheet's selectors (issue #749): what a place holds, which of it to
 * use first, how it is grouped, and the search across every place. Pure, with
 * `today` injected.
 */
import {
  categoryGroups,
  itemsInPlace,
  matchRange,
  placeLocation,
  searchPlaces,
  pickUseFirst,
} from '@/lib/kitchen/places'
import { formatAmount } from '@/lib/format'

const TODAY = '2026-10-01'

function item(
  id: string,
  name: string,
  location: string,
  extra: { category?: string; expiry_date?: string | null; quantity?: number; unit?: string } = {},
) {
  return {
    id,
    name,
    location,
    category: extra.category ?? 'produce',
    quantity: extra.quantity ?? 1,
    unit: extra.unit ?? 'item',
    expiry_date: extra.expiry_date ?? null,
  }
}

describe('itemsInPlace', () => {
  it('keeps the rows whose stored location is that place, unknown locations on the shelves', () => {
    const items = [
      item('1', 'Milk', 'fridge'),
      item('2', 'Peas', 'freezer'),
      item('3', 'Rice', 'pantry'),
      item('4', 'Apples', 'counter'),
      item('5', 'Mystery', 'garage'),
    ]
    expect(itemsInPlace(items, 'fridge').map((i) => i.id)).toEqual(['1'])
    expect(itemsInPlace(items, 'shelves').map((i) => i.id)).toEqual(['3', '5'])
    expect(itemsInPlace(items, 'basket').map((i) => i.id)).toEqual(['4'])
  })
})

describe('placeLocation', () => {
  it('is the stored location value a place saves', () => {
    expect(placeLocation('fridge')).toBe('fridge')
    expect(placeLocation('freezer')).toBe('freezer')
    expect(placeLocation('shelves')).toBe('pantry')
    expect(placeLocation('basket')).toBe('counter')
  })
})

describe('pickUseFirst', () => {
  it('takes what needs attention by the Use Soon rules: expired or within 3 days, soonest first', () => {
    const items = [
      item('a', 'Carrots', 'fridge', { expiry_date: '2026-10-20' }),
      item('b', 'Yogurt', 'fridge', { expiry_date: '2026-10-05' }),
      item('c', 'Chicken', 'fridge', { expiry_date: '2026-10-04' }),
      item('d', 'Romaine', 'fridge', { expiry_date: '2026-10-01' }),
      item('e', 'Old milk', 'fridge', { expiry_date: '2026-09-28' }),
      item('f', 'Salt', 'fridge', { expiry_date: null }),
    ]
    expect(pickUseFirst(items, TODAY).map((i) => i.id)).toEqual(['e', 'd', 'c'])
  })

  it('breaks a tie by name and caps the row', () => {
    const items = Array.from({ length: 9 }, (_, n) =>
      item(`i${n}`, `Item ${9 - n}`, 'fridge', { expiry_date: '2026-10-02' }),
    )
    const first = pickUseFirst(items, TODAY, 4)
    expect(first).toHaveLength(4)
    expect(first.map((i) => i.name)).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4'])
  })

  it('is empty when nothing needs using', () => {
    expect(pickUseFirst([item('a', 'Rice', 'pantry')], TODAY)).toEqual([])
  })
})

describe('categoryGroups', () => {
  it('groups by food category in a fixed order, with readable labels and soonest first', () => {
    const items = [
      item('1', 'Eggs', 'fridge', { category: 'dairy' }),
      item('2', 'Lemons', 'fridge', { category: 'produce', expiry_date: '2026-10-09' }),
      item('3', 'Carrots', 'fridge', { category: 'produce', expiry_date: '2026-10-03' }),
      item('4', 'Salmon', 'fridge', { category: 'seafood' }),
      item('5', 'Chicken', 'fridge', { category: 'meat' }),
      item('6', 'Weird', 'fridge', { category: 'odd_things' }),
    ]
    const groups = categoryGroups(items, TODAY)
    expect(groups.map((g) => g.label)).toEqual([
      'Produce',
      'Dairy and eggs',
      'Meat and fish',
      'Odd things',
    ])
    expect(groups[0].items.map((i) => i.name)).toEqual(['Carrots', 'Lemons'])
    // meat and seafood share a heading
    expect(groups[2].items.map((i) => i.name)).toEqual(['Chicken', 'Salmon'])
  })

  it('files a row with no category under Other, last', () => {
    const items = [item('1', 'Thing', 'fridge', { category: '' }), item('2', 'Milk', 'fridge', { category: 'dairy' })]
    expect(categoryGroups(items, TODAY).map((g) => g.label)).toEqual(['Dairy and eggs', 'Other'])
  })
})

describe('searchPlaces', () => {
  const items = [
    item('1', 'Chicken thighs', 'fridge'),
    item('2', 'Chilli crisp', 'fridge'),
    item('3', 'Zucchini', 'fridge'),
    item('4', 'Chicken stock', 'freezer'),
    item('5', 'Chickpeas', 'pantry'),
    item('6', 'Parmesan', 'pantry', { category: 'dairy' }),
    item('7', 'Milk', 'fridge'),
  ]

  it('finds a food wherever it is stored and says which place', () => {
    const result = searchPlaces(items, 'parm', TODAY)
    expect(result.total).toBe(1)
    const shelves = result.groups.find((g) => g.key === 'shelves')!
    expect(shelves.label).toBe('Shelves')
    expect(shelves.items.map((i) => i.name)).toEqual(['Parmesan'])
  })

  it('returns every place, in wall order, with its own matches (empty places stay in)', () => {
    const result = searchPlaces(items, 'chi', TODAY)
    expect(result.total).toBe(5)
    expect(result.groups.map((g) => [g.key, g.items.length])).toEqual([
      ['fridge', 3],
      ['freezer', 1],
      ['shelves', 1],
      ['basket', 0],
    ])
  })

  it('ignores case and surrounding spaces', () => {
    expect(searchPlaces(items, '  MILK ', TODAY).total).toBe(1)
  })

  it('matches nothing for a blank query', () => {
    const result = searchPlaces(items, '   ', TODAY)
    expect(result.total).toBe(0)
    expect(result.groups.every((g) => g.items.length === 0)).toBe(true)
  })

  it('matches on the name only', () => {
    expect(searchPlaces(items, 'dairy', TODAY).total).toBe(0)
  })
})

describe('matchRange', () => {
  it('locates the typed text inside a name, ignoring case', () => {
    expect(matchRange('Chicken thighs', 'chi')).toEqual([0, 3])
    expect(matchRange('Zucchini', 'chi')).toEqual([3, 6])
  })
  it('is null when there is no match or no query', () => {
    expect(matchRange('Milk', 'chi')).toBeNull()
    expect(matchRange('Milk', '  ')).toBeNull()
  })
})

describe('formatAmount', () => {
  it('drops the filler unit "item" and keeps a real one', () => {
    expect(formatAmount(4, 'item')).toBe('4')
    expect(formatAmount(1, 'head')).toBe('1 head')
    expect(formatAmount(2, 'L')).toBe('2 L')
  })
  it('trims float noise', () => {
    expect(formatAmount(0.5, 'block')).toBe('0.5 block')
    expect(formatAmount(1.2000000001, 'kg')).toBe('1.2 kg')
  })
})
