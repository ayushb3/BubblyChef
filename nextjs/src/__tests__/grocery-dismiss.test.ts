/**
 * Issue #497 review: a generated line the user removes (or clears from "Got
 * it") stays dismissed. A dismissal is keyed on a fingerprint of the food, why
 * it was suggested (ran out / expiring) and the pantry state that triggered it
 * (the lots involved), so it lasts until that changes: the food is restocked
 * and runs out again, or a different lot is expiring.
 */

import {
  addManualLines,
  dismissalsFor,
  generateGroceryLines,
  pruneDismissals,
  regenerateGroceryList,
  suggestionFingerprints,
  type GroceryPantryRow,
} from '@/lib/grocery'
import {
  groceryStorageKey,
  loadGroceryDismissed,
  loadGroceryLines,
  parseGroceryDismissed,
  saveGroceryLines,
  saveGroceryState,
} from '@/lib/grocery-store'

function row(over: Partial<GroceryPantryRow> & { name: string }): GroceryPantryRow {
  return {
    category: 'dairy',
    quantity: 0,
    unit: 'item',
    days_until_expiry: null,
    is_expired: false,
    ...over,
  }
}

const EGGS_OUT = row({ id: 'e1', name: 'eggs', quantity: 0 })
const MILK_SOON = row({ id: 'm1', name: 'milk', quantity: 1, unit: 'L', days_until_expiry: 1 })

describe('suggestionFingerprints', () => {
  it('has one fingerprint per suggested food, none for fresh food', () => {
    const fresh = row({ id: 'r1', name: 'rice', quantity: 3, days_until_expiry: 200 })
    const prints = suggestionFingerprints([EGGS_OUT, MILK_SOON, fresh])
    expect([...prints.keys()].sort()).toEqual(['egg', 'milk'])
  })

  it('changes when the food is restocked and runs out again (a new lot)', () => {
    const before = suggestionFingerprints([EGGS_OUT]).get('egg')
    const restocked = row({ id: 'e2', name: 'eggs', quantity: 12 })
    expect(suggestionFingerprints([EGGS_OUT, restocked]).has('egg')).toBe(false)
    const depletedAgain = row({ id: 'e2', name: 'eggs', quantity: 0 })
    expect(suggestionFingerprints([EGGS_OUT, depletedAgain]).get('egg')).not.toBe(before)
  })

  it('differs between ran out and expiring, and between different expiring lots', () => {
    const a = suggestionFingerprints([MILK_SOON]).get('milk')
    const other = row({ id: 'm2', name: 'milk', quantity: 1, unit: 'L', days_until_expiry: 0 })
    expect(suggestionFingerprints([other]).get('milk')).not.toBe(a)
    const out = row({ id: 'm1', name: 'milk', quantity: 0, unit: 'L' })
    expect(suggestionFingerprints([out]).get('milk')).not.toBe(a)
  })

  it('is stable for the same pantry, whatever the row order', () => {
    const lotA = row({ id: 'a', name: 'milk', quantity: 1, days_until_expiry: 0 })
    const lotB = row({ id: 'b', name: 'milk', quantity: 1, days_until_expiry: -1, is_expired: true })
    expect(suggestionFingerprints([lotA, lotB]).get('milk')).toBe(
      suggestionFingerprints([lotB, lotA]).get('milk'),
    )
  })
})

describe('regenerateGroceryList with dismissals', () => {
  it('skips a dismissed suggestion and still adds the others', () => {
    const [eggs] = dismissalsFor(['egg'], [EGGS_OUT, MILK_SOON])
    const list = regenerateGroceryList([], [EGGS_OUT, MILK_SOON], [eggs])
    expect(list.map((l) => l.key)).toEqual(['milk'])
  })

  it('brings the food back once the pantry state that triggered it has changed', () => {
    const dismissed = dismissalsFor(['egg'], [EGGS_OUT])
    const restocked = row({ id: 'e2', name: 'eggs', quantity: 12 })
    const depletedAgain = row({ id: 'e2', name: 'eggs', quantity: 0 })
    expect(regenerateGroceryList([], [EGGS_OUT, restocked], dismissed)).toEqual([])
    expect(regenerateGroceryList([], [EGGS_OUT, depletedAgain], dismissed).map((l) => l.key)).toEqual([
      'egg',
    ])
  })

  it('never drops a ticked or added line because of a dismissal', () => {
    const dismissed = dismissalsFor(['egg'], [EGGS_OUT])
    const current = addManualLines([], ['eggs'])
    expect(regenerateGroceryList(current, [EGGS_OUT], dismissed).map((l) => l.key)).toEqual(['egg'])
  })

  it('is the same as before when nothing is dismissed', () => {
    expect(regenerateGroceryList([], [EGGS_OUT, MILK_SOON])).toEqual(
      generateGroceryLines([EGGS_OUT, MILK_SOON]),
    )
  })
})

describe('dismissalsFor / pruneDismissals', () => {
  it('records a fingerprint only for a food the pantry suggests right now', () => {
    expect(dismissalsFor(['egg', 'paper towel'], [EGGS_OUT])).toHaveLength(1)
    expect(dismissalsFor(['paper towel'], [EGGS_OUT])).toEqual([])
  })

  it('prunes dismissals the pantry no longer suggests (the food is back in stock)', () => {
    const dismissed = dismissalsFor(['egg', 'milk'], [EGGS_OUT, MILK_SOON])
    const restockedEggs = row({ id: 'e1', name: 'eggs', quantity: 12 }) // same lot, topped up
    expect(pruneDismissals(dismissed, [restockedEggs, MILK_SOON])).toEqual(
      dismissalsFor(['milk'], [MILK_SOON]),
    )
  })

  it('keeps nothing when nothing is suggested', () => {
    expect(pruneDismissals(dismissalsFor(['egg'], [EGGS_OUT]), [])).toEqual([])
  })
})

describe('storing dismissals in the same per-user record', () => {
  const USER = 'u-dismiss'
  beforeEach(() => window.localStorage.clear())

  it('round-trips with the lines, and saving lines alone keeps them', () => {
    saveGroceryState(USER, addManualLines([], ['rice']), ['egg|depleted|e1'])
    expect(loadGroceryDismissed(USER)).toEqual(['egg|depleted|e1'])
    saveGroceryLines(USER, addManualLines([], ['rice', 'beans']))
    expect(loadGroceryDismissed(USER)).toEqual(['egg|depleted|e1'])
    expect(loadGroceryLines(USER).map((l) => l.key)).toEqual(['bean', 'rice'])
  })

  it('writes one versioned record', () => {
    saveGroceryState(USER, [], ['x'])
    const record = JSON.parse(window.localStorage.getItem(groceryStorageKey(USER)) as string)
    expect(record).toEqual({ v: 2, lines: [], dismissed: ['x'] })
  })

  it('reads a record saved before dismissals existed as having none', () => {
    window.localStorage.setItem(groceryStorageKey(USER), JSON.stringify({ v: 1, lines: [] }))
    expect(loadGroceryDismissed(USER)).toEqual([])
  })

  it('ignores a malformed dismissed field', () => {
    for (const bad of ['5', '"x"', '[1,2]', '{"a":1}', 'null']) {
      expect(parseGroceryDismissed(`{"v":2,"lines":[],"dismissed":${bad}}`)).toEqual([])
    }
    expect(parseGroceryDismissed('not json')).toEqual([])
    expect(parseGroceryDismissed('')).toEqual([])
  })
})
