/**
 * Issue #139: the Use Soon triage view — urgency-sorted, resolvable rows.
 *
 * The list logic is what's worth pinning: which items belong on the page and in
 * what order. Both differ deliberately from `/api/pantry/expiring`, which
 * excludes already-expired stock (#239) because it answers a different question.
 */

import { needsAttention, urgencySort, urgencyTier } from '@/app/pantry/use-soon/page'
import type { PantryItem } from '@/types/pantry'

/** An item expiring `days` from today, as a local date string. */
function itemExpiringIn(days: number | null, name = 'item'): PantryItem {
  let expiry: string | null = null
  if (days !== null) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    expiry = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return {
    id: name,
    name,
    category: 'produce',
    location: 'fridge',
    quantity: 1,
    unit: 'piece',
    expiry_date: expiry,
  }
}

describe('needsAttention', () => {
  it('includes expired items — this page is where they get cleared', () => {
    // /api/pantry/expiring deliberately excludes these (#239); this view is the
    // one place they belong, now that #140 gives them a remedy.
    expect(needsAttention(itemExpiringIn(-10))).toBe(true)
    expect(needsAttention(itemExpiringIn(-1))).toBe(true)
  })

  it('includes items expiring today and within the 3-day window', () => {
    expect(needsAttention(itemExpiringIn(0))).toBe(true)
    expect(needsAttention(itemExpiringIn(1))).toBe(true)
    expect(needsAttention(itemExpiringIn(3))).toBe(true)
  })

  it('excludes items with time left', () => {
    expect(needsAttention(itemExpiringIn(4))).toBe(false)
    expect(needsAttention(itemExpiringIn(30))).toBe(false)
  })

  it('excludes items with no expiry date at all', () => {
    // Dry goods with no date aren't urgent and would otherwise pin to the top.
    expect(needsAttention(itemExpiringIn(null))).toBe(false)
  })
})

describe('urgencySort', () => {
  it('puts the most overdue item first', () => {
    const items = [itemExpiringIn(2, 'b'), itemExpiringIn(-5, 'a'), itemExpiringIn(0, 'c')]
    expect(items.sort(urgencySort).map((i) => i.name)).toEqual(['a', 'c', 'b'])
  })

  it('orders strictly by days remaining, not by expired-vs-not', () => {
    const items = [itemExpiringIn(3, 'd'), itemExpiringIn(-1, 'b'), itemExpiringIn(-9, 'a'), itemExpiringIn(1, 'c')]
    expect(items.sort(urgencySort).map((i) => i.name)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sinks undated items rather than sorting them as urgent', () => {
    const items = [itemExpiringIn(null, 'z'), itemExpiringIn(1, 'a')]
    expect(items.sort(urgencySort).map((i) => i.name)).toEqual(['a', 'z'])
  })
})

describe('urgencyTier', () => {
  it('names the overdue case in days, not as a bare "Expired"', () => {
    expect(urgencyTier(-1)?.label).toBe('Expired yesterday')
    expect(urgencyTier(-4)?.label).toBe('Expired 4d ago')
  })

  it('uses words for the two most urgent live cases', () => {
    expect(urgencyTier(0)?.label).toBe('Today')
    expect(urgencyTier(1)?.label).toBe('Tomorrow')
  })

  it('counts days beyond that', () => {
    expect(urgencyTier(3)?.label).toBe('3 days left')
  })

  it('gives expired and same-day items the strongest colour', () => {
    expect(urgencyTier(-1)?.color).toContain('--color-expired')
    expect(urgencyTier(0)?.color).toContain('--color-expired')
    expect(urgencyTier(3)?.color).toContain('--color-expiring')
  })

  it('returns nothing for an undated item', () => {
    expect(urgencyTier(null)).toBeNull()
  })

  // #182: a subtle "(est.)" marker when the date is a heuristic guess, not
  // one read from a receipt/label or entered by hand. Purely cosmetic — must
  // never touch the tier's colour/urgency.
  describe('estimated marker (#182)', () => {
    it('does not appear by default or when estimated_expiry is false', () => {
      expect(urgencyTier(3)?.label).toBe('3 days left')
      expect(urgencyTier(3, false)?.label).toBe('3 days left')
    })

    it('appears when estimated_expiry is true, without changing colour', () => {
      const tier = urgencyTier(3, true)
      expect(tier?.label).toBe('3 days left (est.)')
      expect(tier?.color).toBe(urgencyTier(3, false)?.color)
    })

    it('appears on the overdue and same-day/tomorrow label variants too', () => {
      expect(urgencyTier(-4, true)?.label).toBe('Expired 4d ago (est.)')
      expect(urgencyTier(0, true)?.label).toBe('Today (est.)')
      expect(urgencyTier(1, true)?.label).toBe('Tomorrow (est.)')
    })
  })
})
