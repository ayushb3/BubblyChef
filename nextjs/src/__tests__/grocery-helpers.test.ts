/**
 * Issue #497 (Spec B.5, backend): the pure grocery helpers — share text,
 * grouping, and input validation for the CRUD routes.
 */

import {
  formatGroceryShareText,
  formatGroceryLine,
  groupGroceryByCategory,
  simpleFoodKey,
  parseNewItems,
  parseItemPatch,
  isValidShareToken,
} from '@/lib/grocery-helpers'
import type { GroceryItem } from '@/types/grocery'

function item(over: Partial<GroceryItem>): GroceryItem {
  return {
    id: 'i',
    name: 'eggs',
    quantity: null,
    unit: null,
    category: 'other',
    source: 'manual',
    source_ref: null,
    checked: false,
    checked_at: null,
    ...over,
  }
}

describe('formatGroceryLine / formatGroceryShareText', () => {
  it('matches the issue example: plain text of the unchecked lines', () => {
    const text = formatGroceryShareText([
      item({ name: 'eggs', quantity: 12, unit: 'item', category: 'dairy' }),
      item({ name: 'milk', quantity: 1, unit: 'L', category: 'dairy' }),
    ])
    expect(text).toBe('- Eggs (12 items)\n- Milk (1 L)')
  })

  it('leaves checked lines out', () => {
    const text = formatGroceryShareText([
      item({ name: 'eggs', checked: true }),
      item({ name: 'milk' }),
    ])
    expect(text).toBe('- Milk')
  })

  it('is empty when nothing is left to buy', () => {
    expect(formatGroceryShareText([])).toBe('')
    expect(formatGroceryShareText([item({ checked: true })])).toBe('')
  })

  it('drops the amount when there is none, and never pluralises one item', () => {
    expect(formatGroceryLine(item({ name: 'basil' }))).toBe('- Basil')
    expect(formatGroceryLine(item({ name: 'lemon', quantity: 1, unit: 'item' }))).toBe(
      '- Lemon (1 item)'
    )
    expect(formatGroceryLine(item({ name: 'rice', quantity: 2.5, unit: 'kg' }))).toBe(
      '- Rice (2.5 kg)'
    )
    expect(formatGroceryLine(item({ name: 'salt', quantity: 3, unit: null }))).toBe('- Salt (3)')
  })

  it('orders by category then name so the text reads like the list', () => {
    const text = formatGroceryShareText([
      item({ name: 'zucchini', category: 'produce' }),
      item({ name: 'milk', category: 'dairy' }),
      item({ name: 'apple', category: 'produce' }),
    ])
    expect(text).toBe('- Milk\n- Apple\n- Zucchini')
  })
})

describe('groupGroceryByCategory', () => {
  it('groups unchecked lines by category and sinks checked lines to a got-it group', () => {
    const groups = groupGroceryByCategory([
      item({ id: '1', name: 'milk', category: 'dairy' }),
      item({ id: '2', name: 'apple', category: 'produce' }),
      item({ id: '3', name: 'eggs', category: 'dairy', checked: true }),
      item({ id: '4', name: 'cheese', category: 'dairy' }),
    ])
    expect(groups.toBuy.map((g) => [g.category, g.items.map((i) => i.name)])).toEqual([
      ['dairy', ['cheese', 'milk']],
      ['produce', ['apple']],
    ])
    expect(groups.gotIt.map((i) => i.name)).toEqual(['eggs'])
  })
})

describe('simpleFoodKey', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(simpleFoodKey('  Fresh   Basil ')).toBe('fresh basil')
  })
})

describe('parseNewItems', () => {
  it('accepts a batch of names, trimming and de-duplicating by key', () => {
    const r = parseNewItems({ items: [{ name: ' Eggs ' }, { name: 'eggs' }, { name: 'Milk', quantity: 2, unit: 'L' }] })
    expect(r.error).toBeNull()
    expect(r.items).toEqual([
      { name: 'Eggs', key: 'eggs', quantity: null, unit: null, category: 'other' },
      { name: 'Milk', key: 'milk', quantity: 2, unit: 'L', category: 'other' },
    ])
  })

  it.each([
    [null],
    [{}],
    [{ items: [] }],
    [{ items: [{ name: '   ' }] }],
    [{ items: [{ name: 'x'.repeat(101) }] }],
    [{ items: [{ name: 'a', quantity: -1 }] }],
    [{ items: [{ name: 'a', quantity: 'lots' }] }],
    [{ items: [{ name: 'a', category: 'not-a-category' }] }],
    [{ items: Array.from({ length: 51 }, (_, i) => ({ name: `n${i}` })) }],
  ])('rejects %j', (body) => {
    expect(parseNewItems(body).error).toEqual(expect.any(String))
  })
})

describe('parseItemPatch', () => {
  it('accepts checked, quantity, unit and name', () => {
    expect(parseItemPatch({ checked: true }).patch).toEqual({ checked: true })
    expect(parseItemPatch({ quantity: null, unit: null }).patch).toEqual({
      quantity: null,
      unit: null,
    })
    expect(parseItemPatch({ name: ' Oat milk ' }).patch).toEqual({ name: 'Oat milk' })
  })

  it.each([[null], [{}], [{ checked: 'yes' }], [{ quantity: -2 }], [{ name: '' }], [{ unit: 5 }]])(
    'rejects %j',
    (body) => {
      expect(parseItemPatch(body).error).toEqual(expect.any(String))
    }
  )
})

describe('isValidShareToken', () => {
  it('needs url-safe characters and at least 16 of them', () => {
    expect(isValidShareToken('abcDEF0123456789_-xyz')).toBe(true)
    expect(isValidShareToken('short')).toBe(false)
    expect(isValidShareToken('has spaces in it 1234567890')).toBe(false)
    expect(isValidShareToken("x'; drop table--1234567890")).toBe(false)
    expect(isValidShareToken('a'.repeat(200))).toBe(false)
  })
})
