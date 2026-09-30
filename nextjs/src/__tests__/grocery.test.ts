/**
 * Issue #497 (Spec B.5): the pure grocery-list logic in `lib/grocery.ts`.
 * Generation from pantry rows, the regenerate merge that keeps checked and
 * manual lines, manual add, grouping, and the share text.
 */

import {
  addManualLines,
  clearCheckedLines,
  countToBuy,
  formatGroceryShareText,
  generateGroceryLines,
  groceryFoodKey,
  groupGroceryLines,
  regenerateGroceryList,
  removeLine,
  setLineChecked,
  updateLine,
  type GroceryLine,
  type GroceryPantryRow,
} from '@/lib/grocery'

function row(over: Partial<GroceryPantryRow> & { name: string }): GroceryPantryRow {
  return {
    category: 'other',
    quantity: 3,
    unit: 'item',
    days_until_expiry: null,
    is_expired: false,
    ...over,
  }
}

function line(over: Partial<GroceryLine> & { name: string }): GroceryLine {
  return {
    key: groceryFoodKey(over.name),
    quantity: null,
    unit: null,
    category: 'other',
    source: 'manual',
    checked: false,
    ...over,
  }
}

const names = (lines: GroceryLine[]) => lines.map((l) => l.name)

describe('generateGroceryLines', () => {
  it('issue acceptance: eggs at 0 and milk expiring tomorrow are listed under their categories; a fresh item is not', () => {
    const lines = generateGroceryLines([
      row({ name: 'Eggs', category: 'dairy', quantity: 0, unit: 'item' }),
      row({ name: 'Milk', category: 'dairy', quantity: 1, unit: 'L', days_until_expiry: 1 }),
      row({ name: 'Rice', category: 'dry_goods', quantity: 3, days_until_expiry: 200 }),
    ])
    expect(lines.map((l) => [l.name, l.category, l.source])).toEqual([
      ['Eggs', 'dairy', 'depleted'],
      ['Milk', 'dairy', 'expiring'],
    ])
    expect(lines.every((l) => !l.checked)).toBe(true)
  })

  it('depleted means quantity <= 0, including negative', () => {
    expect(names(generateGroceryLines([row({ name: 'a', quantity: 0 }), row({ name: 'b', quantity: -1 })]))).toEqual(['a', 'b'])
  })

  it('expiring means is_expired or days_until_expiry <= 1', () => {
    const lines = generateGroceryLines([
      row({ name: 'expired', days_until_expiry: -4, is_expired: true }),
      row({ name: 'today', days_until_expiry: 0 }),
      row({ name: 'tomorrow', days_until_expiry: 1 }),
      row({ name: 'in two days', days_until_expiry: 2 }),
      row({ name: 'no date', days_until_expiry: null }),
    ])
    expect(names(lines).sort()).toEqual(['expired', 'today', 'tomorrow'])
  })

  it('falls back to expiry_date when the row carries no computed flags', () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const lines = generateGroceryLines([
      { name: 'yogurt', quantity: 2, unit: 'item', category: 'dairy', expiry_date: tomorrow },
    ])
    expect(lines[0]).toMatchObject({ name: 'yogurt', source: 'expiring' })
  })

  it('an expiring line suggests the row\'s last known quantity and unit; a depleted one knows only the unit', () => {
    const generated = generateGroceryLines([
      row({ name: 'milk', quantity: 1, unit: 'L', days_until_expiry: 0 }),
      row({ name: 'eggs', quantity: 0, unit: 'item' }),
    ])
    const milk = generated.find((l) => l.name === 'milk')
    const eggs = generated.find((l) => l.name === 'eggs')
    expect(milk).toMatchObject({ quantity: 1, unit: 'L' })
    expect(eggs).toMatchObject({ quantity: null, unit: 'item' })
  })

  it('aggregates lots per food name (issue #356): one good lot means the food is not needed', () => {
    const lines = generateGroceryLines([
      row({ name: 'eggs', quantity: 0 }),
      row({ name: 'Eggs', quantity: 12, days_until_expiry: 20 }),
      row({ name: 'milk', quantity: 1, unit: 'L', days_until_expiry: 0 }),
      row({ name: 'milk', quantity: 2, unit: 'L', days_until_expiry: 9 }),
    ])
    expect(lines).toEqual([])
  })

  it('dedupes by food name: several depleted or expiring lots are one line', () => {
    const lines = generateGroceryLines([
      row({ name: 'Eggs', quantity: 0 }),
      row({ name: 'eggs', quantity: 0 }),
      row({ name: 'milk', quantity: 1, unit: 'L', days_until_expiry: -1, is_expired: true }),
      row({ name: 'milk', quantity: 2, unit: 'L', days_until_expiry: 1 }),
    ])
    expect(names(lines)).toEqual(['Eggs', 'milk'])
  })

  it('an expired lot counts as no stock, so a depleted lot beside it reads as expiring, not fresh', () => {
    const lines = generateGroceryLines([
      row({ name: 'spinach', quantity: 2, days_until_expiry: -2, is_expired: true }),
      row({ name: 'spinach', quantity: 0 }),
    ])
    expect(lines.map((l) => l.source)).toEqual(['expiring'])
  })

  it('orders by category (other last) then name', () => {
    const lines = generateGroceryLines([
      row({ name: 'zucchini', category: 'produce', quantity: 0 }),
      row({ name: 'soap', category: 'other', quantity: 0 }),
      row({ name: 'milk', category: 'dairy', quantity: 0 }),
      row({ name: 'apple', category: 'produce', quantity: 0 }),
    ])
    expect(names(lines)).toEqual(['milk', 'apple', 'zucchini', 'soap'])
  })

  it('ignores blank names', () => {
    expect(generateGroceryLines([row({ name: '  ', quantity: 0 })])).toEqual([])
  })
})

describe('groceryFoodKey', () => {
  it('lowercases, trims, collapses spaces and singularises a trailing s', () => {
    expect(groceryFoodKey('  Fresh   Eggs ')).toBe('fresh egg')
    expect(groceryFoodKey('Egg')).toBe('egg')
    expect(groceryFoodKey('Berries')).toBe('berry')
    expect(groceryFoodKey('hummus')).toBe('hummus')
    expect(groceryFoodKey('asparagus')).toBe('asparagus')
    expect(groceryFoodKey('peas')).toBe('pea')
  })
})

describe('regenerateGroceryList', () => {
  it('keeps checked and manual lines and refreshes the generated ones', () => {
    const current: GroceryLine[] = [
      line({ name: 'Eggs', source: 'depleted', checked: true, category: 'dairy' }), // got it: kept
      line({ name: 'Paper towels', source: 'manual' }), // manual: kept
      line({ name: 'Milk', source: 'expiring', quantity: 1, unit: 'L', category: 'dairy' }), // stale
      line({ name: 'Butter', source: 'depleted', category: 'dairy' }), // still needed: refreshed
    ]
    const pantry = [
      row({ name: 'milk', category: 'dairy', quantity: 2, unit: 'L', days_until_expiry: 9 }), // restocked
      row({ name: 'butter', category: 'dairy', quantity: 0 }),
      row({ name: 'flour', category: 'dry_goods', quantity: 0 }), // new
      row({ name: 'eggs', category: 'dairy', quantity: 0 }), // still zero, but already held (checked)
    ]

    const next = regenerateGroceryList(current, pantry)

    expect(names(next).sort()).toEqual(['Butter', 'Eggs', 'Paper towels', 'flour'])
    expect(next.find((l) => l.key === 'egg')?.checked).toBe(true)
    expect(next.find((l) => l.name === 'Paper towels')?.source).toBe('manual')
    expect(next.filter((l) => l.key === 'egg')).toHaveLength(1)
  })

  it('refreshes the suggested quantity of a still-needed generated line', () => {
    const current = [line({ name: 'milk', source: 'expiring', quantity: 1, unit: 'L' })]
    const next = regenerateGroceryList(current, [row({ name: 'milk', quantity: 2, unit: 'L', days_until_expiry: 0 })])
    expect(next[0]).toMatchObject({ quantity: 2, unit: 'L', source: 'expiring' })
  })

  it('a manual line wins over a generated one for the same food', () => {
    const current = [line({ name: 'Eggs', source: 'manual', quantity: 18, unit: 'item' })]
    const next = regenerateGroceryList(current, [row({ name: 'eggs', quantity: 0 })])
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ source: 'manual', quantity: 18 })
  })

  it('is idempotent', () => {
    const pantry = [row({ name: 'eggs', quantity: 0 }), row({ name: 'milk', days_until_expiry: 0 })]
    const once = regenerateGroceryList([line({ name: 'soap' })], pantry)
    expect(regenerateGroceryList(once, pantry)).toEqual(once)
  })
})

describe('manual edits', () => {
  it('addManualLines takes plain names, trims, dedupes by food, and un-checks a re-added food', () => {
    let lines = addManualLines([], ['  Basil ', 'feta', 'basil'])
    expect(lines.map((l) => [l.name, l.source, l.checked])).toEqual([
      ['Basil', 'manual', false],
      ['feta', 'manual', false],
    ])
    lines = setLineChecked(lines, 'basil', true)
    lines = addManualLines(lines, ['BASIL'])
    expect(lines.find((l) => l.key === 'basil')).toMatchObject({ checked: false, source: 'manual' })
    expect(lines).toHaveLength(2)
  })

  it('addManualLines adopts a generated line as manual so regenerate leaves it alone', () => {
    const generated = generateGroceryLines([row({ name: 'eggs', quantity: 0 })])
    const adopted = addManualLines(generated, [{ name: 'Eggs', quantity: 12, unit: 'item' }])
    expect(adopted).toHaveLength(1)
    expect(adopted[0]).toMatchObject({ source: 'manual', quantity: 12, unit: 'item' })
    expect(regenerateGroceryList(adopted, [])[0].quantity).toBe(12)
  })

  it('ignores blank and over-long names', () => {
    expect(addManualLines([], ['', '   ', 'x'.repeat(101)])).toEqual([])
  })

  it('check, edit, remove and clear', () => {
    const start = addManualLines([], [{ name: 'Milk', quantity: 1, unit: 'L' }, 'eggs'])
    const checked = setLineChecked(start, 'milk', true)
    expect(checked.find((l) => l.key === 'milk')?.checked).toBe(true)
    // original untouched (pure)
    expect(start.find((l) => l.key === 'milk')?.checked).toBe(false)

    const edited = updateLine(generateGroceryLines([row({ name: 'eggs', quantity: 0 })]), 'egg', { quantity: 12 })
    expect(edited[0]).toMatchObject({ quantity: 12, source: 'manual' })

    expect(names(removeLine(checked, 'milk'))).toEqual(['eggs'])
    expect(names(clearCheckedLines(checked))).toEqual(['eggs'])
  })

  it('an edit that renames onto another line\'s food merges instead of duplicating', () => {
    const lines = addManualLines([], ['eggs', 'milk'])
    const renamed = updateLine(lines, 'milk', { name: 'Eggs' })
    expect(renamed.filter((l) => l.key === 'egg')).toHaveLength(1)
  })
})

describe('grouping, counting and share text', () => {
  const lines = [
    line({ name: 'Eggs', category: 'dairy', quantity: 12, unit: 'item' }),
    line({ name: 'Milk', category: 'dairy', quantity: 1, unit: 'L' }),
    line({ name: 'Bread', category: 'bakery', checked: true }),
    line({ name: 'Basil', category: 'produce' }),
  ]

  it('groups by category and sinks checked lines to "got it"', () => {
    const groups = groupGroceryLines(lines)
    expect(groups.toBuy.map((g) => [g.category, names(g.lines)])).toEqual([
      ['dairy', ['Eggs', 'Milk']],
      ['produce', ['Basil']],
    ])
    expect(names(groups.gotIt)).toEqual(['Bread'])
  })

  it('counts the unchecked lines', () => {
    expect(countToBuy(lines)).toBe(3)
    expect(countToBuy([])).toBe(0)
  })

  it('share text is the issue example: plain text of the unchecked lines', () => {
    expect(formatGroceryShareText(lines.slice(0, 2))).toBe('- Eggs (12 items)\n- Milk (1 L)')
  })

  it('share text leaves checked lines out and is empty when nothing is left', () => {
    expect(formatGroceryShareText(lines)).toBe('- Eggs (12 items)\n- Milk (1 L)\n- Basil')
    expect(formatGroceryShareText([line({ name: 'x', checked: true })])).toBe('')
    expect(formatGroceryShareText([])).toBe('')
  })

  it('formats amounts: one item is singular, decimals trimmed, unitless numbers bare, no amount dropped', () => {
    expect(formatGroceryShareText([line({ name: 'lemon', quantity: 1, unit: 'item' })])).toBe('- Lemon (1 item)')
    expect(formatGroceryShareText([line({ name: 'rice', quantity: 2.5, unit: 'kg' })])).toBe('- Rice (2.5 kg)')
    expect(formatGroceryShareText([line({ name: 'salt', quantity: 3, unit: null })])).toBe('- Salt (3)')
    expect(formatGroceryShareText([line({ name: 'eggs', quantity: null, unit: 'item' })])).toBe('- Eggs')
  })
})
