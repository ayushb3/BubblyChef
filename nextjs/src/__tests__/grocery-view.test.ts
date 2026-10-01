/**
 * Issue #497: the /grocery page groups lines under the same food-category
 * headings the storage list uses ("Dairy and eggs", "Meat and fish"), in the
 * same fixed order. The data layer's `groupGroceryLines` groups by the raw
 * category key, so two keys that share a heading ("meat", "seafood") would
 * show as two panels with one title.
 */

import { groupByHeading } from '@/lib/grocery-view'
import type { GroceryLine } from '@/lib/grocery'

function line(name: string, category: string, extra: Partial<GroceryLine> = {}): GroceryLine {
  return {
    key: name,
    name,
    quantity: null,
    unit: null,
    category,
    source: 'depleted',
    checked: false,
    ...extra,
  }
}

describe('groupByHeading', () => {
  it('uses the storage list headings in their fixed order', () => {
    const groups = groupByHeading([
      line('rice', 'dry_goods'),
      line('milk', 'dairy'),
      line('spinach', 'produce'),
      line('paper towels', 'other'),
    ])
    expect(groups.map((g) => g.label)).toEqual(['Produce', 'Dairy and eggs', 'Dry goods', 'Other'])
  })

  it('merges categories that share a heading into one group, sorted by name', () => {
    const groups = groupByHeading([line('salmon', 'seafood'), line('chicken', 'meat')])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Meat and fish')
    expect(groups[0].lines.map((l) => l.name)).toEqual(['chicken', 'salmon'])
  })

  it('returns nothing for no lines', () => {
    expect(groupByHeading([])).toEqual([])
  })
})
