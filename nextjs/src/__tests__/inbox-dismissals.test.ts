/**
 * Issue #906: every notification entry can be dismissed. A dismissal is a record
 * of the state the entry was dismissed in (its fingerprint); a changed state
 * brings the entry back. Pure derivation tests, one block per kind of entry.
 */
import {
  deriveInboxEntries,
  entryFingerprint,
  reconcileDismissals,
  type InboxDismissals,
  type InboxSourceData,
} from '@/lib/inbox-helpers'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'

const NOW = new Date('2026-09-23T12:00:00')
const RECENT_COOK = { last_cooked_at: '2026-09-22T00:00:00Z' }

function pantryItem(overrides: Partial<EnrichedPantryItem> = {}): EnrichedPantryItem {
  return {
    id: 'item-1',
    user_id: 'user-1',
    name: 'Milk',
    name_normalized: 'milk',
    category: 'dairy',
    location: 'fridge',
    quantity: 1,
    unit: 'item',
    expiry_date: null,
    slot_index: null,
    added_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    storage_location: 'fridge',
    days_until_expiry: null,
    is_expired: false,
    is_expiring_soon: false,
    ...overrides,
  }
}

const expired = (id = 'e1', expiry = '2026-09-20') =>
  pantryItem({ id, name: 'Old Yogurt', expiry_date: expiry, days_until_expiry: -3, is_expired: true })
const expiring = (id = 'x1', expiry = '2026-09-24') =>
  pantryItem({ id, name: 'Fresh Bread', expiry_date: expiry, days_until_expiry: 1, is_expiring_soon: true })
const outOfStock = (id = 'o1') => pantryItem({ id, name: 'Eggs', quantity: 0 })

/** Dismiss the first entry of `kind` exactly as the bell does: id to fingerprint. */
function dismissed(data: InboxSourceData, kind: string): InboxDismissals {
  const entry = deriveInboxEntries(data, NOW).allEntries.find((e) => e.kind === kind)
  if (!entry) throw new Error(`no ${kind} entry to dismiss`)
  return { [entry.id]: entryFingerprint(entry) }
}

const kinds = (data: InboxSourceData) => deriveInboxEntries(data, NOW).entries.map((e) => e.kind)

describe('expired entries', () => {
  const base = { pantryItems: [expired()], recipes: [RECENT_COOK] }

  it('stay hidden once dismissed, and the daily "N days ago" copy does not bring them back', () => {
    const dismissals = dismissed(base, 'expired')
    expect(kinds({ ...base, dismissals })).toEqual([])
    const nextDay = new Date('2026-09-24T12:00:00')
    const tomorrow = { ...base, pantryItems: [{ ...expired(), days_until_expiry: -4 }], dismissals }
    expect(deriveInboxEntries(tomorrow, nextDay).entries).toEqual([])
  })

  it('come back when the item is restocked with a new expiry date', () => {
    const dismissals = dismissed(base, 'expired')
    const restocked = { ...base, pantryItems: [expired('e1', '2026-09-21')], dismissals }
    expect(kinds(restocked)).toEqual(['expired'])
  })
})

describe('expiring entries', () => {
  const base = { pantryItems: [expiring()], recipes: [RECENT_COOK] }

  it('stay hidden once dismissed, while a newly expiring item still shows', () => {
    const dismissals = dismissed(base, 'expiring')
    expect(kinds({ ...base, dismissals })).toEqual([])
    const withNew = {
      ...base,
      pantryItems: [expiring(), expiring('x2')],
      dismissals,
    }
    const shown = deriveInboxEntries(withNew, NOW).entries
    expect(shown.map((e) => e.id)).toEqual(['expiring:x2'])
  })

  it('come back when the item is expired by then (a new reason)', () => {
    const dismissals = dismissed(base, 'expiring')
    const nowExpired = { ...base, pantryItems: [expired('x1')], dismissals }
    expect(kinds(nowExpired)).toEqual(['expired'])
  })

  it('come back when the item gets a new expiry date', () => {
    const dismissals = dismissed(base, 'expiring')
    const moved = { ...base, pantryItems: [expiring('x1', '2026-09-25')], dismissals }
    expect(kinds(moved)).toEqual(['expiring'])
  })
})

describe('low-stock entries', () => {
  const base = { pantryItems: [outOfStock()], recipes: [RECENT_COOK] }

  it('stay hidden once dismissed', () => {
    expect(kinds({ ...base, dismissals: dismissed(base, 'low_stock') })).toEqual([])
  })

  it('come back after the item was restocked and ran out again', () => {
    const dismissals = dismissed(base, 'low_stock')
    // Restocked: the entry is gone, and reconciling forgets the dismissal.
    const restocked = { pantryItems: [pantryItem({ id: 'o1', quantity: 2 })], recipes: [RECENT_COOK] }
    const whileStocked = deriveInboxEntries({ ...restocked, dismissals }, NOW)
    const forgotten = reconcileDismissals(dismissals, whileStocked.allEntries, { groceryKnown: true })
    expect(forgotten).toEqual({})
    // Ran out again.
    expect(kinds({ ...base, dismissals: forgotten })).toEqual(['low_stock'])
  })
})

describe('cook nudge', () => {
  const base = { pantryItems: [], recipes: [{ last_cooked_at: '2026-09-01T00:00:00Z' }] }

  it('stays hidden once dismissed', () => {
    expect(kinds({ ...base, dismissals: dismissed(base, 'cook_nudge') })).toEqual([])
  })

  it('stays hidden until the next cook resets the clock and the threshold passes again', () => {
    const dismissals = dismissed(base, 'cook_nudge')
    // Cooked on the 20th: no nudge at all. (Reconciling forgets the dismissal.)
    const cooked = { pantryItems: [], recipes: [{ last_cooked_at: '2026-09-20T00:00:00Z' }] }
    const whileFresh = deriveInboxEntries({ ...cooked, dismissals }, NOW)
    expect(whileFresh.entries).toEqual([])
    // Ten days after that cook the clock has run out again: the nudge returns.
    const later = new Date('2026-09-30T12:00:00')
    const nudged = deriveInboxEntries({ ...cooked, dismissals }, later)
    expect(nudged.entries.map((e) => e.kind)).toEqual(['cook_nudge'])
  })

  it('for an account that never cooked, is keyed to "never cooked" and stays hidden', () => {
    const never = { pantryItems: [], recipes: [{ last_cooked_at: null }] }
    expect(kinds({ ...never, dismissals: dismissed(never, 'cook_nudge') })).toEqual([])
  })
})

describe('grocery pointer', () => {
  const base = { pantryItems: [], recipes: [RECENT_COOK], groceryCount: 3 }

  it('stays hidden once dismissed, even if the count drops', () => {
    const dismissals = dismissed(base, 'grocery')
    expect(kinds({ ...base, dismissals })).toEqual([])
    expect(kinds({ ...base, groceryCount: 2, dismissals })).toEqual([])
  })

  it('comes back when the count goes up', () => {
    const dismissals = dismissed(base, 'grocery')
    expect(kinds({ ...base, groceryCount: 4, dismissals })).toEqual(['grocery'])
  })

  it('comes back when the count rises again after it had dropped', () => {
    const dismissals = dismissed(base, 'grocery')
    // The list shrank to 1 while dismissed: reconciling lowers the bar to 1.
    const shrunk = deriveInboxEntries({ ...base, groceryCount: 1, dismissals }, NOW)
    const lowered = reconcileDismissals(dismissals, shrunk.allEntries, { groceryKnown: true })
    expect(kinds({ ...base, groceryCount: 2, dismissals: lowered })).toEqual(['grocery'])
  })

  it('keeps its dismissal while the grocery count is not known yet', () => {
    const dismissals = dismissed(base, 'grocery')
    const unknown = deriveInboxEntries({ pantryItems: [], recipes: [RECENT_COOK], dismissals }, NOW)
    expect(reconcileDismissals(dismissals, unknown.allEntries, { groceryKnown: false })).toEqual(
      dismissals,
    )
  })
})

describe('dismissed entries and the cap', () => {
  it('do not count towards the total, the overflow, or the visible slots', () => {
    const items = Array.from({ length: 12 }, (_, i) => expiring(`x${i}`))
    const data = { pantryItems: items, recipes: [RECENT_COOK] }
    expect(deriveInboxEntries(data, NOW).overflowCount).toBe(2)

    const dismissals: InboxDismissals = {}
    for (const e of deriveInboxEntries(data, NOW).allEntries.slice(0, 5)) {
      dismissals[e.id] = entryFingerprint(e)
    }
    const result = deriveInboxEntries({ ...data, dismissals }, NOW)
    expect(result.totalCount).toBe(7)
    expect(result.entries).toHaveLength(7)
    expect(result.overflowCount).toBe(0)
    // The full list is still available for "Clear all".
    expect(result.allEntries).toHaveLength(12)
  })
})
